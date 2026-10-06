# Rey Festas: estudo do site (06/10/2026)

Fonte: https://reyfestas.com.br (3 páginas WordPress/Divi, 11 páginas de categoria)
e o catálogo publicado no Google Slides que o site linka em "Portfólio de Produtos".
O texto do catálogo foi extraído slide a slide em `catalogo-slides-2026-10-06.txt`.

> Atenção: o nome da marca é **Rey Festas**, com Y. O repositório se chama Rei-Festas.

## Quem é

- Locação de artigos para eventos desde 2006 (o site diz "mais de 16 anos" em uma
  página e "mais de 18 anos" em outra).
- Endereço: Avenida São João, 1649, Atibaia/SP. Fica perto das rodovias D. Pedro e
  Fernão Dias e faz entrega.
- Diz ter atendido mais de 7.000 clientes na região bragantina, em São Paulo capital,
  no Vale do Paraíba, na região de Campinas e no sul de Minas.
- Usa a MRV Construtora como prova social.
- WhatsApp oficial: 55 11 98122-3778 (botão do site, sem mensagem pré-preenchida).
- Instagram: @reyfestas.

## Duas linhas de negócio

1. **Locação de itens** (o grosso do catálogo, com preço por unidade): cadeiras, mesas,
   pratos, sousplat, guardanapos, finger food, xícaras, copos e taças, travessas,
   suqueiras e jarras, toalhas, cobre-manchas, tapetes, baldes e bombonieres, displays,
   talheres, rechauds, decoração e móveis rústicos.
2. **Organização de eventos**: buffet personalizado (churrasco e outros), cerimonial,
   decoração, som, vídeo, iluminação, tendas e geradores. Atende eventos corporativos
   (por exemplo festa da Copa e aniversário de empresa), debutantes, casamentos e
   aniversários. **Nenhum preço publicado** para essa linha.

## Regras de preço que o catálogo mostra

- O preço é **por unidade, por locação**.
- **Dezembro custa cerca de 30% a mais** (o slide 4 avisa). Cada item traz os dois
  valores, o normal e o de dezembro.
- Faixa de preços: R$ 0,90 (prato de sobremesa Plaza) até R$ 300 (mesa rústica
  2,20 x 1,00).
- Alguns exemplos: cadeira plástica sem braço R$ 4, cadeira Tiffany ou Chanel R$ 15,
  mesa redonda de madeira para 6, 8 ou 10 lugares por R$ 13, 17 ou 20, toalha Oxford
  1,50 x 1,50 R$ 9, toalha redonda adamascada R$ 24, rechaud R$ 40 a 70, tapete de
  25 m R$ 150.

## Problemas no catálogo (não podem ir para o prompt como estão)

- Itens com o texto de modelo **"REF: 000000000 Valor: R$200,00"**: garfos e facas
  Class, colher de café, garfo de finger food, garrafa, suqueira e dois tapetes
  (um deles aparece como R$ 2.150). Isso é placeholder, não preço.
- "Ânfora ferro arabesco G" aparece uma vez com o valor de dezembro em branco e
  outra vez completa (R$ 30 / R$ 39).
- "Sousplat dourado" tem o mesmo valor no mês normal e em dezembro (R$ 5 / R$ 5).
- "Mesa pranchão retangular" não tem preço. Mesas redondas e a mesa plástica não
  trazem o valor de dezembro.
- A numeração dos slides se repete ("11. Cobre manchas" e "11. Toalhas Redondas",
  "17. Decoração" e "17. Mesas").
- Itens citados no site que **não estão no catálogo**: púlpito, puffs, mesa bistrô,
  banquetas, samovar, som, vídeo, iluminação, tendas e geradores.

## O que isso significa para o agente

- **O preço é dado volátil**, com sazonalidade e erros. Pela doutrina da skill, ele
  não entra fixo no prompt. A fonte deveria ser o cadastro de produtos do VHSYS,
  com a regra de dezembro aplicada em código. Ponto a validar com o cliente.
- **A venda é um orçamento de vários itens** (quantidade x item x data). O agente
  qualifica e monta o pedido. A disponibilidade por data é a pergunta que mais
  pesa numa locadora e precisa vir de algum lugar (VHSYS ou humano).
- **São duas portas**: locação (preço tabelado, autoatendimento possível) e
  evento completo ou buffet (consultivo, vai para humano ou visita).
- **Não há rastreio de origem**: o site não tem Pixel da Meta, GA nem GTM, e o
  botão de WhatsApp não manda mensagem pré-preenchida. Hoje não dá para saber de
  onde vem o lead.
