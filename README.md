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
| `docs/cliente/diagnostico.md` | Diagnóstico de 184 conversas de WhatsApp e regras comerciais confirmadas |
| `docs/cliente/Rey-Festas-Projeto-CRM-e-IA.pdf` | Documento de aprovação do CRM e da IA enviado ao Noel e à Karol |
| `docs/cliente/catalogo-produtos.xlsx` | Catálogo de 209 itens (fonte da carga no VHSYS) |
| `scripts/importar_catalogo.py` | Carga do catálogo no VHSYS: categorias de produto, produtos e estoque inicial (rodado em 06/10/2026) |
| `scripts/ghl_estrutura.py` | Funil "Locação: Vendas" e 20 campos no GoHighLevel (rodado em 06/10/2026) |
| `agente/prompt.md` | Rascunho do prompt da atendente virtual (v0.1) |
| `agente/catalogo_prompt.md` | Tabela de preços gerada da planilha para o prompt |
| `agente/evals.md` | 14 cenários de teste do prompt |

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

## Credenciais

Copie `.env.example` para `.env` (o git ignora) com os tokens da conta da Rey Festas.
Antes de gravar qualquer coisa no VHSYS, confira na simulação que a conta é a da Rey
Festas: produtos LOU-/MOB- e categorias padrão "Produto", "Serviço", "Vendas". Se
aparecer "10.01 - VENDAS" ou "LICENÇAS CONTROL ERP PRO", os tokens são da Control
Gestão: pare.

## Catálogo e CRM

```
python3 scripts/importar_catalogo.py              # ensaio, nada é gravado
python3 scripts/importar_catalogo.py --executar   # cria o que falta, sem duplicar
python3 scripts/ghl_estrutura.py                  # ensaio do funil e campos no GHL
```

## Testes

```
python3 -m pytest -q
```
