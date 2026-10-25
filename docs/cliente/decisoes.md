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

## Atualização de 06 e 07/10/2026 (sessão do Drive, unificada aqui em 24/10)

Respostas da Karol (financeiro, braço direito do Noel) pelo WhatsApp. Detalhe e
evidência em `docs/cliente/diagnostico.md` §7.1 e §7.2.

| # | Decisão | Origem |
|---|---|---|
| D5 | O app de locação é o **app Locações do VHSYS**. O Acercom (sistema atual) será desligado | Karol, 06/10 |
| D6 | Locação e financeiro (Stone, integração nativa) ficam no VHSYS; o GHL cuida da conversa, do funil de vendas e dos lembretes. O funil "Locação: Operação" no GHL foi criado e removido no mesmo dia | mestre, 07/10 |
| D7 | Sinal de 50%; restante até **1 dia antes** do evento; semana do evento = integral; **sem pagamento na entrega** (exceção só com a Karol) | Karol, 06-07/10 |
| D8 | Desconto **7%** à vista para todos, inclusive parceiros; acima disso só Karol ou Noel | Karol, 07/10 |
| D9 | Frete = km da loja ao local (rota de carro) × R$ 2 × 4 trechos, **mínimo R$ 50** | Karol, 06-07/10 |
| D10 | Retirada sábado 9h às 11h30; **não há devolução no sábado** (locação de fim de semana: sexta a segunda) | Karol, 06-07/10 |
| D11 | A IA **pode falar o preço de tabela**, avisando que o valor final é confirmado | Karol, 06/10 |
| D12 | **Preços de dezembro são os mesmos** do resto do ano | mestre, 06/10 |
| D13 | Lembretes automáticos de saldo, véspera da entrega e devolução: **sim** | Karol, 06/10 |
| D14 | Uma única instância de WhatsApp no GHL ("Atendimento"). Lista de exclusão: Noel, Diogo (motorista), Karol, Fabio (consultor) | Karol e mestre, 06/10 |
| D15 | A Karol atende do início ao fim e recebe o pedido da IA | mestre, 06/10 |

### O que muda nas decisões anteriores

- **D1 (proposta):** continua. A IA soma o pedido pela tabela (em código) e manda o
  resumo com valores; a Karol confere a disponibilidade no app Locações e manda o
  orçamento oficial. No funil, a etapa da IA se chama **"Pedido completo"** (é o
  "Proposta enviada" de D1).
- **D1, acréscimo de dezembro:** cancelado por D12.
- **D2 (buffet/evento):** **ainda não está no prompt nem no funil**. Falta: porta
  consultiva, calendário do consultor (Fabio?) e a etapa "Apresentação agendada".
- **D3:** resolvido por D5. O app Locações não tem API (testado em 07/10); a IA não
  consulta disponibilidade. Risco aberto: pelo manual, a reserva de estoque do app
  vale até a locação ser finalizada, sem olhar a data. Teste pedido ao cliente.
- **D4 (cliente no VHSYS):** continua. No prompt atual, o cadastro é pedido no fim
  da coleta (depois de itens, data e logística), como a equipe já faz hoje, e não
  na abertura.
- "Ainda em aberto" 2, 6 e 9: respondidos por D7 a D11 e pela carga do catálogo
  (209 produtos no VHSYS, `scripts/importar_catalogo.py`).

### Pendências desta parte

- Multa de cancelamento e taxa de higienização (Karol confirmando com o Noel).
- Nome da atendente virtual e link do catálogo com fotos.
- Teste de reserva por data no app Locações.
- Migração do Acercom: clientes (API) e locações futuras (lançamento manual no app).
- Valor de reposição dos 209 itens, quantidade de 34 e preço de 9 no VHSYS.
- Aprovação do documento `docs/cliente/Rey-Festas-Projeto-CRM-e-IA.pdf`.

## Jornada no GHL termina no aceite (25/10/2026)

| # | Decisão | Origem |
|---|---|---|
| D16 | A jornada no GHL vai até **Pedido fechado** (= o cliente aceitou o orçamento). Reserva, sinal, saldo e recebimento são tratados **no VHSYS**. "Aguardando pagamento" virou "Pedido fechado" (mesmo id) e "Reservado" sai do funil | mestre, 25/10 |
| D17 | Os lembretes de saldo, véspera e devolução (D13) **continuam no GHL**, disparados pelos campos de data do card | mestre, 25/10 |
| D18 | Card em Pedido fechado → **cliente e orçamento** criados no VHSYS (`agente-ia/lib/erp-sync.ts`). Atualiza D4: o gatilho deixa de ser "Ganho" e passa a ser "Pedido fechado"; a integração marca a oportunidade como Ganho | mestre, 25/10 |
| D19 | A etapa onde a IA entrega o pedido passa a se chamar **"Pronto para orçamento"** (era "Pedido completo", mesmo id): o nome diz o que a Karol faz com o card | mestre, 25/10 |
| D20 | **Locação sem o app Locações do VHSYS** (ele obriga a redigitar todos os itens e não tem API). O pedido de locação é o **pedido do VHSYS** gerado do orçamento da integração; financeiro e recebimento seguem no VHSYS. A disponibilidade sai de uma **agenda de reservas nossa** que lê os pedidos | mestre, 25/10 |

- O orçamento leva os itens com código do catálogo (o `cod_produto` da carga de 209
  itens), quantidade e preço da linha do card (ou o da tabela). Item sem código vai na
  observação para a Karol conferir.
- Cadastro existente no VHSYS **não é sobrescrito**: a integração só reaproveita o id.
- Idempotente: card com "Nº do pedido no ERP" preenchido não gera outro orçamento.
- O app Locações não tem API: a Karol lança a locação a partir do orçamento.
- Pendência: conferir os nomes dos campos do orçamento na API v2 no primeiro envio real
  (a documentação não abriu no ambiente da implantação). Começa em `ERP_MODO` ensaio.

### D20: como a locação é controlada sem o app Locações

- O orçamento da integração sai com a linha **`LOCAÇÃO: dd/mm/aaaa a dd/mm/aaaa`** na
  observação (retirada ou entrega → devolução ou recolha), calculada pelas regras da loja:
  último dia útil antes do evento → primeiro dia útil depois (fim de semana = sexta a
  segunda; sem devolução no sábado). Feriado não entra: a Karol ajusta a linha.
- Pagou o sinal, a Karol gera o **pedido** a partir do orçamento (um clique).
- **Agenda de reservas** (`GET /api/agenda`): lê os pedidos não cancelados com a linha
  LOCAÇÃO e calcula, por item e por data, total do estoque, pico reservado e livre.
  Orçamento não reserva; só pedido.
- Fases seguintes: contrato em PDF a partir do pedido; IA consultando a agenda.
- **Estoque = patrimônio da loja** (testado em 25/10/2026): o pedido do VHSYS não mexe
  no estoque nem no financeiro sozinho; cada um tem uma ação própria no menu do pedido.
  Gerar o pedido a partir do orçamento **não** lança estoque. "Lançar estoque" e "Estornar
  estoque" funcionam (o pedido ganha um ícone de caixa enquanto está lançado), mas o
  mestre escolheu o **modelo A** (25/10/2026): estoque = patrimônio, nunca lançado na
  locação. Lançar na saída e estornar na volta (modelo B) faria a agenda contar duas
  vezes e dependeria de ninguém esquecer o estorno.
  Na locação:
  - **Lançar contas**: sim (sinal e saldo entram em contas a receber);
  - **Lançar estoque**: **nunca** (a agenda bloqueia pelo período; lançar contaria duas vezes);
  - **Emitir nota fiscal / Emitir NFC-e**: **nunca** (emitem nota de VENDA; locação de bem
    móvel não é venda nem serviço);
  - **Alterar status → atendido**: marca a devolução (libera o material na agenda na hora);
  - item perdido ou quebrado: ajuste de estoque só da quantidade perdida + cobrança pelo
    valor de reposição.
  - Não usar Compras → Entrada de Mercadoria para devolução: exige fornecedor, mexe no
    custo médio, tem pagamento e polui compras e DRE.
- **Fiscal (25/10/2026, a confirmar com o contador)**: locação de bens móveis não é venda
  (sem ICMS, não muda a propriedade) nem serviço (STF, Súmula Vinculante 31: sem ISS; item
  vetado da LC 116/2003). O documento costuma ser a **fatura de locação** (o modelo do
  Acercom já tinha). No Simples, a receita de locação de bens móveis vai no Anexo III sem a
  parcela do ISS. Têm nota própria: frete e montagem (serviço; frete terceirizado é a
  transportadora que emite), buffet, decoração e cerimonial (NFS-e), material vendido de
  fato (NF de venda). No **Lançar contas**, usar a categoria de **receita de locação** do
  plano de contas, não de venda. Perguntas ao contador: (1) Atibaia exige NFS-e na locação
  mesmo sem ISS, ou basta a fatura? (2) precisa NF-e de remessa para o material sair e
  voltar? (3) frete cobrado na fatura da Rey Festas pede nota? (4) enquadramento no Simples.
- **Devolução pendente**: período da linha LOCAÇÃO vencido e o pedido não marcado como
  atendido. O material continua ocupando a agenda até hoje e o pedido aparece na lista
  `devolucoesPendentes` de `/api/agenda` (o "Devolução" do Acercom).
- Pendências: (1) conferir com `?bruto=1` o nome da situação "atendido" na API; (2) nomes dos campos de pedido na API (conferir com `?bruto=1`); (3) nota fiscal
  na locação (contador); (4) modelo de contrato (app ou o do Acercom).

## Plano de contas aplicado no VHSYS (24/10/2026)

- Proposta de 97 categorias **aprovada** pela Rey Festas.
- `scripts/categorias_vhsys.py --aplicar`: 97 criadas (ids 9875014 a 9875110); a
  simulação seguinte deu 97 existentes, 0 a criar, 0 conflitos.
- A pedido do mestre, as categorias padrão do VHSYS foram **excluídas** (vão para a
  lixeira, recuperáveis): 45 de 47.
- Mantidas por estarem em uso:
  - `OUTRAS DESPESAS`: conta a pagar em aberto "Rey Festas Gestão", R$ 400,
    vencimento 10/10/2026. Reclassificar numa categoria do plano e depois excluir.
  - `Saldo Inicial`: saldo de abertura no extrato da conta bancária. Não é linha do
    DRE; fica.
- Falta: ligar cada categoria ao grupo do DRE em Parâmetros > Categorias (a API não faz).

## DRE montado no VHSYS (24/10/2026)

O vínculo categoria → linha do DRE no VHSYS não fica na categoria: fica num
**modelo de DRE** (Financeiro > DRE Gerencial > Gerenciar modelos). Criado o modelo
**"DRE Rey Festas"** pela tela (a API não cobre), com 12 grupos na ordem da proposta:

| Grupo | Tipo no VHSYS | Categorias |
|---|---|---|
| (+) Receita bruta | Receita | 10.01, 10.02 |
| (-) Deduções da receita | Despesa | 20.01.01-02, 20.02.01-02 |
| (=) Receita líquida | Totalizador | Receita bruta + Deduções |
| (-) Custos dos serviços | Despesa | 30.01.01-05, 30.02.01-06, 30.03.01-04, 30.04.01-03 |
| (=) Margem de contribuição | Totalizador | + Custos |
| (-) Despesas com pessoal | Despesa | 40.01.01-09 |
| (-) Despesas administrativas e comerciais | Despesa | 50.01.01-14, 50.02.01-04 |
| (=) Resultado operacional | Totalizador | + Pessoal + Administrativas |
| (+/-) Resultado financeiro | Receitas e Despesas | 10.03.01-03, 50.03.01-05 |
| (+/-) Resultado não operacional | Receitas e Despesas | 60.01.01, 60.01.05, 70.01.01 |
| (=) Resultado líquido | Totalizador | + Financeiro + Não operacional |
| Abaixo do resultado: investimentos, empréstimos e retiradas | Receitas e Despesas | 60.01.02-03, 70.02.01-04, 70.03.01-02, 90.01.01 |

- 71 categorias vinculadas (as 73 lançáveis menos 60.01.04 e 70.01.02, transferências,
  fora do DRE). Títulos (10, 20.01...) não entram: não recebem lançamento.
- Conferido após recarregar a página e gerando o relatório DRE Gerencial anual 2026.
- Cicatrizes da tela: o nome do grupo com "−" (sinal de menos Unicode) dá "Erro
  interno do servidor"; usar "-". Grupo novo entra no topo e categoria nova entra no
  topo do grupo (dentro de cada grupo a ordem ficou decrescente, só estética).
- A conta a pagar "Rey Festas Gestão" (R$ 400) era teste e foi excluída pelo mestre;
  `OUTRAS DESPESAS` foi excluída em seguida. A conta ficou com as 97 categorias do
  plano + `Saldo Inicial` (saldo de abertura do banco, fora do DRE).

## Migração do Acercom (LocPlus 5.4.25): levantamento (24/10/2026)

- O LocPlus roda numa sessão remota HTML5 (canvas): não há texto na página, nem
  exportação, nem cópia da grade. Exportar pelo programa salva no servidor da Acercom.
- **Clientes:** códigos até ~9.400. Caminho recomendado: exportação pedida ao suporte
  da Acercom (mensagem pronta enviada ao mestre). Decisão pendente: migrar todos ou só
  quem alugou nos últimos 2-3 anos.
- **Pedidos em aberto** (tela Devolução), lidos um a um em 24/10: **100 pedidos**.
  - 54 **futuros** (evento depois de 24/10): out 7, nov 35, dez 10, mar/2027 2; 44
    clientes; 14 da MRV. São estes que vão para o app Locações.
  - 26 em andamento (devolução até ~28/10): terminar no Acercom.
  - 20 com devolução vencida (14 a 23/10): provável falta de baixa; Karol confirma.
  - Lista com nomes e telefones em `dados/` (fora do git).
- **Cicatriz:** o "Detalhe" da tela Devolução é o formulário de baixa (vem com data
  efetiva = hoje e Retorno preenchido). Não usar para leitura; um Enter registra a
  devolução. Itens dos pedidos: ler por relatório (somente leitura) ou pela exportação.
- **Decisão (24/10/2026, mestre): pedidos não serão migrados.** O escopo da migração do
  Acercom é só cadastro: **clientes, fornecedores e produtos**. Os pedidos em aberto
  terminam no Acercom.

### Situação em 25/10/2026

- **Aguardando a exportação da Acercom** (clientes, fornecedores e produtos em Excel/CSV),
  pedida pela Rey Festas. Os arquivos vão para `dados/` (fora do git).
- Nenhuma listagem imprimível de cadastro foi encontrada no LocPlus. "Clientes por
  Tabela" é só um resumo por tabela de preço (18.949 pedidos no histórico).
- **Cicatriz:** não automatizar cliques no LocPlus. Com o atraso da sessão remota, um
  clique de menu caiu dentro da tela de Produtos e abriu um registro novo vazio (o
  sistema recusou por falta de nome; a Rey Festas cancelou a linha). Antes, o Detalhe da
  Devolução se mostrou um formulário de baixa. Leitura só por relatório ou exportação.
- Quando os arquivos chegarem: importar clientes e fornecedores no VHSYS pela API
  (`/clientes`, com `tipo_cadastro`), conferindo CPF/CNPJ antes de criar; casar
  produtos pelo código antigo (está na observação dos 209 produtos) e completar o
  preço de reposição.
