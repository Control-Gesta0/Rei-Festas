# Rey Festas: decisões do diagnóstico

Estado do projeto: `DIAGNOSTICANDO`. CRM: GoHighLevel. ERP: VHSYS (ERP Lite + app de locação).

## Decidido pelo cliente (06/10/2026)

| # | Decisão | Origem |
|---|---|---|
| D1 | Na **locação**, a IA vai até a **proposta** | mestre |
| D2 | No **buffet/evento**, a IA apresenta as soluções e **agenda uma apresentação com um consultor**, que envia a proposta | mestre |
| D3 | O VHSYS tem um **app de controle de locação** | mestre |
| D4 | No fim do processo, o **cliente é replicado no VHSYS** | mestre |

## Como cada decisão vira desenho

### D1: proposta de locação feita pela IA, dentro de um limite seguro

A lei 2 da skill põe o limite do agente no "Agendado", porque proposta e negociação
são do closer. Aqui ela se adapta sem ser violada. A proposta de locação é uma
**tabela de preço aplicada a uma lista de itens**, sem negociação. A IA pode enviá-la
se valerem estas travas:

- **O valor é calculado em código, nunca pelo modelo.** O total é quantidade x preço
  unitário do VHSYS, com o acréscimo de dezembro aplicado em código. LLM errando
  conta numa proposta é dinheiro perdido ou cliente irritado.
- **A etapa máxima da IA é "Proposta enviada".** Desconto, negociação, mudança de
  condição, reserva confirmada e "Ganho" ficam com o humano. As tools são
  fail-closed acima dessa etapa.
- **Item sem preço confiável não entra na proposta.** Hoje são os 9 itens com
  placeholder no catálogo. A IA avisa que um consultor confirma o valor.
- **A proposta não garante disponibilidade.** Ela sai como "sujeita à confirmação de
  disponibilidade para a data" até termos uma fonte de disponibilidade (ver D3).

### D2: buffet e evento

É uma porta consultiva. A IA apresenta a linha (buffet, cerimonial, decoração, som,
estrutura), coleta data, local, número de convidados, tipo de evento e faixa de
orçamento, e agenda no calendário do GHL. A etapa máxima é "Apresentação agendada".

### D3: o app de locação não aparece na API pública do VHSYS

Consultei https://developers.vhsys.com.br/api/ em 06/10/2026. A API pública expõe
clientes, produtos e estoque, orçamentos, pedidos, OS, financeiro, notas e
webhooks. **Não há endpoint do módulo de locação** (contrato, reserva ou
disponibilidade por data).

Consequência: a IA **não consegue consultar disponibilidade por data** pela API
hoje. O "Consultar estoque" devolve o saldo do produto, não a agenda de locações.
Rotas possíveis, a decidir:

- (a) perguntar ao suporte do VHSYS se o app de locação tem API ou webhook;
- (b) a proposta sai sujeita a confirmação e o humano confere a agenda no app;
- (c) usar o estoque total como teto ("temos 300 cadeiras Tiffany") sem prometer a data.

### D4: replicar o cliente no VHSYS

Existe na API (`Cadastrar cliente`, `Listar clientes`). O desenho:

- Gatilho: o card chega em **Ganho** no GHL, movido pelo humano. Um webhook do
  workflow chama nosso endpoint.
- Antes de cadastrar, buscamos pelo CPF/CNPJ no VHSYS para não duplicar. Se o
  cliente já existir, atualizamos o cadastro e reaproveitamos o ID.
- Gravamos o ID do VHSYS num campo do contato no GHL, o que fecha o vínculo.
- Os dados de cadastro (CPF/CNPJ, endereço) **não são pedidos pela IA na abertura**,
  porque pedir documento cedo derruba a conversa. Eles são coletados no aceite da
  proposta, pelo humano ou pela IA quando o lead disser que quer fechar.
- Pendência: confirmar se o cliente quer que o **orçamento** também seja criado no
  VHSYS (`Cadastrar orçamento` existe na API) e se o contrato de locação vai junto.

## Modelo de proposta enviado pelo mestre (06/10/2026)

O PDF de exemplo (5 páginas: orçamento, fatura de locação, 1ª via cliente com termo de
responsabilidade, 2ª via retorno) **não foi gerado pelo VHSYS**. O rodapé diz
"Acercom Solução Digital, www.acercom.com.br", e a Acercom vende um sistema de
"Locação de materiais para Eventos". Hipótese forte: o "app de controle de locação"
é o Acercom, não um módulo do VHSYS. **Confirmar com o cliente.** Se for isso, a
fonte de disponibilidade, preço de reposição e código de item é o Acercom, e
precisamos saber se ele tem API ou banco acessível.

O arquivo tem dados pessoais reais de uma cliente (CPF, RG, endereço, telefone).
Ele **não foi copiado para o repositório**. Só a estrutura está registrada aqui.

### O que o documento ensina sobre o pedido de locação

| Campo | Exemplo (sem dado pessoal) | Impacto no agente |
|---|---|---|
| Itens | quantidade, descrição, código (`TC0032`), unitário, total | a IA monta a lista; o código vem do sistema |
| Preço de reposição | toalha pranchão R$ 150, toalha 1,50 R$ 30 | não entra na conversa de venda; vai no documento oficial |
| Datas | entrega, evento, devolução | a IA coleta as três (ou só o evento e deduz com regra) |
| Nº de diárias | 1,000 | "demais diárias" encarecem; regra a confirmar |
| Logística | entrega × cliente retira; devolução × retirada | a IA pergunta, e o frete depende disso |
| Local do evento | endereço completo | coletado no aceite |
| Condição de pagamento | à vista, com vencimento | regra a confirmar |
| Desconto | 10% no exemplo (490 → 441) | **a IA não dá desconto**; fica com o humano |
| Vendedor | nome da atendente | dono do card no GHL |

Item que não está no catálogo do site: **toalha pranchão preta 3,50 m, R$ 40**.
Isso confirma que o catálogo público está incompleto e não pode ser a fonte de preço.

### Termos do contrato que a IA precisa saber (e não pode inventar)

- Montagem **não** está incluída: a equipe de entrega não monta.
- Material devolvido sujo: **20% do valor da locação** como taxa de higienização.
- Falta ou avaria: cobrada pelo preço de reposição na devolução.
- Atraso na devolução: novas diárias.
- Cancelamento após assinatura: **multa de 50%**, que pode virar crédito em até
  6 meses, sujeito a disponibilidade.
- A empresa pode substituir material por similar ou superior.
- Razão social: JN dos Reis Locações, Festas e Eventos EPP. Fones 98122-3778 e
  3402-0462. E-mail atendimento@reyfestas.com.br.

### Consequência para D1 (a proposta da IA)

A proposta oficial é o documento do sistema de locação, com número, termo e
assinatura. A IA não deve fingir emitir esse documento. O desenho proposto:

1. A IA envia um **orçamento prévio** no WhatsApp (itens, quantidades, valores
   calculados em código, datas, logística, condições e os termos principais acima).
2. O card vai para "Proposta enviada" com os itens gravados no GHL.
3. Quando o lead aceita, o humano confere a disponibilidade, emite o orçamento
   oficial no sistema de locação, aplica desconto se quiser e fecha.
4. No Ganho, o cliente é replicado no VHSYS (D4).

Se o sistema de locação tiver API, o passo 3 pode ser automatizado depois.

## Ainda em aberto

1. Fonte de disponibilidade por data (D3).
2. Frete e entrega: regra de cobrança, pedido mínimo, sinal ou caução.
3. Quem é o consultor de buffet, com qual calendário e horários.
4. Se a proposta de locação vai como texto no WhatsApp ou como PDF.
5. Se os preços do catálogo estão atualizados e quem corrige os 9 itens com placeholder.
6. Se o cadastro de produtos no VHSYS tem os mesmos itens e preços do catálogo.
7. Os campos obrigatórios do cadastro de cliente no VHSYS.
8. O app de locação é o Acercom? Ele tem API? Qual o papel do VHSYS então
   (financeiro, cadastro, os dois)?
9. Regras de diária, desconto à vista e condição de pagamento padrão.
