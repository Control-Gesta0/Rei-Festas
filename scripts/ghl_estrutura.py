"""Monta a estrutura da Rey Festas no GoHighLevel: pipelines, etapas e campos.

Python 3.11+ e so biblioteca padrao.

    python ghl_estrutura.py              # ensaio: mostra o que criaria
    python ghl_estrutura.py --executar   # cria/corrige no GHL

E SEGURO RODAR DE NOVO. Pipeline casa pelo nome (sem acento), campo casa
por nome + modelo. O que ja existe e conferido e, no pipeline, corrigido
mantendo os IDs das etapas -- etapa nova vai pro fim, etapa que sobra no
GHL nao e apagada (pode ter oportunidade dentro).

Por que Python e nao curl: o curl do Git Bash no Windows mandou o corpo em
cp1252 e o GHL gravou "Loca\\ufffd\\ufffdo". Aqui o JSON sai sempre em UTF-8.

Desenho: diagnostico/DIAGNOSTICO.md secao 5. Jornada = etapas (progressivas);
processo = campos (condicoes). Nada de "Sem resposta" ou "Aguardando cliente"
como etapa.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent  # raiz do repositorio
BASE = "https://services.leadconnectorhq.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

PIPELINES = {
    "Locação: Vendas": [
        "Novo contato",
        "Coletando pedido",
        "Pedido completo",        # fim da alcada da IA
        "Orçamento enviado",
        "Pedido fechado",         # o aceite: fim da jornada no GHL (vai para o VHSYS)
    ],
    # 25/10/2026: "Aguardando pagamento" virou "Pedido fechado" (mesmo id, pela
    # posicao) e "Reservado" saiu. Reserva, sinal e recebimento sao do VHSYS.
    # "Locação: Operação" foi criado e REMOVIDO em 07/10/2026: a operação vive no app
    # Locações do VHSYS e um funil espelho no GHL seria trabalho em dobro.
}

# (modelo, nome, tipo, opcoes)
CAMPOS = [
    ("opportunity", "Data do evento", "DATE", None),
    ("opportunity", "Tipo de evento", "SINGLE_OPTIONS",
     ["Aniversário", "Casamento", "Chá ou festa familiar", "Corporativo",
      "Igreja", "Escola", "Condomínio", "Outro"]),
    ("opportunity", "Nº de convidados", "NUMERICAL", None),
    ("opportunity", "Entrega ou retirada", "SINGLE_OPTIONS", ["Entrega", "Retirada na loja"]),
    ("opportunity", "Endereço do evento", "LARGE_TEXT", None),
    ("opportunity", "Cidade do evento", "TEXT", None),
    ("opportunity", "Itens solicitados", "LARGE_TEXT", None),
    ("opportunity", "Valor de tabela estimado", "MONETORY", None),
    ("opportunity", "Nº do pedido no ERP", "TEXT", None),
    ("opportunity", "Forma de pagamento", "SINGLE_OPTIONS", ["Pix", "Cartão (link)", "Boleto"]),
    ("opportunity", "Data de entrega ou retirada", "DATE", None),
    ("opportunity", "Período da entrega", "SINGLE_OPTIONS", ["Manhã", "Tarde"]),
    ("opportunity", "Contato no local", "TEXT", None),
    ("opportunity", "Data de devolução", "DATE", None),
    ("opportunity", "Avaria ou falta", "LARGE_TEXT", None),
    ("opportunity", "Motivo da perda", "SINGLE_OPTIONS",
     ["Não temos o item", "Sem estoque na data", "Preço", "Frete",
      "Fechou com concorrente", "Evento cancelado", "Prazo curto demais",
      "Parou de responder"]),
    ("contact", "Perfil do cliente", "SINGLE_OPTIONS",
     ["Pessoa física", "Decoradora ou assessora", "Buffet ou espaço de eventos",
      "Empresa, escola ou igreja"]),
    ("contact", "CPF ou CNPJ", "TEXT", None),
    ("contact", "RG", "TEXT", None),
    ("contact", "Cadastro no ERP", "SINGLE_OPTIONS", ["Sim", "Não"]),
    ("contact", "ID no ERP", "TEXT", None),  # id_cliente do VHSYS (agente-ia/lib/erp-sync.ts)
]


def chave(texto: str) -> str:
    sem = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return " ".join(sem.lower().split())


def carregar_env() -> dict[str, str]:
    caminho = Path(os.environ.get("REYFESTAS_ENV", "").strip() or RAIZ / ".env")
    env = {}
    for linha in (caminho.read_text(encoding="utf-8").splitlines() if caminho.exists() else []):
        if "=" in linha and not linha.lstrip().startswith("#"):
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("GHL_TOKEN", "GHL_LOCATION_ID"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


class GHL:
    def __init__(self, env: dict[str, str]):
        self.loc = env["GHL_LOCATION_ID"]
        self.cab = {"Authorization": f"Bearer {env['GHL_TOKEN']}", "Version": "2021-07-28",
                    "Accept": "application/json", "User-Agent": UA}

    def req(self, metodo: str, rota: str, corpo: dict | None = None, **params) -> dict:
        url = BASE + rota + ("?" + urllib.parse.urlencode(params) if params else "")
        dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8") if corpo is not None else None
        cab = dict(self.cab)
        if dados is not None:
            cab["Content-Type"] = "application/json; charset=utf-8"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, dados, cab, method=metodo), timeout=60) as r:
                return json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{metodo} {rota}: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:400]}") from None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--executar", action="store_true")
    args = ap.parse_args()
    ghl = GHL(carregar_env())
    acao = "" if args.executar else "(ensaio) "

    # ------------------------------------------------------------- pipelines
    vivos = ghl.req("GET", "/opportunities/pipelines", locationId=ghl.loc)["pipelines"]
    # casa sem acento: e assim que o pipeline com nome quebrado ("Loca??o")
    # e reconhecido e corrigido em vez de duplicado
    def so_ascii(t: str) -> str:
        # "Loca��o: Vendas" e "Locação: Vendas" viram ambos "locaovendas"
        return "".join(c for c in t.lower() if c.isascii() and c.isalnum())

    def casa(nome_vivo: str, alvo: str) -> bool:
        return chave(nome_vivo) == chave(alvo) or so_ascii(nome_vivo) == so_ascii(alvo)

    for nome, etapas in PIPELINES.items():
        atual = next((p for p in vivos if casa(p["name"], nome)), None)
        if not atual:
            print(f"{acao}criar pipeline {nome}: {', '.join(etapas)}")
            if args.executar:
                p = ghl.req("POST", "/opportunities/pipelines", {
                    "locationId": ghl.loc, "name": nome,
                    "stages": [{"name": e, "position": i} for i, e in enumerate(etapas)]})["pipeline"]
                print(f"  criado {p['id']}")
            continue
        # etapa casa pela posicao quando o nome so difere por acento quebrado
        vivas = sorted(atual["stages"], key=lambda s: s["position"])
        novas = []
        for i, e in enumerate(etapas):
            s = vivas[i] if i < len(vivas) else None
            novas.append({"id": s["id"], "name": e, "position": i} if s else {"name": e, "position": i})
        sobra = [s["name"] for s in vivas[len(etapas):]]
        mudou = atual["name"] != nome or [s["name"] for s in vivas[:len(etapas)]] != etapas[:len(vivas)] \
            or len(vivas) < len(etapas)
        if not mudou:
            print(f"ok pipeline {nome} ({atual['id']})")
            continue
        print(f"{acao}corrigir pipeline {atual['name']!r} -> {nome} ({atual['id']})")
        if sobra:
            print(f"  ATENCAO: etapas a mais no GHL mantidas: {sobra}")
        if args.executar:
            ghl.req("PUT", f"/opportunities/pipelines/{atual['id']}",
                    {"name": nome, "stages": novas})
            print("  corrigido")

    # ---------------------------------------------------------------- campos
    for modelo in ("opportunity", "contact"):
        vivos_c = ghl.req("GET", f"/locations/{ghl.loc}/customFields", model=modelo).get("customFields", [])
        existentes = {chave(c["name"]): c for c in vivos_c if c.get("model", modelo) == modelo}
        for m, nome, tipo, opcoes in CAMPOS:
            if m != modelo:
                continue
            c = existentes.get(chave(nome))
            if c:
                print(f"ok campo {modelo}/{nome} ({c['id']}, {c.get('fieldKey')})")
                continue
            print(f"{acao}criar campo {modelo}/{nome} [{tipo}]" + (f" {opcoes}" if opcoes else ""))
            if args.executar:
                corpo = {"name": nome, "dataType": tipo, "model": modelo}
                if opcoes:
                    corpo["options"] = opcoes
                novo = ghl.req("POST", f"/locations/{ghl.loc}/customFields", corpo).get("customField", {})
                print(f"  criado {novo.get('id')} {novo.get('fieldKey')}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
