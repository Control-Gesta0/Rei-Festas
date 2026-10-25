# Agente de IA · Rey Festas (GHL)

Atendente virtual do WhatsApp da Rey Festas. Roda na Vercel, lê e escreve no GHL
e usa a OpenAI. Recebe quem quer alugar, monta o pedido completo (itens, data,
entrega ou retirada, cadastro) e passa para a Karol no card "Pronto para orçamento".
Não confirma disponibilidade, não reserva e não recebe pagamento.

Motor: template de agente da Control Gestão (GHL + OpenAI + Upstash, sem n8n).

## Como funciona

```
Cliente manda mensagem no WhatsApp (instância "Atendimento")
  → Workflow do GHL "Customer Replied" (só contatos com a tag ia-ativa)
  → POST /api/inbound  (responde 200 na hora; o resto roda em segundo plano)
      1. tag atendimento-humano ou sem a tag de gate? não responde
      2. espera 10s (rajada de mensagens vira UMA resposta)
      3. lê a conversa no GHL (áudio e foto viram texto)
      4. alguém da equipe respondeu nas últimas 6h? a IA não entra
      5. GPT + ferramentas: soma o pedido pela tabela (calcular_tabela), grava
         os campos do card, move a etapa (só para frente) e finaliza
      6. travas em código (disponibilidade, Pix, desconto, multa, travessão)
      7. envia pelo GHL e registra no diário
```

Jornada no funil "Locação: Vendas" (o GHL vai até o aceite):

| Etapa | Quem move |
|---|---|
| Novo contato → Coletando pedido → Pronto para orçamento | IA |
| Orçamento enviado → **Pedido fechado** (o aceite) | Karol |

Daí para a frente (reserva no app Locações, sinal, saldo, recebimento) é tudo no VHSYS.
Os lembretes de saldo, véspera e devolução continuam no GHL, pelos campos de data do card.

## Pedido fechado → VHSYS

Card em **Pedido fechado** → workflow do GHL → `POST /api/erp`. O agente:

1. busca o cliente no VHSYS pelo CPF/CNPJ e cadastra se não existir (não sobrescreve cadastro existente);
2. cria o **orçamento** com os itens do card (código do catálogo, quantidade, preço da linha ou da tabela) e uma observação com data, entrega/retirada, endereço e evento;
3. volta no GHL: nº do orçamento no campo "Nº do pedido no ERP", id do cliente em "ID no ERP", nota, tag `erp-sincronizado` e oportunidade como **Ganho**.

Deu errado (sem CPF, item sem código, VHSYS fora): tag `erp-erro` e nota com o motivo; corrija e mova o card de novo.
Card que já tem nº do pedido no ERP não gera outro orçamento.

**Locação sem o app Locações (D20).** O pedido de locação é o **pedido do VHSYS** gerado do
orçamento (um clique). O orçamento já sai com a linha `LOCAÇÃO: dd/mm/aaaa a dd/mm/aaaa`
(período padrão pelas regras da loja; a Karol ajusta). A agenda de reservas lê os pedidos:

`GET /api/agenda?secret=…&data=20/11/2026` (ou `&de=…&ate=…`) → por item: total, reservado (pico no
intervalo), livre e os pedidos que ocupam; mais `devolucoesPendentes` (período vencido sem "atendido") e
`hoje` (pedidos que saem e voltam hoje). `&bruto=1` mostra os campos como o VHSYS devolve.

Modelo A: o estoque do VHSYS é o patrimônio. No pedido de locação: **Lançar contas** sim, **Lançar
estoque** nunca, **Alterar status → atendido** na devolução; perda vira ajuste de estoque.

`ERP_MODO=gravar` grava no VHSYS; sem isso é **ensaio** (lê e mostra o plano). Conferência manual,
sempre em ensaio: `GET /api/erp?secret=…&contact_id=…`.

Workflow do GHL: gatilho **Etapa do pipeline alterada** (Locação: Vendas → Pedido fechado) → Webhook
`POST /api/erp?secret=…` com Dados personalizados `contact_id = {{contact.id}}` e `opportunity_id = {{opportunity.id}}`.

## Arquivos da Rey Festas (o resto é motor)

| Arquivo | O que tem |
|---|---|
| `prompts/nucleo.md` | quem é a atendente, o que nunca faz, tom, ferramentas |
| `prompts/portas/locacao.md` | assunto, montagem do pedido, regras da loja, catálogo |
| `lib/crm-map.ts` | IDs do funil e dos campos do GHL, roteiro, tags de finalização |
| `lib/catalogo-dados.ts` | tabela de preços (gerada) |
| `lib/regras.ts` | travas de texto |
| `evals/cenarios.ts` | exame do cérebro (todos aprovados ou não sobe) |
| `scripts/test-cliente.ts` | testes das travas, datas, soma e campos condicionais |

O catálogo e a seção de preços do prompt saem do Control ERP. Mudou preço no ERP:

```bash
python scripts/catalogo_agente.py
```

(rodar da raiz do repositório; depois `npm test`, evals e deploy)

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

Obrigatórias: `GHL_TOKEN` · `GHL_LOCATION_ID` · `OPENAI_API_KEY` · `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` · `WEBHOOK_SECRET`
Operação: `CLIENT_NAME` (Rey Festas) · `GATE_TAG` (ia-ativa) · `HUMAN_TAG` (atendimento-humano) · `REDIS_PREFIX` (agente-reyfestas:) · `TEST_CONTACT_IDS`
Opcionais: `LLM_MODEL` · `VISION_MODEL` · `STT_MODEL` · `TIMEZONE` · `DEBOUNCE_SECONDS` · `GHL_CHANNEL` (`SMS` na Rey Festas: a ponte ZaptosWPP entra como provedor de SMS)
ERP: `VHSYS_ACCESS_TOKEN` · `VHSYS_SECRET_ACCESS_TOKEN` · `ERP_MODO` (`gravar` para valer)

Local: os scripts leem `agente-ia/.env.local` e o `.env` da raiz do repositório. Env da Vercel só vale em deploy novo.

## Ordem de go-live

1. `npm test` e `npm run evals` (todos aprovados).
2. Deploy na Vercel com as envs. `GET /api/inbound` → `redis: true`.
3. `GET /api/validate?secret=…` → `ok: true`.
4. No GHL:
   - tag `atendimento-humano` nos contatos da equipe (Noel, Diogo, Karol, Fabio): a IA nunca responde a eles;
   - workflow "Customer Replied" + condição tag `ia-ativa` → Custom Webhook POST `/api/inbound?secret=…` com `contact_id = {{contact.id}}`;
   - desligar o Conversation AI nativo e as respostas automáticas do WhatsApp Business (senão dois robôs respondem);
   - permitir oportunidade duplicada no funil (cliente que volta com pedido novo ganha card novo).
5. Teste com um número real (tag `ia-ativa` só nele). Rampagem: 1 contato → 10 → todos.

## Endpoints

| Endpoint | Para quê |
|---|---|
| `GET /api/inbound` | saúde: `{ok, redis}` |
| `POST /api/inbound?secret=…` | webhook do workflow do GHL |
| `GET /api/discover?secret=…` | lê funis, campos, calendários e tags do GHL |
| `GET /api/validate?secret=…` | compara o mapa com o GHL vivo |
| `GET /api/executions?secret=…` | diário: cada resposta, ferramenta usada, custo e erros |
| `GET /api/evals?secret=…` | roda os cenários na Vercel |
| `POST /api/erp?secret=…` | webhook do workflow "Pedido fechado": cliente e orçamento no VHSYS |
| `GET /api/erp?secret=…&contact_id=…` | ensaio da sincronização com o VHSYS (não grava) |
| `GET /api/agenda?secret=…&data=dd/mm/aaaa` | agenda de reservas: quanto de cada item está livre na data |

## Fora desta versão

- Buffet e evento com agenda do consultor (hoje a IA só passa o caso com a tag `ia-buffet`).
- Lembretes de saldo, véspera e devolução (D13): workflow do GHL, fase seguinte.
- Resposta por voz e follow-up automático.
