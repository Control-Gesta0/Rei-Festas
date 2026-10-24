# Rey Festas

Projeto da Rey Festas (JN dos Reis Locações, Festas e Eventos EPP), Atibaia/SP,
implantado pela Control Gestão. ERP: VHSYS (ERP Lite). CRM: GoHighLevel.

Este repositório é só da Rey Festas. Código, credenciais e contas da Control Gestão
ficam no projeto dela e não entram aqui.

## Conteúdo

| Caminho | O que é |
| --- | --- |
| `docs/cliente/estudo-site.md` | Estudo do site e do catálogo |
| `docs/cliente/catalogo-slides-2026-10-06.txt` | Catálogo de preços extraído |
| `docs/cliente/decisoes.md` | Decisões do diagnóstico |
| `docs/cliente/Rey-Festas-Plano-de-Contas-e-DRE.pdf` | Proposta de plano de contas e DRE (97 categorias) |
| `scripts/categorias_vhsys.py` | Cria no VHSYS as categorias do plano de contas |
| `scripts/vhsys_api.py` | Cliente mínimo da API do VHSYS |

## Plano de contas no VHSYS

Use um ambiente só da Rey Festas, com `VHSYS_ACCESS_TOKEN` e
`VHSYS_SECRET_ACCESS_TOKEN` da conta dela.

```
python3 scripts/categorias_vhsys.py --csv de-para.csv   # simula e grava o de-para
python3 scripts/categorias_vhsys.py --aplicar           # cria o que falta
```

O script não grava nada se encontrar conflito de código, nem cria a mesma
categoria duas vezes. O vínculo de cada categoria com a linha do DRE (grupo
financeiro) é feito depois, na tela Parâmetros > Categorias do VHSYS.

## Testes

```
python3 -m pytest -q
```
