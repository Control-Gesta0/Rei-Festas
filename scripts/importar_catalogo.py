"""Importa o catalogo de locacao da Rey Festas para o Control ERP Lite (vhsys).

Python 3.11+ e so biblioteca padrao. Nada para instalar.

    python importar_catalogo.py                    # ensaio: le, valida, mostra o plano
    python importar_catalogo.py --executar --limite 1   # cria 1 produto para conferir na tela
    python importar_catalogo.py --executar         # carga completa

Sem --executar nada e gravado. Com tokens no .env, o ensaio tambem le o que
ja existe no Lite e diz o que seria criado e o que seria pulado.

E SEGURO RODAR DE NOVO. Categoria casa pelo nome e produto casa pelo codigo
(cod_produto) ou pela descricao; o que ja existe e pulado, nunca duplicado.

O ESTOQUE NAO ENTRA NO CADASTRO. O POST /produtos aceita estoque_produto e
ignora: o produto nasce com estoque 0. A quantidade vai num lancamento de
Entrada separado, e so quando o estoque do produto no Lite ainda e 0 -- e o
que impede a segunda rodada de somar a quantidade de novo. Por isso esta e
uma carga inicial: depois que o estoque andar no ERP, nao rode para acertar
saldo.

COMO A PLANILHA VIRA CADASTRO

  planilha               Lite
  Categoria          ->  categoria de produto   (/categorias)
  Codigo             ->  cod_produto            (LOU-001, TEC-052 ...)
  Descricao          ->  desc_produto
  Quantidade         ->  lancamento de Entrada em /produtos/{id}/estoque
  Valor Locacao      ->  valor_produto
  Grupo, Cod. Antigo ->  obs_produto            ("Grupo: Mesa Posta | Cod. antigo: LP0035")

O Valor de Reposicao fica de fora desta carga: a coluna esta vazia. Os itens
sem reposicao, sem quantidade ou sem valor saem em saida/pendencias.csv para
completar depois direto no ERP.

Os tokens vem do ambiente ou do .env na raiz do repositorio
(VHSYS_ACCESS_TOKEN e VHSYS_SECRET_ACCESS_TOKEN, conta da REY FESTAS).
REYFESTAS_ENV aponta para outro .env, se preferir.

Ja rodado em 06/10/2026: 9 categorias, 209 produtos, 175 entradas de estoque.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent  # raiz do repositorio
PLANILHA = RAIZ / "docs" / "cliente" / "catalogo-produtos.xlsx"
SAIDA = RAIZ / "saida"

BASE = "https://api.vhsys.com/v2"
LIMITE_MAX = 250
# O Cloudflare na frente da API do Lite responde 403 ao User-Agent
# 'Python-urllib' padrao. Sem um UA de navegador, nada passa.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")

# Repor vem do orcamento 23148 (Modelo de proposta.pdf). Unico valor de
# reposicao conhecido hoje; vai para as pendencias como sugestao, nao para a carga.
REPOSICAO_NO_PDF = {"TC0032": "150,00", "TC0020": "30,00"}


# ----------------------------------------------------------------------- planilha
@dataclass
class Item:
    linha: int
    grupo: str
    categoria: str
    codigo: str
    descricao: str
    quantidade: Decimal | None
    valor: Decimal | None
    reposicao: Decimal | None
    cod_antigo: str


def _decimal(valor: str) -> Decimal | None:
    texto = str(valor or "").strip().replace(",", ".")
    if not texto:
        return None
    try:
        # 1.1000000000000001 vem do Excel; duas casas e o que o ERP guarda
        return Decimal(texto).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def _ler_aba(z: zipfile.ZipFile, arquivo: str, textos: list[str]) -> list[dict[str, str]]:
    xml = z.read(arquivo).decode("utf-8")
    linhas = []
    for numero, corpo in re.findall(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        celulas = {"_linha": numero}
        for col, attrs, conteudo in re.findall(
                r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', corpo, re.S):
            v = re.search(r"<v>(.*?)</v>", conteudo or "")
            valor = v.group(1) if v else ""
            if 't="s"' in attrs and valor:
                valor = textos[int(valor)]
            elif 't="inlineStr"' in attrs:
                valor = html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", conteudo, re.S)))
            celulas[col] = html.unescape(valor).strip()
        linhas.append(celulas)
    return linhas


def ler_catalogo(caminho: Path = PLANILHA) -> list[Item]:
    """Le o .xlsx sem openpyxl: e um zip de XML, e so precisamos dos valores."""
    with zipfile.ZipFile(caminho) as z:
        textos = [
            html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)))
            for si in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode("utf-8"), re.S)
        ]
        catalogo = _ler_aba(z, "xl/worksheets/sheet1.xml", textos)
        legenda = _ler_aba(z, "xl/worksheets/sheet2.xml", textos)

    # Aba Categorias: Grupo | Prefixo | Categoria. Serve para completar linha
    # que entrou na mao so com codigo e descricao (o TEC-082 chegou assim).
    por_prefixo = {
        l["B"]: (l["A"], l["C"]) for l in legenda
        if re.fullmatch(r"[A-Z]{3}", l.get("B", ""))
    }

    itens = []
    for l in catalogo:
        codigo = l.get("C", "")
        if not re.fullmatch(r"[A-Z]{3}-\d{3}", codigo):
            continue                     # titulo, cabecalho, linha vazia
        grupo, categoria = l.get("A", ""), l.get("B", "")
        if not (grupo and categoria):
            grupo, categoria = por_prefixo.get(codigo[:3], (grupo, categoria))
        itens.append(Item(
            linha=int(l["_linha"]),
            grupo=grupo,
            categoria=categoria,
            codigo=codigo,
            descricao=re.sub(r"\s+", " ", l.get("D", "")),
            quantidade=_decimal(l.get("E", "")),
            valor=_decimal(l.get("F", "")),
            reposicao=_decimal(l.get("G", "")),
            cod_antigo=l.get("H", ""),
        ))
    return itens


def validar(itens: list[Item]) -> list[str]:
    """Erros que impedem a carga. Falta de valor/quantidade nao impede: vira pendencia."""
    erros = []
    vistos_cod: dict[str, int] = {}
    vistos_desc: dict[str, int] = {}
    for i in itens:
        if not i.categoria:
            erros.append(f"linha {i.linha} {i.codigo}: sem categoria")
        if not i.descricao:
            erros.append(f"linha {i.linha} {i.codigo}: sem descricao")
        if i.codigo in vistos_cod:
            erros.append(f"linha {i.linha}: codigo {i.codigo} repetido (linha {vistos_cod[i.codigo]})")
        chave = normalizar(i.descricao)
        if chave in vistos_desc:
            erros.append(f"linha {i.linha} {i.codigo}: descricao repetida (linha {vistos_desc[chave]})")
        vistos_cod[i.codigo] = i.linha
        vistos_desc[chave] = i.linha
    return erros


def normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sem_acento).strip().lower()


def _dinheiro(valor: Decimal | None) -> str:
    return f"{(valor or Decimal('0')):.2f}"


def payload_produto(item: Item, id_categoria: int) -> dict:
    obs = f"Grupo: {item.grupo}"
    if item.cod_antigo:
        obs += f" | Cod. antigo: {item.cod_antigo}"
    return {
        "id_categoria": id_categoria,
        "cod_produto": item.codigo,
        "desc_produto": item.descricao,
        "unidade_produto": "UN",
        "valor_produto": _dinheiro(item.valor),
        "obs_produto": obs,
        "tipo_produto": "Produto",
        "kit_produto": "Nao",
        "status_produto": "Ativo",
    }


# --------------------------------------------------------------------------- env
def carregar_env() -> dict[str, str]:
    caminho = Path(os.environ.get("REYFESTAS_ENV", "").strip() or RAIZ / ".env")
    valores: dict[str, str] = {}
    if caminho.exists():
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                chave, valor = linha.split("=", 1)
                valores[chave.strip()] = valor.strip().strip('"').strip("'")
    for chave in ("VHSYS_ACCESS_TOKEN", "VHSYS_SECRET_ACCESS_TOKEN", "VHSYS_BASE_URL"):
        if os.environ.get(chave):
            valores[chave] = os.environ[chave]
    return valores


# ---------------------------------------------------------------------------- api
class ErroAPI(Exception):
    def __init__(self, status: int, corpo: str, url: str):
        super().__init__(f"HTTP {status} em {url}: {corpo[:300]}")
        self.status, self.corpo = status, corpo


class Lite:
    def __init__(self, env: dict[str, str]):
        self.base = (env.get("VHSYS_BASE_URL") or BASE).rstrip("/")
        self.headers = {
            "access-token": env["VHSYS_ACCESS_TOKEN"],
            "secret-access-token": env["VHSYS_SECRET_ACCESS_TOKEN"],
            "Accept": "application/json",
            "User-Agent": UA,
            "Cache-Control": "no-cache",
        }

    def _chamar(self, metodo: str, rota: str, params: dict | None = None,
                corpo: dict | None = None) -> dict:
        url = f"{self.base}/{rota.strip('/')}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8") if corpo is not None else None
        cab = dict(self.headers)
        if dados is not None:
            cab["Content-Type"] = "application/json"
        for tentativa in range(1, 5):
            req = urllib.request.Request(url, data=dados, headers=cab, method=metodo)
            try:
                with urllib.request.urlopen(req, timeout=45) as r:
                    bruto = r.read().decode("utf-8", errors="replace")
                resp = json.loads(bruto) if bruto.strip() else {}
                # A API as vezes devolve HTTP 200 com corpo de erro. Sem esta
                # checagem, escrita que falhou passaria por bem-sucedida.
                if isinstance(resp, dict) and str(resp.get("status", "")).lower() == "error":
                    raise ErroAPI(int(str(resp.get("code") or 0) or 0), str(resp.get("data") or resp), url)
                return resp if isinstance(resp, dict) else {"data": resp}
            except urllib.error.HTTPError as e:
                texto = e.read().decode("utf-8", errors="replace")
                if e.code in (429, 500, 502, 503, 504) and tentativa < 4:
                    time.sleep(min(2 ** tentativa, 30))
                    continue
                raise ErroAPI(e.code, texto, url) from None
            except (urllib.error.URLError, TimeoutError):
                if tentativa < 4:
                    time.sleep(min(2 ** tentativa, 30))
                    continue
                raise
        raise RuntimeError("requisicao falhou sem erro registrado")

    def listar(self, rota: str) -> list[dict]:
        """Rota inteira por limit/offset, sem a lixeira.

        A API devolve registro apagado junto com o vivo e nao aceita filtro;
        sem descartar a lixeira aqui, um produto apagado na tela faria o
        script pular a recriacao dele.
        """
        registros, offset = [], 0
        while True:
            try:
                resp = self._chamar("GET", rota, {"limit": LIMITE_MAX, "offset": offset})
            except ErroAPI as e:
                # Lista vazia nao e 200 com data [] nesta API: e 403 com
                # "Nenhuma categoria encontrada!". Credencial errada tambem e
                # 403, entao so o texto separa um caso do outro.
                if e.status == 403 and "nenhum" in e.corpo.lower():
                    break
                raise
            lote = resp.get("data") or []
            if isinstance(lote, dict):
                lote = [lote]
            if isinstance(lote, str):
                raise RuntimeError(f"o Lite recusou /{rota}: {resp.get('code')} — {lote}")
            if not lote:
                break
            registros += [r for r in lote if r.get("lixeira") != "Sim"]
            offset += len(lote)      # avanca pelo recebido, nunca pelo limit pedido
            total = int((resp.get("paging") or {}).get("total") or 0)
            if total and offset >= total:
                break
        return registros

    def criar(self, rota: str, payload: dict) -> dict:
        resp = self._chamar("POST", rota, corpo=payload)
        dados = resp.get("data")
        return dados[0] if isinstance(dados, list) and dados else (dados or {})


# -------------------------------------------------------------------------- carga
def gravar_csv(nome: str, linhas: list[dict]) -> Path:
    SAIDA.mkdir(exist_ok=True)
    caminho = SAIDA / nome
    campos = list(linhas[0].keys()) if linhas else ["vazio"]
    # utf-8-sig para o Excel abrir com acento certo
    with caminho.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=campos, delimiter=";")
        w.writeheader()
        w.writerows(linhas)
    return caminho


def pendencias(itens: list[Item]) -> list[dict]:
    linhas = []
    for i in itens:
        faltas = []
        if i.reposicao is None:
            faltas.append("reposicao")
        if i.quantidade is None:
            faltas.append("quantidade (entrou 0)")
        if i.valor is None:
            faltas.append("valor locacao (entrou 0)")
        if faltas:
            linhas.append({
                "codigo": i.codigo, "descricao": i.descricao, "categoria": i.categoria,
                "cod_antigo": i.cod_antigo, "falta": ", ".join(faltas),
                "reposicao_sugerida": REPOSICAO_NO_PDF.get(i.cod_antigo, ""),
            })
    return linhas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--executar", action="store_true", help="grava no Lite (sem isso e ensaio)")
    ap.add_argument("--limite", type=int, default=0, help="cria no maximo N produtos")
    args = ap.parse_args()

    itens = ler_catalogo()
    erros = validar(itens)
    categorias = sorted({i.categoria for i in itens})
    print(f"planilha: {len(itens)} produtos em {len(categorias)} categorias")
    for c in categorias:
        print(f"  {sum(i.categoria == c for i in itens):>3}  {c}")
    if erros:
        print("\nERROS na planilha — corrija antes de importar:")
        for e in erros:
            print("  -", e)
        return 1

    pend = pendencias(itens)
    print(f"\npendencias: {len(pend)} itens  -> {gravar_csv('pendencias.csv', pend).relative_to(RAIZ)}")

    env = carregar_env()
    if not (env.get("VHSYS_ACCESS_TOKEN") and env.get("VHSYS_SECRET_ACCESS_TOKEN")):
        if args.executar:
            print("\nsem VHSYS_ACCESS_TOKEN/VHSYS_SECRET_ACCESS_TOKEN no .env — nada foi gravado")
            return 1
        print("\nsem tokens: ensaio so da planilha. Preencha o .env para comparar com o Lite.")
        return 0

    lite = Lite(env)
    cats_lite = {normalizar(c.get("nome_categoria")): int(c["id_categoria"])
                 for c in lite.listar("categorias")}
    prods_lite = lite.listar("produtos")
    por_cod = {str(p.get("cod_produto") or "").strip().upper(): p for p in prods_lite}
    por_desc = {normalizar(p.get("desc_produto")): p for p in prods_lite}
    print(f"\nLite hoje: {len(cats_lite)} categorias, {len(prods_lite)} produtos (fora a lixeira)")

    modo = "GRAVANDO" if args.executar else "ENSAIO (nada sera gravado)"
    print(f"\n--- {modo} ---")

    for c in categorias:
        if normalizar(c) in cats_lite:
            continue
        if args.executar:
            novo = lite.criar("categorias", {"nome_categoria": c, "status_categoria": "Ativo"})
            cats_lite[normalizar(c)] = int(novo["id_categoria"])
            print(f"  categoria criada: {c} (id {novo['id_categoria']})")
        else:
            print(f"  categoria a criar: {c}")

    log, criados = [], 0
    for i in itens:
        existente = por_cod.get(i.codigo) or por_desc.get(normalizar(i.descricao))
        linha = {"codigo": i.codigo, "descricao": i.descricao, "categoria": i.categoria,
                 "acao": "", "id_produto": "", "estoque": "", "detalhe": ""}
        id_produto, estoque_atual = "", Decimal("0")
        if existente:
            id_produto = existente.get("id_produto", "")
            estoque_atual = _decimal(existente.get("estoque_produto")) or Decimal("0")
            linha.update(acao="ja_existe", id_produto=id_produto)
        elif args.limite and criados >= args.limite:
            linha["acao"] = "fora_do_limite"
        elif not args.executar:
            linha["acao"] = "criaria"
            criados += 1
        else:
            try:
                novo = lite.criar("produtos", payload_produto(i, cats_lite[normalizar(i.categoria)]))
                id_produto = novo.get("id_produto", "")
                linha.update(acao="criado", id_produto=id_produto)
                criados += 1
                print(f"  {i.codigo}  {i.descricao}  -> id {id_produto}")
            except ErroAPI as e:
                linha.update(acao="erro", detalhe=e.corpo[:300])
                print(f"  ERRO {i.codigo}: {e}")

        if linha["acao"] in ("criado", "ja_existe", "criaria") and i.quantidade:
            if estoque_atual != 0:
                linha["estoque"] = f"ja tem {estoque_atual}"
            elif not args.executar:
                linha["estoque"] = f"lancaria {i.quantidade}"
            else:
                try:
                    lite.criar(f"produtos/{id_produto}/estoque", {
                        "tipo_estoque": "Entrada",
                        "qtde_estoque": _dinheiro(i.quantidade),
                        "valor_estoque": "0.00",
                        "obs_estoque": "Carga inicial do catalogo",
                        "identificacao": "Carga inicial",
                    })
                    linha["estoque"] = f"lancado {i.quantidade}"
                except ErroAPI as e:
                    linha.update(estoque="erro", detalhe=e.corpo[:300])
                    print(f"  ERRO estoque {i.codigo}: {e}")
        log.append(linha)

    arquivo = gravar_csv("importacao_catalogo.csv" if args.executar else "ensaio_catalogo.csv", log)
    resumo: dict[str, int] = {}
    for l in log:
        resumo[l["acao"]] = resumo.get(l["acao"], 0) + 1
    print("\nresumo:", ", ".join(f"{k} {v}" for k, v in sorted(resumo.items())))
    lancados = sum(l["estoque"].startswith(("lancado", "lancaria")) for l in log)
    erros_estoque = sum(l["estoque"] == "erro" for l in log)
    print(f"estoque: {lancados} lancamentos" + (f", {erros_estoque} com erro" if erros_estoque else ""))
    print("log:", arquivo.relative_to(RAIZ))
    return 1 if resumo.get("erro") or erros_estoque else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
