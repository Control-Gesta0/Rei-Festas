"""Gera o catálogo que o agente de IA usa, a partir dos produtos do Control ERP Lite.

O preço vem do ERP (a fonte da verdade depois da carga) e o agrupamento por
categoria vem da planilha do catálogo. Produto com valor zero no ERP sai como
"valor com a equipe": a IA não informa preço dele.

Saídas (as duas dentro de agente-ia/):
  lib/catalogo-dados.ts       a tabela que a tool calcular_tabela soma em código
  prompts/portas/locacao.md   a seção do catálogo, entre os marcadores CATALOGO

Uso:
  python scripts/catalogo_agente.py            # lê o ERP
  python scripts/catalogo_agente.py --planilha # só a planilha (sem rede)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importar_catalogo import Lite, carregar_env, ler_catalogo  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
AGENTE = RAIZ / "agente-ia"
DADOS_TS = AGENTE / "lib" / "catalogo-dados.ts"
PROMPT = AGENTE / "prompts" / "portas" / "locacao.md"
INICIO, FIM = "<!-- CATALOGO:INICIO -->", "<!-- CATALOGO:FIM -->"
CODIGO = re.compile(r"[A-Z]{3}-\d{3}")


def precos_do_erp() -> dict[str, Decimal | None]:
    produtos = Lite(carregar_env()).listar("produtos")
    # Trava do incidente de 24/10: tokens da Control Gestão listam outra empresa
    nomes = " ".join(str(p.get("desc_produto", "")) for p in produtos).upper()
    if "LICENÇAS CONTROL ERP PRO" in nomes or "LICENCAS CONTROL ERP PRO" in nomes:
        raise SystemExit("Os tokens do .env são da Control Gestão, não da Rey Festas. Parei.")
    precos: dict[str, Decimal | None] = {}
    for p in produtos:
        codigo = str(p.get("cod_produto", "")).strip()
        if CODIGO.fullmatch(codigo):
            valor = Decimal(str(p.get("valor_produto") or "0")).quantize(Decimal("0.01"))
            precos[codigo] = valor if valor > 0 else None
    if len(precos) < 200:
        raise SystemExit(f"O ERP devolveu só {len(precos)} produtos do catálogo. Parei.")
    return precos


def limpar(nome: str) -> str:
    """Tira o escape do Excel (_x0002_) que veio colado em nome de produto."""
    return re.sub(r"\s*_x[0-9a-f]{4}_", "", nome, flags=re.I).strip()


def reais(v: Decimal) -> str:
    inteiro, centavos = f"{v:.2f}".split(".")
    return f"R$ {int(inteiro):,}".replace(",", ".") + f",{centavos}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--planilha", action="store_true", help="usa o preço da planilha, sem ler o ERP")
    args = ap.parse_args()

    itens = ler_catalogo()
    precos = {i.codigo: i.valor for i in itens} if args.planilha else precos_do_erp()
    faltam = [i.codigo for i in itens if i.codigo not in precos]
    if faltam:
        print(f"Aviso: {len(faltam)} itens da planilha não estão no ERP e saem como 'valor com a equipe': {', '.join(faltam)}")

    linhas_ts, secoes = [], []
    for i in sorted(itens, key=lambda x: x.codigo):
        preco = precos.get(i.codigo)
        linhas_ts.append(
            f"  {{ codigo: {json.dumps(i.codigo)}, nome: {json.dumps(limpar(i.descricao), ensure_ascii=False)}, "
            f"categoria: {json.dumps(i.categoria, ensure_ascii=False)}, preco: {'null' if preco is None else f'{preco:.2f}'} }},"
        )
    # categorias na ordem em que aparecem na planilha (item acrescentado no fim volta para o grupo dele)
    for categoria in dict.fromkeys(i.categoria for i in itens):
        secoes.append(f"\n\n### {categoria}")
        for i in sorted((x for x in itens if x.categoria == categoria), key=lambda x: x.codigo):
            preco = precos.get(i.codigo)
            secoes.append(f"- {i.codigo} · {limpar(i.descricao)} · {reais(preco) if preco is not None else 'valor com a equipe'}")

    origem = "planilha docs/cliente/catalogo-produtos.xlsx" if args.planilha else "produtos do Control ERP Lite"
    DADOS_TS.write_text(
        "/**\n * CATÁLOGO DA REY FESTAS (gerado, não edite à mão).\n"
        f" * Fonte: {origem}. Gerar de novo: python scripts/catalogo_agente.py\n"
        " * preco null = \"valor com a equipe\": a IA não informa nem soma.\n */\n"
        "import type { ItemCatalogo } from './crm-map-types'\n\n"
        "export const CATALOGO: ItemCatalogo[] = [\n" + "\n".join(linhas_ts) + "\n]\n",
        encoding="utf-8",
    )

    prompt = PROMPT.read_text(encoding="utf-8")
    if INICIO not in prompt or FIM not in prompt:
        raise SystemExit(f"Marcadores {INICIO} / {FIM} não encontrados em {PROMPT}")
    antes, resto = prompt.split(INICIO, 1)
    _, depois = resto.split(FIM, 1)
    corpo = "".join(s if s.startswith("\n") else "\n" + s for s in secoes)
    PROMPT.write_text(f"{antes}{INICIO}{corpo}\n\n{FIM}{depois}", encoding="utf-8", newline="\n")

    sem_preco = sum(1 for i in itens if precos.get(i.codigo) is None)
    print(f"{len(itens)} itens ({sem_preco} com valor com a equipe) · fonte: {origem}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
