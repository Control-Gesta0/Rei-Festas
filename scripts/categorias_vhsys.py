#!/usr/bin/env python3
"""Cria no VHSYS as categorias financeiras do plano de contas da Rey Festas.

Uso:
    python3 scripts/categorias_vhsys.py                     # simulação: mostra o de-para, não grava
    python3 scripts/categorias_vhsys.py --csv de-para.csv   # simulação + de-para em CSV
    python3 scripts/categorias_vhsys.py --aplicar           # cria as categorias que faltam

O plano é o da proposta aprovada (docs/cliente/Rey-Festas-Plano-de-Contas-e-DRE.pdf):
97 categorias, com o código no começo da descrição ("10.01 - Locação"), porque a API
só aceita tipo e descrição (até 50 caracteres) e não define categoria pai nem grupo do
DRE. Grupos e subgrupos também são cadastrados, como títulos.

Cada categoria do plano cai em um de três casos, comparando pelo código:
    existe    já há uma categoria com o mesmo código, nome e tipo: nada a fazer;
    conflito  o código já existe com outro nome ou tipo: precisa de decisão humana;
    criar     o código não existe na conta.
As categorias da conta que não estão no plano aparecem como "fora do plano", para o
de-para dos lançamentos antigos.

Com --aplicar, o script só grava se não houver nenhum conflito. Rodar de novo não
duplica nada, porque o que já existe é pulado. A trava de conflito também impede
gravar na conta errada: outra empresa com plano numerado tem os mesmos códigos
com outros nomes.

Autenticação: VHSYS_ACCESS_TOKEN e VHSYS_SECRET_ACCESS_TOKEN da conta da Rey Festas.

Documentação: https://developers.vhsys.com.br/api/cadastrar-categoria-15905584e0
              https://developers.vhsys.com.br/api/listar-categoria-15912605e0
"""
import argparse
import csv
import re
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vhsys_api  # noqa: E402

LIMITE_DESCRICAO = 50
PAUSA = 0.3  # segundos entre cadastros, para não estourar o limite de requisições

# (tipo, código, nome). Ordem do DRE; grupos e subgrupos em maiúsculas são títulos.
PLANO = [
    # Receitas
    ("Receita", "10", "RECEITA BRUTA"),
    ("Receita", "10.01", "Locação"),
    ("Receita", "10.02", "Serviços e Buffet"),
    ("Receita", "10.03", "RECEITAS FINANCEIRAS"),
    ("Receita", "10.03.01", "Rendimentos de aplicações"),
    ("Receita", "10.03.02", "Juros e multas recebidos"),
    ("Receita", "10.03.03", "Descontos obtidos"),
    ("Receita", "60", "RECEITAS NÃO OPERACIONAIS"),
    ("Receita", "60.01", "OUTRAS RECEITAS"),
    ("Receita", "60.01.01", "Venda de acervo usado"),
    ("Receita", "60.01.02", "Empréstimos bancários recebidos"),
    ("Receita", "60.01.03", "Aporte e empréstimo de sócios"),
    ("Receita", "60.01.04", "Transferências de entrada"),
    ("Receita", "60.01.05", "Receitas diversas"),
    # Deduções
    ("Despesa", "20", "DEDUÇÕES DA RECEITA"),
    ("Despesa", "20.01", "IMPOSTOS SOBRE A RECEITA"),
    ("Despesa", "20.01.01", "Simples Nacional (DAS)"),
    ("Despesa", "20.01.02", "ISS retido na fonte"),
    ("Despesa", "20.02", "CANCELAMENTOS E DESCONTOS"),
    ("Despesa", "20.02.01", "Cancelamentos e devoluções"),
    ("Despesa", "20.02.02", "Descontos concedidos"),
    # Custos
    ("Despesa", "30", "CUSTOS DOS SERVIÇOS"),
    ("Despesa", "30.01", "CUSTOS DA LOCAÇÃO"),
    ("Despesa", "30.01.01", "Lavanderia de toalhas e tecidos"),
    ("Despesa", "30.01.02", "Material de limpeza e higienização"),
    ("Despesa", "30.01.03", "Manutenção e conserto do acervo"),
    ("Despesa", "30.01.04", "Reposição de peças perdidas/quebradas"),
    ("Despesa", "30.01.05", "Embalagens e materiais de proteção"),
    ("Despesa", "30.02", "CUSTOS DE EVENTOS E BUFFET"),
    ("Despesa", "30.02.01", "Alimentos e bebidas"),
    ("Despesa", "30.02.02", "Descartáveis e insumos de buffet"),
    ("Despesa", "30.02.03", "Freelancers de evento"),
    ("Despesa", "30.02.04", "Terceirizados: som, luz, tendas"),
    ("Despesa", "30.02.05", "Flores e itens de decoração consumidos"),
    ("Despesa", "30.02.06", "Sublocação de itens de terceiros"),
    ("Despesa", "30.03", "LOGÍSTICA"),
    ("Despesa", "30.03.01", "Combustível"),
    ("Despesa", "30.03.02", "Pedágios e estacionamento"),
    ("Despesa", "30.03.03", "Fretes terceirizados"),
    ("Despesa", "30.03.04", "Ajudantes de carga (diárias)"),
    ("Despesa", "30.04", "CUSTOS DE VENDA"),
    ("Despesa", "30.04.01", "Taxas de cartão de crédito e débito"),
    ("Despesa", "30.04.02", "Taxas de boleto e Pix"),
    ("Despesa", "30.04.03", "Comissões de vendedores"),
    # Pessoal
    ("Despesa", "40", "DESPESAS COM PESSOAL"),
    ("Despesa", "40.01", "EQUIPE FIXA"),
    ("Despesa", "40.01.01", "Salários"),
    ("Despesa", "40.01.02", "Pró-labore"),
    ("Despesa", "40.01.03", "Férias e 13º salário"),
    ("Despesa", "40.01.04", "INSS e FGTS"),
    ("Despesa", "40.01.05", "Vale-transporte e vale-refeição"),
    ("Despesa", "40.01.06", "Plano de saúde e benefícios"),
    ("Despesa", "40.01.07", "Uniformes e EPIs"),
    ("Despesa", "40.01.08", "Exames e rescisões"),
    ("Despesa", "40.01.09", "Horas extras"),
    # Despesas operacionais
    ("Despesa", "50", "DESPESAS OPERACIONAIS"),
    ("Despesa", "50.01", "DESPESAS ADMINISTRATIVAS"),
    ("Despesa", "50.01.01", "Aluguel do galpão e loja"),
    ("Despesa", "50.01.02", "IPTU e condomínio"),
    ("Despesa", "50.01.03", "Energia elétrica"),
    ("Despesa", "50.01.04", "Água e esgoto"),
    ("Despesa", "50.01.05", "Telefonia e internet"),
    ("Despesa", "50.01.06", "Sistemas e softwares"),
    ("Despesa", "50.01.07", "Contabilidade"),
    ("Despesa", "50.01.08", "Jurídico"),
    ("Despesa", "50.01.09", "Material de escritório"),
    ("Despesa", "50.01.10", "Manutenção do imóvel"),
    ("Despesa", "50.01.11", "Manutenção de veículos"),
    ("Despesa", "50.01.12", "IPVA, licenciamento e seguro veicular"),
    ("Despesa", "50.01.13", "Seguros"),
    ("Despesa", "50.01.14", "Taxas e licenças"),
    ("Despesa", "50.02", "DESPESAS COMERCIAIS"),
    ("Despesa", "50.02.01", "Tráfego pago"),
    ("Despesa", "50.02.02", "Marketing e redes sociais"),
    ("Despesa", "50.02.03", "Material gráfico e catálogo"),
    ("Despesa", "50.02.04", "Feiras e eventos de divulgação"),
    ("Despesa", "50.03", "DESPESAS FINANCEIRAS"),
    ("Despesa", "50.03.01", "Tarifas bancárias"),
    ("Despesa", "50.03.02", "Juros e multas pagos"),
    ("Despesa", "50.03.03", "Juros de empréstimos"),
    ("Despesa", "50.03.04", "Antecipação de recebíveis"),
    ("Despesa", "50.03.05", "IOF"),
    # Não operacionais, investimentos e lucros
    ("Despesa", "70", "DESPESAS NÃO OPERACIONAIS E INVESTIMENTOS"),
    ("Despesa", "70.01", "OUTRAS DESPESAS"),
    ("Despesa", "70.01.01", "Despesas diversas"),
    ("Despesa", "70.01.02", "Transferências de saída"),
    ("Despesa", "70.02", "INVESTIMENTOS"),
    ("Despesa", "70.02.01", "Compra de acervo para locação"),
    ("Despesa", "70.02.02", "Veículos"),
    ("Despesa", "70.02.03", "Máquinas e equipamentos"),
    ("Despesa", "70.02.04", "Obras e benfeitorias"),
    ("Despesa", "70.03", "EMPRÉSTIMOS"),
    ("Despesa", "70.03.01", "Pagamento de empréstimos bancários"),
    ("Despesa", "70.03.02", "Devolução a sócios"),
    ("Despesa", "90", "DISTRIBUIÇÃO DE LUCROS"),
    ("Despesa", "90.01", "RETIRADAS"),
    ("Despesa", "90.01.01", "Distribuição de lucros aos sócios"),
]

CODIGO = re.compile(r"^\s*(\d+(?:\.\d+)*)\s*-\s*(.+?)\s*$")


def descricao(codigo, nome):
    return f"{codigo} - {nome}"


def _normal(texto):
    """Compara nomes sem diferenciar maiúsculas, acentos e espaços repetidos."""
    texto = unicodedata.normalize("NFKD", texto or "")
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return " ".join(texto.casefold().split())


def separar(desc):
    """("10.01", "Locação") para "10.01 - Locação"; (None, desc) se não tiver código."""
    m = CODIGO.match(desc or "")
    return (m.group(1), m.group(2)) if m else (None, (desc or "").strip())


def listar_categorias():
    """Categorias financeiras fora da lixeira, todas as páginas."""
    return vhsys_api._todas({"lixeira": "Nao"}, caminho="/categorias-financeiras")


def cadastrar_categoria(tipo, desc):
    corpo = vhsys_api._chamar("POST", "/categorias-financeiras",
                              body={"tipo_categoria": tipo, "desc_categoria": desc})
    if not corpo or corpo.get("status") != "success":
        raise vhsys_api.ErroVhsys(f"cadastro de {desc!r} sem sucesso: {corpo!r}")
    dados = corpo.get("data") or {}
    return (dados[0] if isinstance(dados, list) else dados).get("id_categoria")


def comparar(existentes, plano=PLANO):
    """De-para entre o plano e as categorias da conta.

    Devolve (linhas, fora_do_plano). Cada linha é um dict com situacao
    ("existe", "conflito" ou "criar"), tipo, codigo, descricao e, quando houver,
    a categoria existente com o mesmo código.
    """
    por_codigo = {}
    for cat in existentes:
        codigo, _ = separar(cat.get("desc_categoria"))
        if codigo:
            por_codigo.setdefault(codigo, []).append(cat)

    linhas, usados = [], set()
    for tipo, codigo, nome in plano:
        desc = descricao(codigo, nome)
        mesmos = por_codigo.get(codigo, [])
        igual = next((c for c in mesmos if c.get("tipo_categoria") == tipo
                      and _normal(separar(c.get("desc_categoria"))[1]) == _normal(nome)), None)
        diferente = next((c for c in mesmos if c is not igual), None)
        if diferente:
            # O código já é usado com outro nome ou tipo, mesmo que exista também uma
            # categoria igual à do plano: é outro plano de contas, pede decisão humana.
            situacao, atual = "conflito", diferente
        elif igual:
            situacao, atual = "existe", igual
        else:
            situacao, atual = "criar", None
        if atual:
            usados.add(id(atual))
        linhas.append({"situacao": situacao, "tipo": tipo, "codigo": codigo, "descricao": desc,
                       "id_existente": atual and atual.get("id_categoria"),
                       "existente": atual and atual.get("desc_categoria"),
                       "tipo_existente": atual and atual.get("tipo_categoria")})

    fora = [c for c in existentes if id(c) not in usados]
    return linhas, fora


def validar_plano(plano=PLANO):
    """Erros do próprio plano: descrição longa demais ou código repetido."""
    erros, vistos = [], set()
    for tipo, codigo, nome in plano:
        desc = descricao(codigo, nome)
        if len(desc) > LIMITE_DESCRICAO:
            erros.append(f"{desc!r} tem {len(desc)} caracteres (máximo {LIMITE_DESCRICAO})")
        if codigo in vistos:
            erros.append(f"código {codigo} repetido")
        if tipo not in ("Receita", "Despesa"):
            erros.append(f"{codigo}: tipo {tipo!r} inválido")
        vistos.add(codigo)
    return erros


def gravar_csv(caminho, linhas, fora):
    with open(caminho, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["situacao", "tipo", "codigo", "descricao_plano",
                    "id_existente", "descricao_existente", "tipo_existente"])
        for l in linhas:
            w.writerow([l["situacao"], l["tipo"], l["codigo"], l["descricao"],
                        l["id_existente"] or "", l["existente"] or "", l["tipo_existente"] or ""])
        for c in fora:
            w.writerow(["fora do plano", "", "", "", c.get("id_categoria"),
                        c.get("desc_categoria"), c.get("tipo_categoria")])


def relatorio(linhas, fora, saida=None):
    saida = saida or sys.stdout
    contagem = {s: sum(1 for l in linhas if l["situacao"] == s)
                for s in ("existe", "criar", "conflito")}
    print(f"Plano: {len(linhas)} categorias | já existem: {contagem['existe']} | "
          f"a criar: {contagem['criar']} | conflitos: {contagem['conflito']} | "
          f"fora do plano: {len(fora)}", file=saida)
    for l in linhas:
        if l["situacao"] == "conflito":
            print(f"  CONFLITO {l['descricao']} ({l['tipo']}) x conta: {l['existente']} "
                  f"({l['tipo_existente']}, id {l['id_existente']})", file=saida)
    for l in linhas:
        if l["situacao"] == "criar":
            print(f"  criar    {l['tipo']:<8} {l['descricao']}", file=saida)
    for c in fora:
        print(f"  fora     {c.get('tipo_categoria', ''):<8} {c.get('desc_categoria')} "
              f"(id {c.get('id_categoria')})", file=saida)
    return contagem


def aplicar(linhas, cadastrar=None, pausa=None, saida=None):
    """Cadastra as linhas "criar". Para no primeiro erro; rodar de novo retoma."""
    cadastrar = cadastrar or cadastrar_categoria
    pausa = PAUSA if pausa is None else pausa
    saida = saida or sys.stdout
    criadas = []
    for l in linhas:
        if l["situacao"] != "criar":
            continue
        novo_id = cadastrar(l["tipo"], l["descricao"])
        criadas.append((l["descricao"], novo_id))
        print(f"  criada   {l['descricao']} (id {novo_id})", file=saida)
        if pausa:
            time.sleep(pausa)
    return criadas


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--aplicar", action="store_true",
                   help="cria as categorias que faltam (sem isto, só simula)")
    p.add_argument("--csv", help="grava o de-para neste arquivo CSV")
    args = p.parse_args(argv)

    erros = validar_plano()
    if erros:
        print("Plano inválido:\n  " + "\n  ".join(erros), file=sys.stderr)
        return 2

    linhas, fora = comparar(listar_categorias())
    contagem = relatorio(linhas, fora)
    if args.csv:
        gravar_csv(args.csv, linhas, fora)
        print(f"De-para gravado em {args.csv}")

    if not args.aplicar:
        print("Simulação: nada foi gravado. Use --aplicar para criar as categorias.")
        return 0
    if contagem["conflito"]:
        print("Nada foi gravado: resolva os conflitos antes (ou confira se a conta é "
              "mesmo a da Rey Festas).", file=sys.stderr)
        return 1
    if not contagem["criar"]:
        print("Todas as categorias do plano já existem.")
        return 0
    criadas = aplicar(linhas)
    print(f"{len(criadas)} categorias criadas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
