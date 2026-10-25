/**
 * npm test — travas determinísticas do MOTOR (sem rede, sem env de produção).
 * Cada cliente ACRESCENTA os casos das próprias regras (lib/regras.ts) em test-cliente.ts.
 */
process.env.GHL_TOKEN ||= 'pit-x'
process.env.GHL_LOCATION_ID ||= 'loc'
process.env.OPENAI_API_KEY ||= 'x'
process.env.UPSTASH_REDIS_REST_URL ||= 'https://x.upstash.io'
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'x'
process.env.WEBHOOK_SECRET ||= 'x'

let falhas = 0
export function eq(nome: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${ok ? '' : ` → recebido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`}`)
}

async function main() {
  const { checkReply, evidenceFound, keepLastQuestion, matchOption, parseNumeroBR } = await import('../lib/guards')
  const regras = (t: string) => [...new Set(checkReply(t, []).map(v => v.regra))]

  // ---------- Degeneração do modelo ----------
  eq('tool vazada', regras('salvar_respostas({"campo":"x"}) to=functions.salvar_respostas 重庆'), ['texto corrompido'])
  eq('JSON vazado', regras('{"respostas":[{"campo":"nome","evidencia":"joão","valor":"João"}]}'), ['texto corrompido'])
  eq('duas perguntas', regras('Qual o seu cargo? E quantos funcionários a empresa tem?'), ['mais de uma pergunta'])
  eq('cumprimento não conta como pergunta', regras('Olá, tudo certo? Aqui é da Control Gestão. Me conta rapidinho, hoje como você faz o acompanhamento dos seus leads e clientes?'), [])
  eq('texto normal passa', regras('Entendi, Cláudia. Quantos funcionários a empresa tem hoje?'), [])
  eq('corta eco da pergunta do lead', keepLastQuestion('Vocês atendem MEI? Atendemos sim. Qual o faturamento mensal?', 'vocês atendem mei?'), 'Atendemos sim. Qual o faturamento mensal?')

  // ---------- Números e opções ----------
  eq('R$ 1.491,00', parseNumeroBR('R$ 1.491,00'), 1491)
  eq('2,6 mil', parseNumeroBR('2,6 mil'), 2600)
  eq('não sei', parseNumeroBR('não sei'), null)
  eq('opção por texto', matchOption('ate 10 funcionarios', [{ value: 'Até 10 funcionários' }, { value: 'Mais de 10' }])?.value, 'Até 10 funcionários')
  eq('"sim" ambíguo', matchOption('sim', [{ value: 'Sim, MEI' }, { value: 'Sim, LTDA' }]), null)

  // ---------- Anti-invenção ----------
  const lead = 'Somos 12 aqui na empresa e o faturamento dá uns 80 mil por mês'
  eq('evidência real', evidenceFound('somos 12 aqui na empresa', lead), true)
  eq('evidência inventada', evidenceFound('já usa outro sistema de gestão', lead), false)

  // ---------- Webhook do GHL ----------
  const { extractContactId, extractLocationId } = await import('../api/inbound')
  eq('contact_id no topo', extractContactId({ contact_id: 'c1' }), 'c1')
  eq('custom data', extractContactId({ customData: { contact_id: 'c2' }, contact_id: 'c9' }), 'c2')
  eq('contact.id', extractContactId({ contact: { id: 'c3' } }), 'c3')
  eq('sem contato', extractContactId({ foo: 1 }), '')
  eq('location', extractLocationId({ location: { id: 'L1' } }), 'L1')

  // ---------- Histórico do GHL ----------
  const { isChatMessage, lastInboundPending, toChatMsgs } = await import('../lib/history')
  eq('WhatsApp entra', isChatMessage({ id: '1', messageType: 'TYPE_WHATSAPP' }), true)
  eq('NOTA INTERNA não entra', isChatMessage({ id: '2', messageType: 'TYPE_INTERNAL_COMMENT' }), false)
  eq('activity não entra', isChatMessage({ id: '3', messageType: 'TYPE_ACTIVITY_OPPORTUNITY' }), false)
  eq('inbound placeholder = aguardar hidratação', lastInboundPending([{ id: 'a', messageType: 'TYPE_WHATSAPP', direction: 'inbound', body: '' }]), true)
  eq('inbound com anexo = pronto', lastInboundPending([{ id: 'a', messageType: 'TYPE_WHATSAPP', direction: 'inbound', body: '', attachments: ['https://x/a.pdf'] }]), false)
  const msgs = await toChatMsgs([
    { id: 'n', messageType: 'TYPE_INTERNAL_COMMENT', direction: 'outbound', body: 'cliente chato, cuidado', dateAdded: '2026-09-22T10:00:00Z' },
    { id: 'i', messageType: 'TYPE_WHATSAPP', direction: 'inbound', body: 'oi', dateAdded: '2026-09-22T10:01:00Z' },
    { id: 'o', messageType: 'TYPE_WHATSAPP', direction: 'outbound', body: '', dateAdded: '2026-09-22T10:02:00Z' },
    { id: 'v', messageType: 'TYPE_WHATSAPP', direction: 'inbound', body: '', dateAdded: '2026-09-22T10:03:00Z' },
  ], { processarMidiaDesde: 99 })
  eq('nota interna fora + vazios viram marcador', msgs.map(m => `${m.dir}:${m.text}`), ['in:oi', 'out:[mensagem enviada por áudio ou arquivo aqui]', 'in:[mídia recebida sem texto]'])
  const cortado = await toChatMsgs([
    { id: 'a', messageType: 'TYPE_WHATSAPP', direction: 'inbound', body: 'velho', dateAdded: '2026-09-22T10:00:00Z' },
    { id: 'b', messageType: 'TYPE_WHATSAPP', direction: 'inbound', body: 'novo', dateAdded: '2026-09-22T11:00:00Z' },
  ], { corteMs: Date.parse('2026-09-22T10:30:00Z') })
  eq('corte do reset', cortado.map(m => m.text), ['novo'])

  // ---------- Integração por instâncias (Vertisell) ----------
  const { instanciaDaMensagem, ehComandoOuSistema, limparTexto, comInstancia } = await import('../lib/instancia')
  eq('lê a instância do inbound', instanciaDaMensagem('2\n\nInstance Source: Operacional@'), 'Operacional@')
  eq('limpa Instance Source', limparTexto('"Olá! Quero saber mais sobre a IA SDR. #C01"\n\nInstance Source: Operacional@'), '"Olá! Quero saber mais sobre a IA SDR. #C01"')
  eq('limpa #switch do bot', limparTexto('#switch:Operacional@\nCerto, vou te encaminhar'), 'Certo, vou te encaminhar')
  eq('#attpic é comando', ehComandoOuSistema('#attpic'), true)
  eq('#contact_instance é comando', ehComandoOuSistema('#contact_instance:Operacional@'), true)
  eq('[System] é sistema', ehComandoOuSistema('[System]: Contact photo updated successfully.'), true)
  eq('texto com #C01 NÃO é comando', ehComandoOuSistema('Quero saber mais #C01'), false)
  eq('responde pela instância', comInstancia('Oi!', 'Operacional@'), '#switch:Operacional@\nOi!')
  const conv = await toChatMsgs([
    { id: '1', messageType: 'TYPE_SMS', direction: 'inbound', body: '"Olá! Quero saber mais sobre a IA SDR. #C01"\n\nInstance Source: Operacional@', dateAdded: '2026-09-23T11:08:00Z' },
    { id: '2', messageType: 'TYPE_SMS', direction: 'outbound', body: '#attpic', dateAdded: '2026-09-23T11:08:01Z' },
    { id: '3', messageType: 'TYPE_SMS', direction: 'outbound', body: '[System]: Contact photo updated successfully.', dateAdded: '2026-09-23T11:08:02Z', userId: 'u' },
    { id: '4', messageType: 'TYPE_SMS', direction: 'outbound', body: '#switch:Operacional@\nOlá! Sou atendente da Control Gestão.', dateAdded: '2026-09-23T11:08:03Z' },
    { id: '5', messageType: 'TYPE_SMS', direction: 'inbound', body: '2\n\nInstance Source: Operacional@', dateAdded: '2026-09-23T11:08:04Z' },
  ], { processarMidiaDesde: 99 })
  eq('conversa real limpa', conv.map(m => `${m.dir}:${m.text}`), ['in:"Olá! Quero saber mais sobre a IA SDR. #C01"', 'out:Olá! Sou atendente da Control Gestão.', 'in:2'])
  const { humanSpokeRecently: hs, ultimaInstancia } = await import('../lib/history')
  eq('instância da conversa', ultimaInstancia([{ id: 'a', direction: 'inbound', body: 'oi\nInstance Source: Operacional@' }]), 'Operacional@')
  eq('[System] com userId NÃO é humano', await hs([{ id: 'x', messageType: 'TYPE_SMS', direction: 'outbound', body: '[System]: Contact Instance Updated!', userId: 'u', dateAdded: new Date().toISOString() }]), false)
  const agora = Date.now()
  eq('humano antes do corte (reset de teste) não conta', await hs([{ id: 'h', messageType: 'TYPE_SMS', direction: 'outbound', body: 'Teste envio', userId: 'u', dateAdded: new Date(agora - 60000).toISOString() }], agora, agora - 1000), false)
  eq('custom provider entra', isChatMessage({ id: 'c', messageType: 'TYPE_CUSTOM_SMS' }), true)
  eq('e-mail não entra', isChatMessage({ id: 'e', messageType: 'TYPE_EMAIL' }), false)

  // ---------- Agenda (comum §44: escolha resolvida em código) ----------
  const { resolverEscolha, formatSlot, espalhar } = await import('../lib/slots')
  const tz = 'America/Sao_Paulo'
  const oferta = ['2026-09-24T13:00:00-03:00', '2026-09-24T15:00:00-03:00', '2026-09-25T10:00:00-03:00', '2026-09-25T15:30:00-03:00']
  const iso = (r: ReturnType<typeof resolverEscolha>) => r.ok ? formatSlot(r.iso, tz) : r.motivo
  eq('formata slot', formatSlot(oferta[0], tz), 'qui 24/09 às 13:00')
  eq('"o primeiro"', iso(resolverEscolha('pode ser o primeiro', oferta, tz)), 'qui 24/09 às 13:00')
  eq('"a segunda" = ordinal', iso(resolverEscolha('a segunda', oferta, tz)), 'qui 24/09 às 15:00')
  eq('"10h"', iso(resolverEscolha('10h fica bom', oferta, tz)), 'sex 25/09 às 10:00')
  eq('"16 HORAS" não oferecido', iso(resolverEscolha('16 HORAS', oferta, tz)), 'nenhum')
  eq('"15h" = 15:00 (não 15:30)', iso(resolverEscolha('15h', oferta, tz)), 'qui 24/09 às 15:00')
  eq('"10h" ambíguo entre dias', iso(resolverEscolha('10h', [...oferta, '2026-09-28T10:00:00-03:00'], tz)), 'ambiguo')
  eq('"quinta às 15"', iso(resolverEscolha('quinta às 15', oferta, tz)), 'qui 24/09 às 15:00')
  eq('"15:30"', iso(resolverEscolha('15:30', oferta, tz)), 'sex 25/09 às 15:30')
  eq('"sexta 15h30"', iso(resolverEscolha('sexta 15h30', oferta, tz)), 'sex 25/09 às 15:30')
  eq('"ultimo"', iso(resolverEscolha('o último', oferta, tz)), 'sex 25/09 às 15:30')
  eq('sem oferta', iso(resolverEscolha('15h', [], tz)), 'nenhum')
  eq('espalha entre dias', espalhar(oferta, 2, tz).map(s => formatSlot(s, tz)), ['qui 24/09 às 13:00', 'sex 25/09 às 10:00'])

  // ---------- Alçada (fail-closed) ----------
  const { CRM_MAP } = await import('../lib/crm-map')
  const { podeMover, runTool, coerce } = await import('../lib/tools')
  const salvo = { op: { ...CRM_MAP.oportunidade }, etapas: CRM_MAP.etapas }
  CRM_MAP.oportunidade.pipelineId = 'P'
  CRM_MAP.oportunidade.stageOrder = ['novo', 'qualificado', 'agendado', 'proposta']
  CRM_MAP.etapas = [{ id: 'qualificado', name: 'Qualificado', quando: 'x' }, { id: 'agendado', name: 'Agendado', quando: 'y' }]
  const lv = (stageId: string | null, pipelineId: string | null = 'P') => ({ id: 'c', opportunityId: stageId ? 'o' : null, pipelineId, stageId, fields: {}, tags: [] })
  eq('avança novo → qualificado', podeMover(lv('novo'), 'qualificado'), null)
  eq('sem oportunidade → pode criar e mover', podeMover(lv(null, null), 'agendado'), null)
  eq('NÃO volta proposta → agendado', !!podeMover(lv('proposta'), 'agendado'), true)
  eq('NÃO mexe em outro funil', !!podeMover(lv('novo', 'OUTRO'), 'qualificado'), true)
  eq('NÃO mexe em etapa desconhecida', !!podeMover(lv('xyz'), 'qualificado'), true)
  eq('NÃO move para fora da alçada', !!podeMover(lv('novo'), 'proposta'), true)
  CRM_MAP.oportunidade = salvo.op
  CRM_MAP.etapas = salvo.etapas

  // ---------- Multiselect: une com o que já existe ----------
  const ms = coerce({ key: 'm', id: 'f', model: 'contact', name: 'Serviços', type: 'multiselect', options: ['Contábil', 'Fiscal', 'Folha'] }, 'fiscal', ['Contábil'])
  eq('multiselect union', 'value' in ms ? ms.value : ms, ['Contábil', 'Fiscal'])

  // ---------- Finalização: remove a tag de gate e exige evidência ----------
  const porta = CRM_MAP.portas.find(p => p.ativa) || CRM_MAP.portas[0]
  const mundo = { tags: new Set(['gate', 'outra']), state: {} as Record<string, any> }
  const port = {
    getLead: async () => ({ id: 'c', opportunityId: null, pipelineId: null, stageId: null, fields: {}, tags: [...mundo.tags] }),
    writeFields: async () => {}, moveStage: async () => {}, addNote: async () => {},
    addTags: async (t: string[]) => { t.forEach(x => mundo.tags.add(x)) },
    removeTags: async (t: string[]) => { t.forEach(x => mundo.tags.delete(x)) },
    getState: async () => ({ ...mundo.state }),
    patchState: async (p: Record<string, unknown>) => Object.assign(mundo.state, p),
    freeSlots: async () => [], book: async () => ({}), saveOffer: async () => {}, getOffer: async () => [],
  }
  const ctx = (lead: string) => ({ port, porta, gateTag: 'gate', timezone: tz, leadText: lead, lastLeadText: lead, lastAgentText: '' }) as any
  let out = await runTool(ctx('quanto custa?'), 'finalizar_atendimento', { motivo: 'desistiu', evidencia: 'não quero mais', resumo: 'x' })
  eq('desistência inventada NÃO finaliza', [out.isError, mundo.tags.has('gate')], [true, true])
  out = await runTool(ctx('obrigado, mas não tenho interesse mais'), 'finalizar_atendimento', { motivo: 'desistiu', evidencia: 'não tenho interesse mais', resumo: 'x' })
  eq('desistência real finaliza e remove SÓ o gate', [out.isError, out.handoff, mundo.tags.has('gate'), mundo.tags.has('outra'), mundo.state.finalizado?.motivo], [false, true, false, true, 'desistiu'])
  mundo.state = {}
  out = await runTool(ctx('pode marcar'), 'finalizar_atendimento', { motivo: 'agendado', resumo: 'x' })
  eq('agendado sem reunião marcada é recusado', out.isError, true)
  if (porta.obrigatorios.length) {
    mundo.state = {}
    out = await runTool(ctx('oi'), 'finalizar_atendimento', { motivo: 'qualificado', resumo: 'x' })
    eq('qualificado com roteiro incompleto é recusado', out.isError, true)
  }

  // ---------- Roteador ----------
  const { rotear } = await import('../lib/router')
  if (!CRM_MAP.menu.ativo) {
    const r = rotear({}, 'oi, boa tarde')
    eq('sem menu → porta padrão direto', r.tipo === 'porta' && r.porta.id, CRM_MAP.menu.portaPadrao)
  }

  // Só "arquivo não existe" é ignorado: teste do cliente com erro de sintaxe tem que FALHAR, não sumir
  const extra = await import('./test-cliente').catch((e: unknown) => {
    if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(String((e as { code?: string })?.code || e))) return null
    throw e
  })
  if (extra?.default) { const extras = await extra.default(eq); falhas += extras }

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ Todas as travas OK')
  process.exit(falhas ? 1 : 0)
}
main()
