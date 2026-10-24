"""Testes do script de criação das categorias financeiras da Rey Festas.

    python3 -m unittest discover -s tests
"""
import io
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import categorias_vhsys as cv  # noqa: E402


class SemRede(unittest.TestCase):
    """Nenhum teste pode falar com o VHSYS de verdade: as credenciais do ambiente são de
    uma conta real (em 24/10/2026 um teste sem esta trava criou categorias nela)."""

    def setUp(self):
        patcher = mock.patch.object(cv.vhsys_api, "_chamar",
                                    side_effect=AssertionError("chamada real ao VHSYS em teste"))
        patcher.start()
        self.addCleanup(patcher.stop)


def cat(id_, desc, tipo):
    return {"id_categoria": id_, "desc_categoria": desc, "tipo_categoria": tipo}


class TestPlano(SemRede):
    def test_plano_valido(self):
        self.assertEqual(cv.validar_plano(), [])

    def test_plano_tem_97_categorias(self):
        self.assertEqual(len(cv.PLANO), 97)
        self.assertEqual(sum(1 for t, *_ in cv.PLANO if t == "Receita"), 14)

    def test_descricao_longa_e_codigo_repetido(self):
        erros = cv.validar_plano([("Despesa", "30.01", "x" * 45), ("Despesa", "30.01", "Outra")])
        self.assertTrue(any("caracteres" in e for e in erros))
        self.assertTrue(any("repetido" in e for e in erros))


class TestComparar(SemRede):
    PLANO = [("Receita", "10", "RECEITA BRUTA"), ("Receita", "10.01", "Locação"),
             ("Despesa", "30.01.01", "Lavanderia de toalhas e tecidos")]

    def test_conta_vazia_cria_tudo(self):
        linhas, fora = cv.comparar([], self.PLANO)
        self.assertEqual([l["situacao"] for l in linhas], ["criar"] * 3)
        self.assertEqual(fora, [])

    def test_mesmo_nome_sem_acento_e_caixa_conta_como_existente(self):
        linhas, _ = cv.comparar([cat(1, "10.01 -  LOCACAO", "Receita")], self.PLANO)
        self.assertEqual(linhas[1]["situacao"], "existe")
        self.assertEqual(linhas[1]["id_existente"], 1)

    def test_codigo_com_outro_nome_ou_tipo_e_conflito(self):
        existentes = [cat(1, "10.01 - VENDAS", "Receita"),
                      cat(2, "30.01.01 - Lavanderia de toalhas e tecidos", "Receita")]
        linhas, fora = cv.comparar(existentes, self.PLANO)
        self.assertEqual([l["situacao"] for l in linhas], ["criar", "conflito", "conflito"])
        self.assertEqual(fora, [])

    def test_codigo_igual_ao_plano_e_tambem_com_outro_nome_e_conflito(self):
        existentes = [cat(1, "10.01 - VENDAS", "Receita"), cat(2, "10.01 - Locação", "Receita")]
        linhas, _ = cv.comparar(existentes, self.PLANO)
        self.assertEqual(linhas[1]["situacao"], "conflito")
        self.assertEqual(linhas[1]["id_existente"], 1)

    def test_categoria_da_conta_sem_codigo_fica_fora_do_plano(self):
        linhas, fora = cv.comparar([cat(9, "PERSONALIZADO", "Receita")], self.PLANO)
        self.assertEqual([c["id_categoria"] for c in fora], [9])

    def test_separar(self):
        self.assertEqual(cv.separar("10.03.01 - Rendimentos"), ("10.03.01", "Rendimentos"))
        self.assertEqual(cv.separar("PERSONALIZADO"), (None, "PERSONALIZADO"))


class TestMain(SemRede):
    def rodar(self, existentes, *args):
        cadastrar = mock.Mock(side_effect=lambda tipo, desc: 1000)
        with mock.patch.object(cv, "listar_categorias", return_value=existentes), \
             mock.patch.object(cv, "cadastrar_categoria", cadastrar), \
             mock.patch.object(cv, "PAUSA", 0), \
             mock.patch("sys.stdout", io.StringIO()) as out, \
             mock.patch("sys.stderr", io.StringIO()):
            codigo = cv.main(list(args))
        return codigo, cadastrar, out.getvalue()

    def test_simulacao_nao_grava(self):
        codigo, cadastrar, out = self.rodar([])
        self.assertEqual(codigo, 0)
        cadastrar.assert_not_called()
        self.assertIn("a criar: 97", out)

    def test_aplicar_cria_so_o_que_falta(self):
        codigo, cadastrar, _ = self.rodar([cat(1, "10 - RECEITA BRUTA", "Receita")], "--aplicar")
        self.assertEqual(codigo, 0)
        self.assertEqual(cadastrar.call_count, 96)
        cadastrar.assert_any_call("Receita", "10.01 - Locação")
        self.assertNotIn(mock.call("Receita", "10 - RECEITA BRUTA"), cadastrar.call_args_list)

    def test_conflito_bloqueia_gravacao(self):
        # Conta de outra empresa com plano numerado: mesmo código, outro nome.
        codigo, cadastrar, _ = self.rodar([cat(1, "10.01 - VENDAS", "Receita")], "--aplicar")
        self.assertEqual(codigo, 1)
        cadastrar.assert_not_called()

    def test_rodar_de_novo_nao_duplica(self):
        existentes = [cat(i, cv.descricao(c, n), t) for i, (t, c, n) in enumerate(cv.PLANO)]
        codigo, cadastrar, out = self.rodar(existentes, "--aplicar")
        self.assertEqual(codigo, 0)
        cadastrar.assert_not_called()
        self.assertIn("já existem", out)


class TestCadastrar(SemRede):
    # Estes testes trocam o _chamar bloqueado por respostas prontas.

    def test_envia_tipo_e_descricao(self):
        resposta = {"code": 200, "status": "success",
                    "data": {"id_categoria": 123, "tipo_categoria": "Receita",
                             "desc_categoria": "10.01 - Locação"}}
        with mock.patch.object(cv.vhsys_api, "_chamar", return_value=resposta) as chamar:
            self.assertEqual(cv.cadastrar_categoria("Receita", "10.01 - Locação"), 123)
        chamar.assert_called_once_with("POST", "/categorias-financeiras",
                                       body={"tipo_categoria": "Receita",
                                             "desc_categoria": "10.01 - Locação"})

    def test_resposta_sem_sucesso_levanta_erro(self):
        with mock.patch.object(cv.vhsys_api, "_chamar", return_value={"status": "error"}):
            with self.assertRaises(cv.vhsys_api.ErroVhsys):
                cv.cadastrar_categoria("Receita", "10.01 - Locação")


if __name__ == "__main__":
    unittest.main()
