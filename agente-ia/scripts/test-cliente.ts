/**
 * TESTES DO CLIENTE · Rey Festas (rodam junto com `npm test`).
 * Para cada regra em lib/regras.ts: um texto que DEVE bloquear e um texto
 * aprovado que DEVE passar. Mais: datas, soma do pedido e campos condicionais.
 */
type Eq = (nome: string, got: unknown, want: unknown) => void

export default async function testesCliente(eq: Eq): Promise<number> {
  const { checkReply, comCumprimento } = await import('../lib/guards')
  const regras = (t: string) => [...new Set(checkReply(t).map(v => v.regra))]

  // ---------- Travas de texto ----------
  eq('rey: "temos disponível" bloqueia', regras('Temos disponível sim pra essa data!'), ['afirmou disponibilidade'])
  eq('rey: "está reservado" bloqueia', regras('Pronto, está reservado pra você.'), ['afirmou disponibilidade'])
  eq('rey: "data garantida" bloqueia', regras('Sua data está garantida.'), ['afirmou disponibilidade'])
  eq('rey: Karol confere passa', regras('Temos a Taça Bistrô Vinho no catálogo, R$ 1,20 cada. A Karol confere se tem disponível pra data e te manda o orçamento.'), [])
  eq('rey: disponibilidade (substantivo) passa', regras('A Karol confere a disponibilidade para o dia 20/11.'), [])
  eq('rey: chave Pix por e-mail bloqueia', regras('A chave Pix é financeiro@reyfestas.com.br'), ['mandou dado de pagamento'])
  eq('rey: CNPJ bloqueia', regras('Pode fazer o Pix no CNPJ 12.345.678/0001-90'), ['mandou dado de pagamento'])
  eq('rey: link de pagamento bloqueia', regras('Segue o link: https://link.stone.com.br/abc'), ['mandou dado de pagamento'])
  eq('rey: formas de pagamento passam', regras('Pode ser Pix ou cartão pelo link de pagamento em até 3x sem juros. A Karol manda junto com o orçamento.'), [])
  eq('rey: 15% bloqueia', regras('Consigo 15% pra você.'), ['percentual fora da regra'])
  eq('rey: 20% de higienização bloqueia', regras('Se voltar sujo tem taxa de 20%.'), ['percentual fora da regra'])
  eq('rey: 7% e 50% passam', regras('Pagando tudo à vista tem 7% de desconto no material. Pra reservar, o sinal é de 50%.'), [])
  eq('rey: 70% não passa como 7%', regras('Dá pra dar 70% de desconto.'), ['percentual fora da regra'])
  eq('rey: valor de multa bloqueia', regras('Cancelando, a multa de R$ 200 é cobrada.'), ['valor de multa', 'valor sem dizer que a Karol confirma'])
  eq('rey: falar que a Karol explica a multa passa', regras('Sobre multa de cancelamento, a Karol te explica certinho.'), [])
  eq('rey: valor sem a Karol bloqueia', regras('As 80 taças saem R$ 96,00. Vai ser com entrega?'), ['valor sem dizer que a Karol confirma'])
  eq('rey: valor com a Karol passa', regras('As 80 taças saem R$ 96,00 de tabela. A Karol confere a disponibilidade pro dia 20/11.'), [])
  eq('rey: sem valor não exige a Karol', regras('Vai ser com entrega no local ou você retira aqui na loja?'), [])
  eq('rey: travessão bloqueia', regras('A mesa — a redonda — leva 8 lugares.'), ['travessão'])
  eq('rey: "Ótima pergunta" bloqueia', regras('Ótima pergunta! A redonda de 1,30 leva 8 lugares.'), ['resíduo de chatbot'])
  eq('rey: "Fico à disposição" bloqueia', regras('O total fica R$ 100,00, a Karol confirma. Fico à disposição!'), ['resíduo de chatbot'])
  eq('rey: abrir com "Perfeito" bloqueia', regras('Perfeito, Eduardo. Ficou assim: 50 pratos.'), ['abertura "Perfeito"'])
  eq('rey: "perfeito" no meio passa', regras('Fica perfeito pra mesa de doces 😉'), [])
  eq('rey: fala real da loja passa', regras('Olá, bom dia! Tudo bem? Essa é a nossa bege adamascada 😉'), [])

  eq('cumprimento entra na primeira mensagem', comCumprimento('Funciona assim...', 14), 'Olá, boa tarde! Tudo bem? Aqui é a assistente virtual da Rey Festas 😊 Funciona assim...')
  eq('cumprimento segue o período do lead', comCumprimento('Funciona assim...', 9, 'oi, boa tarde!'), 'Olá, boa tarde! Tudo bem? Aqui é a assistente virtual da Rey Festas 😊 Funciona assim...')
  eq('cumprimento não duplica', comCumprimento('Olá, bom dia! Tudo bem? Temos sim.', 9), 'Olá, bom dia! Tudo bem? Aqui é a assistente virtual da Rey Festas 😊 Temos sim.')
  eq('apresentação não duplica', comCumprimento('Olá, bom dia! Tudo bem? Aqui é a assistente virtual da Rey Festas. Em que posso te ajudar?', 9), 'Olá, bom dia! Tudo bem? Aqui é a assistente virtual da Rey Festas. Em que posso te ajudar?')
  eq('apresentação sem "tudo bem"', comCumprimento('Oi, Ana! Temos sim.', 9), 'Oi, Ana! Aqui é a assistente virtual da Rey Festas 😊 Temos sim.')

  // ---------- Datas ----------
  const { parseDataBR, conferirEvidenciaData, formatarData, pedidoUrgentePronto, proximoDiaDaSemana, dataPelaEvidencia } = await import('../lib/datas')
  const hoje = '2026-10-25' // domingo
  const d = (raw: string) => { const r = parseDataBR(raw, hoje); return 'iso' in r ? r.iso : 'erro' }
  eq('data dd/mm sem ano = próxima', d('20/11'), '2026-11-20')
  eq('data dd/mm que já passou este ano = ano que vem', d('10/03'), '2027-03-10')
  eq('data por extenso', d('20 de novembro'), '2026-11-20')
  eq('data ISO', d('2026-12-12'), '2026-12-12')
  eq('data com ano curto', d('05/01/27'), '2027-01-05')
  eq('data passada recusa', d('10/10/2026'), 'erro')
  eq('data inválida recusa', d('31/02/2027'), 'erro')
  eq('formata com dia da semana', formatarData('2026-10-31'), 'sáb 31/10/2026')
  eq('"sábado" bate', conferirEvidenciaData('é no sábado', '2026-10-31', hoje), null)
  eq('"sábado" com data errada recusa', !!conferirEvidenciaData('é no sábado', '2026-11-01', hoje), true)
  eq('"amanhã" bate', conferirEvidenciaData('preciso pra amanhã', '2026-10-26', hoje), null)
  eq('"amanhã" errado recusa', !!conferirEvidenciaData('preciso pra amanhã', '2026-10-27', hoje), true)
  eq('"pra hoje às 18h" vira hoje', dataPelaEvidencia('pra hoje às 18h', hoje), hoje)
  eq('"pra hoje" vira hoje', dataPelaEvidencia('pra hoje', hoje), hoje)
  eq('"amanhã" vira amanhã', dataPelaEvidencia('preciso pra amanhã', hoje), '2026-10-26')
  eq('"sábado" vira o próximo sábado', dataPelaEvidencia('pro sábado', hoje), '2026-10-31')
  eq('"sábado dia 31" fica com o parse normal', dataPelaEvidencia('sábado dia 31', hoje), null)
  eq('"20/11" fica com o parse normal', dataPelaEvidencia('pro dia 20/11', hoje), null)
  eq('próximo sábado', proximoDiaDaSemana(hoje, 6), '2026-10-31')
  eq('urgente pronto (amanhã, itens, entrega)', pedidoUrgentePronto({ respostas: { dataEvento: 'seg 26/10/2026', itens: 'x', entregaRetirada: 'Entrega' } }, hoje), true)
  eq('urgente sem entrega não', pedidoUrgentePronto({ respostas: { dataEvento: 'seg 26/10/2026', itens: 'x' } }, hoje), false)
  eq('evento em 5 dias não é urgente', pedidoUrgentePronto({ respostas: { dataEvento: 'sex 30/10/2026', itens: 'x', entregaRetirada: 'Entrega' } }, hoje), false)
  eq('"sábado 31/10" com número não confere dia', conferirEvidenciaData('sábado 31/10', '2026-10-31', hoje), null)

  // ---------- Soma do pedido ----------
  const { montarPedido, textoItens, reais } = await import('../lib/catalogo')
  const cat = [
    { codigo: 'MOB-010', nome: 'Jogo de Mesa 0,70X0,70 com 04 Cadeiras C/ Braço', categoria: 'Mobiliário', preco: 26 },
    { codigo: 'COP-006', nome: 'Taça Bistrô 300ML - Vinho Tinto', categoria: 'Copos e Taças', preco: 1.2 },
    { codigo: 'TEC-001', nome: 'Caminho de Mesa - Amarelo', categoria: 'Toalhas e Tecidos', preco: null },
  ]
  const r = montarPedido([
    { codigo: 'mob-010', descricao: 'jogo de mesa', quantidade: 5 },
    { codigo: 'COP-006', descricao: 'taça vinho', quantidade: 80 },
    { codigo: 'COP-006', descricao: 'taça vinho', quantidade: 10 },
    { codigo: 'TEC-001', descricao: 'caminho amarelo', quantidade: 3 },
    { codigo: '', descricao: 'Tenda 10x10', quantidade: 1 },
  ], cat)
  eq('pedido soma em código (5×26 + 90×1,20)', 'pedido' in r ? r.pedido.total : r, 238)
  eq('pedido junta código repetido', 'pedido' in r ? r.pedido.linhas.find(l => l.item?.codigo === 'COP-006')?.quantidade : r, 90)
  eq('pedido separa sem preço e fora do catálogo', 'pedido' in r ? [r.pedido.semPreco, r.pedido.foraDoCatalogo] : r, [['Caminho de Mesa - Amarelo'], ['Tenda 10x10']])
  eq('texto do card', 'pedido' in r ? textoItens(r.pedido).split('\n')[0] : r, 'MOB-010 · 5 × Jogo de Mesa 0,70X0,70 com 04 Cadeiras C/ Braço · R$ 26,00 cada = R$ 130,00')
  eq('código inexistente recusa', 'erros' in montarPedido([{ codigo: 'XYZ-999', descricao: 'x', quantidade: 1 }], cat), true)
  eq('data como item recusa', 'erros' in montarPedido([{ codigo: '', descricao: 'dia 20/11', quantidade: 1 }], cat), true)
  eq('código de faca com descrição de garfo recusa', 'erros' in montarPedido([{ codigo: 'TAL-007', descricao: 'Garfo Refeição Class', quantidade: 30 }], (await import('../lib/catalogo-dados')).CATALOGO), true)
  eq('"mesas com cadeira" no jogo de mesa passa', 'pedido' in montarPedido([{ codigo: 'MOB-009', descricao: 'mesas com cadeira', quantidade: 5 }], (await import('../lib/catalogo-dados')).CATALOGO), true)
  eq('descrição do lead com o código certo passa', 'pedido' in montarPedido([{ codigo: 'TAL-009', descricao: 'garfos', quantidade: 30 }], (await import('../lib/catalogo-dados')).CATALOGO), true)
  eq('quantidade zero recusa', 'erros' in montarPedido([{ codigo: 'COP-006', descricao: 'x', quantidade: 0 }], cat), true)
  eq('reais com milhar', reais(1234.5), 'R$ 1.234,50')

  // ---------- Catálogo gerado ----------
  const { CATALOGO } = await import('../lib/catalogo-dados')
  eq('catálogo carregado (209 itens)', CATALOGO.length, 209)
  eq('catálogo sem código repetido', new Set(CATALOGO.map(i => i.codigo)).size, CATALOGO.length)

  // ---------- Campos condicionais ----------
  const { CRM_MAP } = await import('../lib/crm-map')
  const veto = CRM_MAP.finalizar.vetoMotivo
  eq('"pessoa ou robô?" não é pediu_humano', veto.pediu_humano.re.test('Tô falando com uma pessoa ou robô?') && !veto.pediu_humano.salvo?.test('Tô falando com uma pessoa ou robô?'), true)
  eq('"é robô? quero falar com a Karol" é pediu_humano', !!veto.pediu_humano.salvo?.test('é robô? quero falar com a Karol'), true)
  eq('"vocês alugam tenda?" não é fora_do_escopo', veto.fora_do_escopo.re.test('Vocês alugam tenda e freezer?'), true)
  eq('boleto de fornecedor segue fora_do_escopo', veto.fora_do_escopo.re.test('aqui é da distribuidora de água, segue o boleto do mês'), false)
  const { snapshot } = await import('../lib/tools')
  const porta = CRM_MAP.portas[0]
  const abertos = (respostas: Record<string, string>) => snapshot(porta, { respostas }).abertos.map(c => c.key)
  eq('retirada não pede endereço do evento', abertos({ itens: 'x', dataEvento: 'x', entregaRetirada: 'Retirada na loja' }).includes('enderecoEvento'), false)
  eq('entrega pede endereço do evento', abertos({ itens: 'x', dataEvento: 'x', entregaRetirada: 'Entrega' })[0], 'enderecoEvento')
  eq('com cadastro não pede RG nem e-mail', abertos({ cadastroErp: 'Sim' }).filter(k => ['rg', 'email', 'enderecoResidencial'].includes(k)), [])
  eq('sem cadastro pede RG', abertos({ cadastroErp: 'Não' }).includes('rg'), true)
  eq('empresa sem cadastro não pede RG', abertos({ cadastroErp: 'Não', perfil: 'Empresa, escola ou igreja' }).includes('rg'), false)
  // ---------- ERP (pedido fechado → VHSYS) ----------
  const erp = await import('../lib/erp')
  const textoCard = 'LOU-001 · 30 × Prato Refeição Fundo · R$ 3,50 cada = R$ 105,00\nTAL-009 · 30 × Garfo Refeição Class · R$ 1,20 cada = R$ 36,00\n1 × Arranjo de flores (fora do catálogo)'
  const lidos = erp.lerItens(textoCard, CATALOGO)
  eq('erp: lê código e quantidade do card', lidos.itens.map(i => `${i.codigo}:${i.quantidade}:${i.valorUnit}`), ['LOU-001:30:3.5', 'TAL-009:30:1.2'])
  eq('erp: item fora do catálogo vai para conferência', lidos.semCodigo, ['1 × Arranjo de flores (fora do catálogo)'])
  eq('erp: total dos itens', erp.totalItens(lidos.itens), 141)
  eq('erp: linha editada sem preço usa a tabela', erp.lerItens('LOU-001 · 10 × prato fundo', CATALOGO).itens[0]?.valorUnit, 3.5)
  eq('erp: preço negociado na linha vale', erp.lerItens('LOU-001 · 10 × Prato · R$ 3,00 cada = R$ 30,00', CATALOGO).itens[0]?.valorUnit, 3)
  eq('erp: código repetido soma', erp.lerItens('LOU-001 · 10 × Prato\nLOU-001 · 5 × Prato', CATALOGO).itens[0]?.quantidade, 15)
  eq('erp: código inexistente não entra', erp.lerItens('XYZ-999 · 3 × Coisa', CATALOGO).itens.length, 0)
  eq('erp: CPF formatado', erp.documento('12345678909'), { tipo: 'PF', digitos: '12345678909', formatado: '123.456.789-09' })
  eq('erp: CNPJ formatado', erp.documento('11.222.333/0001-81')?.formatado, '11.222.333/0001-81')
  eq('erp: documento inválido', erp.documento('123'), null)
  eq('erp: data ISO do GHL', erp.dataBR('2026-10-31'), '31/10/2026')
  eq('erp: data epoch ms do GHL', erp.dataBR(Date.UTC(2026, 9, 31, 12)), '31/10/2026')
  const dadosErp = { nome: 'Maria Souza', documento: '12345678909', rg: '12.345.678-9', email: 'm@x.com', telefone: '+5511999999999', itensTexto: textoCard, dataEvento: '2026-10-31', entregaRetirada: 'Retirada na loja', enderecoEvento: 'Rua A, 1', tipoEvento: 'Aniversário', convidados: 50, opportunityId: 'op1' }
  const cli = erp.payloadCliente(dadosErp, erp.documento('12345678909')!, '25/10/2026')
  eq('erp: cliente PF com CPF formatado', [cli.tipo_pessoa, cli.cnpj_cliente, cli.razao_cliente, cli.rg_cliente], ['PF', '123.456.789-09', 'Maria Souza', '12.345.678-9'])
  const obs = erp.obsOrcamento(dadosErp, lidos.semCodigo)
  eq('erp: observação tem data, retirada e evento', /31\/10\/2026/.test(obs) && /Retirada na loja/.test(obs) && /Aniversário, 50 convidados/.test(obs), true)
  eq('erp: retirada não leva endereço do evento', /Endereço do evento/.test(obs), false)
  eq('erp: observação lista o que conferir', /Arranjo de flores/.test(obs), true)

  // ---------- Locação sem o app Locações (agenda de reservas) ----------
  const loc = await import('../lib/locacao')
  const per = (d: string) => { const p = loc.periodoPadrao(d); return `${p.inicio}>${p.fim}` }
  eq('locação: evento no sábado = sexta → segunda', per('2026-10-31'), '2026-10-30>2026-11-02')
  eq('locação: evento na quarta = terça → quinta', per('2026-11-04'), '2026-11-03>2026-11-05')
  eq('locação: evento na segunda = sexta → terça', per('2026-11-02'), '2026-10-30>2026-11-03')
  eq('locação: evento na sexta = quinta → segunda (sem devolução no sábado)', per('2026-10-30'), '2026-10-29>2026-11-02')
  eq('locação: linha do período', loc.linhaPeriodo({ inicio: '2026-10-30', fim: '2026-11-02' }), 'LOCAÇÃO: 30/10/2026 a 02/11/2026')
  eq('locação: lê a linha no meio da observação', loc.lerPeriodo('Data do evento: 31/10/2026\nLOCAÇÃO: 30/10/2026 a 02/11/2026 (retirada → devolução)'), { inicio: '2026-10-30', fim: '2026-11-02' })
  eq('locação: aceita "Locacao" sem acento e "até"', loc.lerPeriodo('locacao: 01/12/2026 até 03/12/2026'), { inicio: '2026-12-01', fim: '2026-12-03' })
  eq('locação: período invertido não vale', loc.lerPeriodo('LOCAÇÃO: 05/12/2026 a 01/12/2026'), null)
  eq('locação: sem a linha', loc.lerPeriodo('Data do evento: 31/10/2026'), null)
  const estoqueT = new Map([['LOU-001', { nome: 'Prato Fundo', total: 100 }], ['COP-006', { nome: 'Taça', total: null }]])
  const reservasT = [
    { pedido: 'A', cliente: 'a', inicio: '2026-10-30', fim: '2026-11-02', itens: [{ codigo: 'LOU-001', quantidade: 50 }] },
    { pedido: 'B', cliente: 'b', inicio: '2026-11-03', fim: '2026-11-05', itens: [{ codigo: 'LOU-001', quantidade: 40 }] },
    { pedido: 'C', cliente: 'c', inicio: '2026-10-31', fim: '2026-11-01', itens: [{ codigo: 'LOU-001', quantidade: 20 }, { codigo: 'COP-006', quantidade: 80 }] },
  ]
  const ag = (de: string, ate?: string) => Object.fromEntries(loc.calcularAgenda(reservasT, estoqueT, de, ate).map(l => [l.codigo, `${l.reservado}/${l.livre}`]))
  eq('agenda: um dia soma as locações que se sobrepõem', ag('2026-10-31')['LOU-001'], '70/30')
  eq('agenda: intervalo usa o pico, não a soma de dias diferentes', ag('2026-10-30', '2026-11-05')['LOU-001'], '70/30')
  eq('agenda: dia sem sobreposição', ag('2026-11-03')['LOU-001'], '40/60')
  eq('agenda: dia antes de tudo não reserva', ag('2026-10-29')['LOU-001'], '0/100')
  eq('agenda: estoque desconhecido = livre null', ag('2026-10-31')['COP-006'], '80/null')
  const cls = (fim: string, sit: string) => { const c = loc.classificarReserva({ inicio: '2026-10-01', fim }, sit, '2026-10-25'); return c.tipo === 'ignorar' ? 'ignorar' : `${c.tipo}:${c.fim}:${c.diasAtraso}` }
  eq('modelo A: pedido em aberto no período ocupa', cls('2026-10-30', 'Em aberto'), 'ativa:2026-10-30:0')
  eq('modelo A: atendido antes da hora libera', cls('2026-10-30', 'Atendido'), 'ignorar')
  eq('modelo A: cancelado não ocupa', cls('2026-10-30', 'Cancelado'), 'ignorar')
  eq('modelo A: vencido sem atendido = atrasada, ocupa até hoje', cls('2026-10-20', 'Em aberto'), 'atrasada:2026-10-25:5')
  eq('modelo A: vencido e atendido some', cls('2026-10-20', 'Atendido'), 'ignorar')
  const perT = { inicio: '2026-11-19', fim: '2026-11-23' }
  const disp = (livre: number | null) => loc.textoDisponibilidade([{ codigo: 'COP-006', nome: 'Taça Vinho', quantidade: 80, livre }], perT, '2026-11-20')
  eq('fase 3: livre suficiente = TEM e a Karol confirma', [disp(200).ok, /TEM/.test(disp(200).texto), /Karol confirma/.test(disp(200).texto)], [true, true, true])
  eq('fase 3: falta mostra quanto falta', [disp(50).ok, /livres só 50 → FALTA 30/.test(disp(50).texto)], [false, true])
  eq('fase 3: estoque não cadastrado = não falar de disponibilidade', /NÃO fale de disponibilidade/.test(disp(null).texto), true)
  eq('fase 3: nunca reservado', /NUNCA diga reservado/.test(disp(200).texto), true)
  eq('trava agenda: "pela nossa agenda"', loc.falouDaAgenda('Pela nossa agenda tem as 80 livres'), 'Pela nossa agenda')
  eq('trava agenda: "80 taças livres"', loc.falouDaAgenda('Ficam 80 taças livres pro dia 20'), '80 taças livres')
  eq('trava agenda: texto normal passa', loc.falouDaAgenda('A taça de vinho sai R$ 1,20 cada. A Karol confere pro dia 20/11.'), null)
  eq('fase 3: nenhum item com estoque = não fala de agenda', [disp(null).conhecidos, /NÃO fale de agenda nem de livre/.test(disp(null).texto), /pela nossa agenda tem livre/.test(disp(null).texto)], [0, true, false])
  eq('cobrança agenda: "vocês têm 80 taças pro dia 20/11?"', loc.perguntouDisponibilidade('Vocês têm 80 taças de vinho pro dia 20/11?', false), true)
  eq('cobrança agenda: "tem 60 taças pro sábado?"', loc.perguntouDisponibilidade('Tem 60 taças de champanhe pro sábado?', false), true)
  eq('cobrança agenda: pergunta de preço não dispara', loc.perguntouDisponibilidade('quanto fica o aluguel de 5 jogos de mesa?', true), false)
  eq('cobrança agenda: sem data não dispara', loc.perguntouDisponibilidade('vocês têm taça de vinho?', false), false)
  const obsLoc = erp.obsOrcamento({ ...dadosErp, dataEvento: '2026-10-31' }, [])
  eq('orçamento: observação leva a linha LOCAÇÃO pelo período padrão', loc.lerPeriodo(obsLoc), { inicio: '2026-10-30', fim: '2026-11-02' })

  // ---------- Painel de gestão ----------
  const painel = await import('../lib/painel')
  const agoraP = Date.parse('2026-10-25T15:00:00-03:00')
  const ex = (tipo: string, dias: number, extra: Record<string, unknown> = {}) => ({ at: new Date(agoraP - dias * 86400000).toISOString(), tipo, leadId: String(extra.leadId || 'L1'), ...extra }) as never
  const execs = [
    ex('resposta', 0, { leadId: 'A', custoUsd: 0.004 }), ex('resposta', 0, { leadId: 'A', custoUsd: 0.004 }), ex('finalizou', 0, { leadId: 'A', motivo: 'qualificado', custoUsd: 0.005 }),
    ex('resposta', 1, { leadId: 'B' }), ex('finalizou', 1, { leadId: 'B', motivo: 'outro_servico' }),
    ex('finalizou', 2, { leadId: 'C', motivo: 'urgente' }), ex('erro', 2, { leadId: 'C', detalhe: 'GHL 500' }),
    ex('erp', 0, { detalhe: 'orçamento 5 · cliente 9' }), ex('erp', 1, { detalhe: 'ERRO: CPF/CNPJ ausente' }),
    ex('resposta', 40, { leadId: 'Z' }),
  ]
  const ia = painel.resumirIA(execs, agoraP, 7)
  eq('painel IA: contatos únicos e respostas no período', [ia.contatos, ia.mensagens], [3, 6])
  eq('painel IA: enviados à Karol = qualificado + urgente', ia.encaminhados, 2)
  eq('painel IA: finalizações por motivo com rótulo', ia.finalizacoes.map(f => `${f.rotulo}:${f.qtd}`).sort(), ['Buffet / consultor:1', 'Pronto para orçamento:1', 'Urgente (hoje/amanhã):1'])
  eq('painel IA: ERP ok e erro', [ia.erp.ok, ia.erp.erro], [1, 1])
  eq('painel IA: custo e erros', [ia.custoUsd, ia.erros], [0.01, 1])
  eq('painel IA: 7 dias no gráfico', ia.porDia.length, 7)
  const etapasP = [{ id: 's1', nome: 'Novo contato' }, { id: 's2', nome: 'Pronto para orçamento' }, { id: 's3', nome: 'Pedido fechado' }]
  const opps = [
    { status: 'open', pipelineStageId: 's1', monetaryValue: 0, createdAt: new Date(agoraP - 86400000).toISOString() },
    { status: 'open', pipelineStageId: 's2', monetaryValue: 175, createdAt: new Date(agoraP - 2 * 86400000).toISOString() },
    { status: 'won', pipelineStageId: 's3', monetaryValue: 400, lastStatusChangeAt: new Date(agoraP - 86400000).toISOString() },
    { status: 'lost', pipelineStageId: 's2', monetaryValue: 90, lastStatusChangeAt: new Date(agoraP - 86400000).toISOString(), motivoPerda: 'Preço' },
    { status: 'won', pipelineStageId: 's3', monetaryValue: 999, lastStatusChangeAt: new Date(agoraP - 60 * 86400000).toISOString() },
  ]
  const fu = painel.resumirFunil(opps, etapasP, agoraP, 7)
  eq('painel funil: abertos por etapa', fu.etapas.map(e => `${e.nome}:${e.qtd}`), ['Novo contato:1', 'Pronto para orçamento:1', 'Pedido fechado:0'])
  eq('painel funil: ganhos no período (o de 60 dias fica fora)', [fu.ganhos.qtd, fu.ganhos.valor], [1, 400])
  eq('painel funil: perdidos por motivo e conversão', [fu.perdidos.porMotivo, fu.conversao], [[{ motivo: 'Preço', qtd: 1 }], 50])
  const html = painel.renderPainel({ geradoEm: new Date(agoraP).toISOString(), dias: 7, ia, funil: fu, locacao: { hoje: { data: '2026-10-25', saem: ['3 · <script>x</script>'], voltam: [] }, devolucoesPendentes: [{ pedido: '7', cliente: 'Caio', devolucao: '2026-10-20', diasAtraso: 5 }], proximos: [], maisReservados: [], semPeriodo: ['1'] } })
  eq('painel HTML: tem as três seções', ['Atendimento da IA', 'Funil de vendas', 'Locação (VHSYS)'].every(x => html.includes(x)), true)
  eq('painel HTML: escapa texto vindo de cliente', html.includes('<script>x</script>'), false)
  eq('painel HTML: devolução pendente aparece com atraso', /Caio[\s\S]*5 dia\(s\)/.test(html), true)
  eq('painel HTML: fonte fora do ar não derruba a página', painel.renderPainel({ geradoEm: new Date(agoraP).toISOString(), dias: 7, ia, funil: { erro: 'GHL 401' }, locacao: { erro: 'tokens' } }).includes('Não consegui ler o funil do GHL: GHL 401'), true)

  return 0
}
