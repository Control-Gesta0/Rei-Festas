# Rey Festas · Diagnóstico para implantação de CRM + agente de IA

Estado do projeto: **DIAGNOSTICANDO** (CRM definido: GoHighLevel).
Data: 06/10/2026. Fontes: site reyfestas.com.br, conta GHL ao vivo, 184 conversas de WhatsApp (16/09 a 06/10/2026, 3.586 mensagens), catálogo de 209 itens já carregado no Control ERP Lite.

Arquivos de apoio nesta pasta: `conversas_ghl.json` (export bruto), `transcricao.txt` e `parte1..4.txt` (leitura). **Contêm dados pessoais de clientes (CPF, RG, endereço). Não compartilhar fora da Control Gestão.**

---

## 1. O negócio

- J.N. dos Reis Locações, Festas e Eventos (marca Rey Festas), Av. São João, 1649, Atibaia-SP. Desde 2006, mais de 7.000 clientes segundo o site.
- Vende **locação de artigos para festa**: mesas, cadeiras, toalhas e tecidos, louças, talheres, copos e taças, rechauds e utensílios de buffet, mobiliário (bistrô, rústico), decoração, alguns equipamentos. O site também cita buffet, cerimonial e organização, mas nas conversas isso aparece só em 2 ou 3 casos, e sempre pela mão do dono.
- Área: região bragantina, SP capital, Vale do Paraíba, Campinas, sul de Minas. Na prática quase tudo é Atibaia e cidades vizinhas.
- Equipe vista nas conversas: Noel (dono, repassa leads e autoriza desconto), Adriana, Isabele, Val, Carol/Karol (atendimento e financeiro), Diogo (motorista/expedição).
- Horário: seg a sex 8h às 17h30, sáb 8h às 12h. Domingo e feriado fechado.

### Perfis de cliente (portas)

| Perfil | Peso | O que muda |
|---|---|---|
| Pessoa física: aniversário, almoço em casa, chá, feijoada | maior volume, ticket baixo (R$ 60 a R$ 900), pedido para o mesmo dia ou mesma semana | precisa de resposta rápida e regra clara de pagamento integral |
| Casamento (noivos ou assessora) | menos frequente, reserva com 2 a 6 meses | sinal 50%, várias versões de orçamento, decisão de terceiros |
| Profissional recorrente: decoradora, assessora, buffet, espaço de eventos | volume constante | já tem cadastro, desconto de parceria, conversa informal e direta |
| Empresa, escola, igreja, condomínio | médio | CNPJ, fatura, boleto, PO, nota |

---

## 2. O que as conversas mostram (184 conversas)

### Mistura do número

| Tipo | Conversas (aprox.) |
|---|---|
| Orçamento novo | ~87 |
| Cliente recorrente / pedido em andamento | ~34 |
| Logística, devolução, avaria, cobrança | ~34 |
| Interno: dono, motorista, fornecedor, parceiro | ~14 |
| Spam / sem conteúdo | ~15 |

**Metade do volume não é venda nova.** O mesmo WhatsApp é balcão de vendas, SAC de logística, grupo do motorista e até assunto pessoal (C140). Isso decide o gate da IA.

### Números medidos (código, não estimativa)

| Métrica | Valor |
|---|---|
| Mensagens recebidas | 1.798 (131 áudios de cliente) |
| Recebidas fora do horário | 114 (6%) |
| 1ª resposta humana em horário comercial | mediana 5 min · p75 14 min · p90 51 min · 14% acima de 30 min |
| 1ª resposta a mensagem fora do horário | mediana 13h30 |
| Conversas que terminam com o cliente sem resposta humana | 48 de 184 |

Leitura honesta: a equipe responde rápido no horário. **Vender a IA como "atendimento 24h" é argumento fraco aqui** (6% do volume). O dinheiro está em outras quatro coisas:

1. **Orçamento que morre sem follow-up.** Dezenas de orçamentos ficam "em aberto" sem nenhuma retomada (C013, C026, C029, C031, C043, C111, C128, C130, C150, C153, C176, C184...). C049 ficou 14 dias parado. Os poucos follow-ups feitos funcionaram ("Podemos seguir com seu pedido?", C165).
2. **Coleta de dados desorganizada e retrabalho.** Orçamento com item faltando, cliente errado, data errada, valor que não bate (C072 com 5 versões, C107, C159 recebeu orçamento de outra cliente, C160 contrato com data errada, C129 saldo divergente). A atendente pergunta de novo o que o cliente já disse.
3. **Regras ditas de jeito diferente por cada atendente.** Ver §4.
4. **Robôs atuais quebrados** (§3), que confundem o cliente na primeira mensagem.

### Jornada real observada

```
1º contato → boas-vindas automática → triagem ("em que posso ajudar?")
→ catálogo / fotos dos itens → itens + quantidades → data → entrega ou retirada → endereço (frete)
→ "já tem cadastro?" → ficha (nome, RG, CPF, e-mail, tel, endereço, data/hora/endereço do evento)
→ orçamento em imagem/PDF do sistema ("veja se está tudo certo")
→ aprovação → Pix CNPJ (Inter) / link Stone ou Mercado Pago / boleto (empresa)
→ comprovante → "faturar e mandar para expedição" → fatura/contrato PDF
→ agendar período de entrega + nome de contato   OU   retirada na loja
→ entrega/retirada → lembrete de devolução (Cláusula 6) → devolução → (avaria / falta / estorno)
```

Número de convidados quase nunca é perguntado. Tipo de evento, às vezes. Conferência formal de devolução não aparece no WhatsApp.

### Perguntas mais frequentes

1. Tem o item X? Tem para a data Y? (~45)
2. Quanto custa? (~40)
3. Forma de pagamento, sinal, Pix, parcela (~30)
4. Entrega, frete e horário do motorista (~30)
5. Itens que a loja não tem: tenda, freezer, capa de cadeira, banqueta, rechaud elétrico, telão (~20)
6. Horário de retirada e devolução, a loja abre amanhã? (~20)
7. Fotos, cores, medidas, quantas pessoas cabem na mesa (~15)
8. Alterar pedido (~10)
9. Catálogo não abre (~6)
10. Vem limpo? Preciso devolver lavado? (~5)

### Motivos de perda vistos

- Item que não tem ou sem estoque na data (o mais comum: freezer, tenda, taças a menos, mesas em manutenção).
- Pedido para hoje/amanhã e a loja não alcança, ou o cliente achou em outro lugar primeiro.
- Cliente cotando concorrente e sumindo depois do orçamento.
- Frete que o cliente não sabia que existia.
- Exigência de pagamento integral para evento próximo.
- Decisão de terceiros (esposa, noivos, comissão do condomínio).
- Ninguém respondeu (C084, C102, C171).

---

## 3. Estado do CRM (GHL ao vivo, 06/10/2026)

| Item | Situação |
|---|---|
| Pipeline | 1, "Marketing Pipeline" padrão em inglês (New Lead → Closed) |
| Oportunidades | 4, todas de exemplo ("(Example) Deal with...") |
| Campos personalizados | nenhum |
| Tags | atendimento, follow-up, high priority, warm lead, whatsapp |
| Workflows | nenhum |
| Calendários | nenhum |
| Contatos | 184, todos vindos do WhatsApp |
| Canal | mensagens entram como `TYPE_SMS` com "Instance Source: Atendimento" → **ponte não oficial** (instância própria tipo uazapi/Evolution), não WhatsApp Cloud API |

O CRM hoje é só um espelho do WhatsApp. Nenhum dado de negócio é registrado.

**Robôs atuais (fora do GHL, provavelmente na própria ponte ou no WhatsApp Business):**
- Boas-vindas fala em "orçamento de dezembro" desde setembro.
- O link "catálogo completo" aponta para `wa.me/5511981223778` (abre conversa), não para o catálogo `wa.me/c/...`. Gera "o catálogo não abre".
- Texto cortado no fim ("Estamos à disposição para tornar").
- Dispara para spam, cliente recorrente, motorista e parceiro.
- Fora-do-horário dispara junto com a boas-vindas e às vezes em horário comercial (sáb 10:15, C028; 13:33, C139).
- Lembrete de devolução saiu com data errada ("hoje, dia 21/09" enviado em 22/09) e com "dia __/__" sem preencher.

---

## 4. Regras comerciais: o que foi dito e onde há contradição

| Tema | O que aparece | Contradição a resolver com o cliente |
|---|---|---|
| Sinal | 50% na contratação para reservas com 15+ dias; restante até 5 dias antes; semana do evento = integral; data garantida só após pagamento | Regras internas (C068) dizem restante "até 1 dia antes". Exceções: 50% na entrega (C177), pagar na devolução (C046), restante na retirada (C029) |
| Cartão | link Stone/Mercado Pago, até 3x sem juros, link expira em 24h; maquininha fica na loja | |
| Desconto | à vista | **7%** (C031, C072, C091) × **10%** (C107, C178, "o Noel dava 10") × 20% autorizado pelo dono (C016). Desconto não vale para o frete |
| Frete | terceirizado, cobrado à parte, calculado pelo endereço; 2 idas e 2 voltas | Valores de R$ 15 a R$ 160 sem tabela visível. Cliente se surpreende com o frete (C009, C091) |
| Entrega | véspera do evento; recolha no dia útil seguinte; só térreo; condomínio só na portaria; estrada de terra avisar antes | |
| Retirada na loja | seg a sex 8h às 17h | Sábado: "8 às 11", "9 às 12", "até 11 para retirar e 12 para entregar" |
| Devolução | até 17h do dia combinado; depois disso, novas diárias (Cláusula 6) | Exceções dadas sem critério ("não vamos cobrar as diárias", C109) |
| Higienização | louça e talher voltam lavados; toalha não precisa; mancha, furo ou rasgo cobra taxa; contrato fala em 20% de taxa de higienização | Cliente reclamou de item sujo na entrega (C010, sem resposta) |
| Avaria | cobrada por peça, pelo preço de reposição; "recibo de quebra"; boleto anulado se a peça voltar | |
| Cancelamento | contrato: multa de 50%, conversível em crédito por 6 meses | Nunca citado nas conversas |
| Antecedência | "normalmente 1 ou 2 semanas, dependendo da quantidade" | Na prática fecham para o mesmo dia |
| Tabela | catálogo vale de janeiro a novembro; dezembro tem tabela própria | Preços de dezembro não estão em lugar nenhum |
| Não alugam | tenda (indicam parceira Bianca), freezer, capa de cadeira, banqueta, cadeira de ferro, rechaud elétrico e de 3 cubas, telão, almofada sem a cadeira | |

**Antes de escrever o prompt, a Rey Festas precisa fechar uma versão única destas regras.** Prompt com regra contraditória faz a IA prometer o que a atendente depois desmente.

---

## 5. Proposta de modelo de implantação

### 5.1 Funil no GHL (jornada = etapas, processo = campos)

**Pipeline "Locação: Vendas"** (onde a IA atua)

| Etapa | Entra quando |
|---|---|
| Novo contato | chegou mensagem de orçamento novo |
| Coletando pedido | cliente começou a passar itens, data ou local |
| Pedido completo | itens + quantidades + data + entrega/retirada + endereço + cadastro completos. **Fim da alçada da IA** |
| Orçamento enviado | humano conferiu disponibilidade, gerou o orçamento no sistema e enviou |
| Aguardando pagamento | cliente aprovou |
| Reservado | sinal ou pagamento integral confirmado (= ganho) |

Perdido = status com campo **Motivo da perda** (lista fechada: sem o item, sem estoque na data, preço, frete, fechou com outro, evento cancelado, prazo curto demais, sem resposta).

**Pipeline "Locação: Operação"** (opcional, a decidir; ver §7) do Reservado até o encerramento: Saldo pendente → Pago e liberado → Entrega/retirada agendada → No evento → Devolução pendente → Encerrado (com campo Avaria/falta).

### 5.2 Campos

Oportunidade: data do evento · tipo de evento · nº de convidados · entrega ou retirada · endereço e cidade do evento · itens solicitados (texto) · valor do orçamento · nº do pedido no sistema · forma de pagamento · sinal pago (sim/não) · data de devolução · motivo da perda.
Contato: perfil (pessoa física / decoradora-assessora / buffet-espaço / empresa-igreja-escola) · CPF/CNPJ · RG · endereço residencial · já tem cadastro no sistema.

### 5.3 O agente: o que faz e o que não faz

**Faz (alçada até "Pedido completo"):**
- Substitui as duas mensagens automáticas atuais, com o link certo do catálogo.
- Separa o assunto: orçamento novo segue com a IA; pedido em andamento, logística, avaria, cobrança, fornecedor e interno vão direto para humano sem pitch.
- Coleta na ordem certa: itens e quantidades (por texto, foto ou print do catálogo), data, tipo de evento e convidados, entrega ou retirada, endereço, cadastro. Não pergunta de novo o que o cliente já disse.
- Entende áudio (131 áudios em 20 dias, transcrição é obrigatória) e foto (identifica o item do catálogo).
- Responde as perguntas fixas: horários, endereço, formas de pagamento, regra do sinal, frete à parte, regras de entrega, devolução, higienização, o que não alugam (com indicação de parceiro).
- Pode informar **preço de tabela** dos 209 itens (catálogo já está no Control ERP Lite), sempre como "valor de tabela, o orçamento final a equipe confirma com disponibilidade e frete". **Decisão do cliente** (§7).
- Follow-up de orçamento parado e de pedido aprovado sem pagamento.
- Grava tudo nos campos e move até "Pedido completo".

**Não faz (fica com a equipe):** confirmar disponibilidade na data, valor final, frete, desconto, baixa de pagamento, agendar motorista, avaria, estorno, reclamação, exceções de prazo.

**Por quê:** disponibilidade por data não existe em nenhum sistema que a IA consiga ler hoje (o Lite tem estoque total, não reservas por data). Prometer "tem sim" sem essa consulta é o erro mais caro possível num negócio de locação: dois clientes com a mesma toalha no mesmo sábado. Quando houver consulta de reserva por data, a alçada sobe para "Orçamento enviado".

### 5.4 Automações (workflows GHL, sem IA)

- Lembrete de saldo 5 dias antes do evento.
- Lembrete de entrega na véspera (período + nome de contato + regras de portaria/térreo).
- Lembrete de devolução no dia, com a data preenchida pelo campo (fim do "__/__").
- Pós-evento: "deu tudo certo?" + pedido de avaliação no Google (já fazem à mão em C109 e C152).

### 5.5 Gate e rampagem

O número é compartilhado com dono, motorista e fornecedores. Gate por tag obrigatório desde o dia 1, mais lista de exclusão (contatos internos e parceiros nunca recebem IA). Rampagem: 1 número de teste → 10 contatos novos → todos os contatos novos. Cliente com pedido em andamento continua com humano.

### 5.6 Foto do antes (baseline, 16/09 a 06/10)

184 conversas · ~87 orçamentos novos · 1ª resposta mediana 5 min · 48 conversas terminando sem resposta humana · nenhuma oportunidade registrada no CRM. As vendas e o R$ vendido do período precisam vir do sistema de pedidos (Acercom / Lite) para fechar a foto.

---

## 6. Red flags

1. **Número compartilhado** com dono, motorista, fornecedor e uso pessoal. Sem gate, a IA responde o Diogo no meio da rota. Ideal: grupo interno para expedição fora desse número.
2. **Ponte de WhatsApp não identificada.** Precisamos saber qual é (uazapi? outra?) e onde moram os dois robôs atuais. Robô antigo ligado junto com a IA = resposta dupla.
3. **Regras contraditórias** (§4). Sem versão única, não há prompt.
4. **Sem disponibilidade por data.** Limita a alçada da IA, como explicado em 5.3.
5. **Tabela de dezembro desconhecida** e dezembro é o pico. Sem ela, a IA não fala preço em dezembro.
6. **Áudio pesado** dos dois lados. A IA vai entender áudio; responder em áudio só depois de testar entrega real.

---

## 7. Perguntas para a Rey Festas (rodada 1)

1. Qual a regra oficial do restante do pagamento: 5 dias ou 1 dia antes? E quando a exceção "paga na entrega" é permitida?
2. Desconto à vista é 7% ou 10%? Para quem vale o desconto de parceria (decoradora, buffet)?
3. Existe tabela de frete por bairro/cidade? Se não, a IA diz só "frete calculado pelo endereço" ou pode dar faixa?
4. A IA pode falar o preço de tabela do catálogo? E a tabela de dezembro, onde está?
5. Horário de sábado: retirada até 11h ou 12h?
6. O pedido e o estoque vão continuar no Acercom ou passam para o Control ERP Lite? (decide se o funil de Operação vive no GHL ou no ERP)
7. Qual sistema conecta o WhatsApp ao GHL hoje, e quem configurou as mensagens automáticas?
8. Quem recebe o lead quando a IA termina a coleta? Uma pessoa ou a fila de todas?
9. Quais contatos nunca podem receber IA (dono, motorista, parceiros, fornecedores)?
10. Querem os lembretes de saldo, entrega e devolução automáticos?

## 7.1 Respostas da Karol (06/10/2026, WhatsApp, instância Operacional@)

Karol = braço direito do Noel, financeiro. Fonte das regras oficiais.

| Tema | Decisão |
|---|---|
| Sistema | Acercom (acercom04.onlineapp.work) será **substituído** pelo Control ERP. Preocupação dela: transferir a lista de clientes |
| Nunca recebem IA | Noel, Diogo (motorista), Karol (financeiro), Fabio (consultor) |
| Pagamento | Total quitado **até 1 dia antes** do evento. **Pagamento na entrega não é permitido** (1 maquininha, motorista não recebe dinheiro). Exceção só caso a caso, aprovada pela Karol |
| Desconto | **Teto de 7%** para todos, inclusive decoradora e buffet. Acima disso só Karol ou Noel |
| Frete | **km × R$ 2 × 4 trechos** (leva, volta, busca, volta). Ex.: Piracaia 35 km → R$ 280. **Mínimo R$ 50** |
| Sábado | Retirada **9h às 11h30** (fecha 12h) |
| Preço de tabela | IA **pode** informar, avisando que o valor final é confirmado pela equipe |
| Cancelamento / higienização | Provavelmente igual ao contrato (multa 50% conversível em crédito 6 meses; 20% se voltar sujo). **Karol vai confirmar com o Noel** |
| Lembretes automáticos | **Sim** (saldo, véspera da entrega, devolução) |

Canal: a Rey Festas tem **uma única instância de WhatsApp no CRM ("Atendimento")**, confirmado em 06/10. A "Operacional@" vista na conversa com a Karol é a instância da Control Gestão. A IA opera só na "Atendimento", que também recebe equipe, motorista e fornecedores, então a lista de exclusão é obrigatória.

Confirmado depois (06/10):
- Mensagens automáticas atuais (boas-vindas e fora do horário): **a Karol desliga** quando a IA entrar.
- Quem atende do início ao fim é a **Karol** → ela recebe o pedido completo da IA (handoff).
- **Preços de dezembro são os mesmos** do resto do ano. Atenção: C107 ("Em Dezembro muda a tabela"), C167 ("valores até novembro") e a boas-vindas ("orçamento de dezembro") dizem o contrário; o time e o catálogo precisam ser alinhados.

Fechado em 07/10 (Karol):
- **7% de desconto** para todo cliente que paga o total à vista, ou que pede desconto; vale também para decoradoras e parceiros. Acima de 7% só Karol ou Noel.
- **Sinal de 50%** para reservar; restante até 1 dia antes do evento.
- Frete: km **da loja até o local, pelo caminho do carro** × R$ 2 × 4 trechos, mínimo R$ 50.
- **Não existe devolução no sábado.** Locação de fim de semana é de **sexta a segunda** (fim de semana completo).
- Marketing Pipeline de exemplo excluído pelo Eduardo.

Regras comerciais do prompt: **fechadas**, exceto cancelamento/higienização (Karol confirmando com o Noel).

Consequências no desenho:
- Alçada da IA ganha **preço de tabela** (catálogo do Lite).
- Frete: fase 1 a IA explica a regra; fase 2 cálculo automático por distância (Google Maps) com mínimo de R$ 50.
- Migração Acercom → Lite entra no escopo: clientes **e reservas futuras** (sem elas o ERP novo não sabe o que já está alugado em cada data).

## 7.2 Sistema de locação: app "Locações" do vhsys (07/10/2026)

As locações vão rodar no app Locações do Control ERP Lite (vhsys). Manual: ajuda.vhsys.com.br/categorias/apps-e-integracoes/locacoes.

O que o app faz: locação com cliente, produtos, quantidade, valor e preço de reposição; contrato próprio; status Em aberto → Aprovado → Em andamento → Atendida; gera orçamento, OS e NF-e de movimentação; relatórios de movimentação, produtos e ocorrências por data.

**Risco 1: a reserva não é por data.** Pelo manual, "Reservar Estoque" deixa a quantidade "indisponível para outras locações" e ela "só vai ser liberada quando a locação for finalizada". Numa locadora que reserva casamento com meses de antecedência, reservar 50 toalhas para 20/11 em outubro tiraria essas 50 de todos os fins de semana até 20/11. Precisa de **teste prático** antes de virar regra: criar uma locação futura com reserva e ver se o estoque disponível para uma data anterior cai.

**Risco 2: não há API do app Locações.** A API pública v2 tem clientes, produtos, estoque, pedidos, orçamentos e OS, mas nenhuma rota de locação (testado na conta em 07/10). Consequências:
- A IA não consegue consultar disponibilidade nem criar a locação. **A alçada continua em "Pedido completo"** e a Karol lança a locação no app.
- O que dá para integrar: o **cadastro do cliente** coletado pela IA pode ser criado direto no vhsys pela API (/clientes), poupando a Karol de digitar a ficha.
- O status da locação não volta para o GHL. O funil "Locação: Operação" no GHL viraria trabalho em dobro (mover card nos dois sistemas). Recomendação: lembretes de saldo, entrega e devolução disparados pelos **campos de data** da oportunidade de Vendas (preenchidos quando vira Reservado), e o funil Operação removido ou deixado sem uso.
- Migração do Acercom: clientes vão pela API; **locações futuras já fechadas precisam ser lançadas no app** (manual), senão o estoque reservado fica errado.

## 8. Próximos passos

1. Rey Festas responde a rodada 1 (acima).
2. Control Gestão monta pipelines, campos e motivo de perda no GHL (via API, depois de aprovado).
3. Rascunho do prompt com as regras fechadas, few-shots tirados das conversas boas listadas pelos analistas (C021, C060, C068, C081, C105, C122, C125, C146, C152, C165) e filtro de tom.
4. Evals 10/10, E2E em número de teste, gate, rampagem.
