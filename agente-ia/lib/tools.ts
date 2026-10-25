import type OpenAI from 'openai'
import { CRM_MAP, campoByKey, type Campo, type Porta } from './crm-map'
import { montarPedido, reais, textoItens } from './catalogo'
import { conferirEvidenciaData, dataPelaEvidencia, diasEntre, formatarData, hojeNoFuso, parseDataBR } from './datas'
import { periodoPadrao, textoDisponibilidade } from './locacao'
import { DISSE_NAO_SEI, evidenceFound, matchOption, norm, overlap, parseNumeroBR } from './guards'
import { classificar } from './router'
import { espalhar, formatSlot, resolverEscolha } from './slots'
import type { LeadState } from './state'

/**
 * As tools falam com o CRM por uma PORTA DE DADOS. Produção = GHL + Redis
 * (lib/port.ts); evals/testes = memória. A regra de negócio é a MESMA.
 */

export interface LeadView {
  id: string
  /** oportunidade do contato no funil configurado (null = ainda não existe) */
  opportunityId: string | null
  pipelineId: string | null
  stageId: string | null
  /** valores atuais por id do campo (contato + oportunidade) */
  fields: Record<string, unknown>
  tags: string[]
}

export interface FieldWrite { campo: Campo; value: string | number | string[] }

/** Prefixo do id de campo nativo do contato (native:name, native:email...) */
export const NATIVO = 'native:'

export interface LeadPort {
  getLead(): Promise<LeadView>
  writeFields(values: FieldWrite[]): Promise<void>
  moveStage(stageId: string): Promise<void>
  addTags(tags: string[]): Promise<void>
  removeTags(tags: string[]): Promise<void>
  addNote(text: string): Promise<void>
  /** valor da oportunidade no funil (o "Valor" do card) */
  setValor?(valor: number): Promise<void>
  /** agenda de reservas (VHSYS): livre de cada código no intervalo. Ausente = agenda não configurada */
  disponibilidade?(codigos: string[], de: string, ate: string): Promise<Array<{ codigo: string; nome: string; total: number | null; livre: number | null }>>
  getState(): Promise<LeadState>
  patchState(p: Partial<LeadState>): Promise<LeadState>
  /** agenda: horários livres reais (ISO) */
  freeSlots(): Promise<string[]>
  book(startIso: string): Promise<{ id?: string }>
  saveOffer(slots: string[]): Promise<void>
  getOffer(): Promise<string[]>
}

export interface ToolCtx {
  port: LeadPort
  porta: Porta
  gateTag: string
  timezone: string
  /** tudo que o lead escreveu (trava anti-invenção) */
  leadText: string
  /** último bloco do lead (o turno atual) */
  lastLeadText: string
  /** última mensagem da IA antes do turno (a pergunta respondida) */
  lastAgentText: string
}

export interface ToolOutcome { content: string; isError: boolean; handoff?: boolean; urgente?: boolean }

const ok = (content: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ content, isError: false, ...extra })
const err = (content: string): ToolOutcome => ({ content, isError: true })

export const MOTIVOS = ['qualificado', 'agendado', 'nao_qualificado', 'ja_e_cliente', 'fora_do_escopo', 'pediu_humano', 'desistiu', 'urgente', 'outro_servico'] as const
type Motivo = typeof MOTIVOS[number]

/** Sinal mínimo que a evidência precisa ter para cada motivo de finalização. */
const SINAL_PADRAO: Partial<Record<Motivo, RegExp>> = {
  ja_e_cliente: /j[aá] sou cliente|sou cliente|j[aá] contratei|meu contrato|suporte|minha conta|meu acesso|j[aá] uso/i,
  desistiu: /desist|n[aã]o (quero|tenho interesse|preciso) mais|deixa (pra|para) l[aá]|pode encerrar|n[aã]o quero continuar|n[aã]o vou (querer|continuar)|sem interesse/i,
  pediu_humano: /humano|pessoa|atendente|consultor|vendedor|algu[eé]m|falar com|me liga|liga[cç][aã]o|reclam/i,
  urgente: /hoje|amanh[aã]|urgente|agora|pra j[aá]|daqui a pouco|logo mais/i,
}
/** O cliente pode trocar o sinal de um motivo (ex.: o que é "já sou cliente" numa locadora) */
const sinalMotivo = (m: Motivo): RegExp | undefined => (CRM_MAP.finalizar.sinalMotivo as Partial<Record<string, RegExp>> | undefined)?.[m] ?? SINAL_PADRAO[m]

/** Campo condicional fora do caso (ex.: endereço do evento quando é retirada na loja) */
const aplicavel = (campo: Campo, state: LeadState) => !campo.aplicavel || campo.aplicavel(state.respostas || {})

export const agendaAtiva = () => !!CRM_MAP.agenda.calendarId

export function buildTools(porta: Porta): OpenAI.Chat.ChatCompletionTool[] {
  const tools: OpenAI.Chat.ChatCompletionTool[] = []
  if (porta.roteiro.length) {
    tools.push({
      type: 'function',
      function: {
        name: 'salvar_respostas',
        description: 'Grava TODAS as respostas do roteiro que o lead já deu (várias de uma vez se ele respondeu muita coisa numa mensagem). Chame ANTES de fazer a próxima pergunta. O retorno diz o que falta.',
        parameters: {
          type: 'object',
          properties: {
            respostas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  campo: { type: 'string', enum: [...porta.roteiro, ...(porta.extras || [])].filter(key => !campoByKey(key)?.soPorTool) },
                  evidencia: { type: 'string', description: 'Trecho LITERAL do que o lead escreveu que comprova a resposta. Sem trecho do lead = não salve.' },
                  valor: { type: 'string', description: 'Opção: o texto EXATO de uma das opções. Número: algarismos. Data: dd/mm/aaaa (converta "sábado", "amanhã" pela data de hoje do contexto). Texto: como o lead disse. "Não sabe" só se ele disse que não sabe.' },
                },
                required: ['campo', 'evidencia', 'valor'],
                additionalProperties: false,
              },
            },
          },
          required: ['respostas'],
          additionalProperties: false,
        },
      },
    })
  }
  tools.push({
    type: 'function',
    function: {
      name: 'registrar_respondente',
      description: 'Registra QUEM está digitando quando não é o próprio interessado (ex.: a secretária falando pelo sócio). Depois chame a pessoa pelo nome dela.',
      parameters: {
        type: 'object',
        properties: { nome: { type: 'string' }, relacao: { type: 'string', description: 'sócio, secretária, contador, o próprio...' } },
        required: ['nome', 'relacao'],
        additionalProperties: false,
      },
    },
  })
  if (CRM_MAP.portas.filter(p => p.ativa).length > 1) {
    tools.push({
      type: 'function',
      function: {
        name: 'registrar_outro_assunto',
        description: 'O lead trouxe um assunto de OUTRA ÁREA atendida pela empresa (outro serviço, não uma dúvida do assunto atual). Registra para a equipe; você continua no assunto atual.',
        parameters: {
          type: 'object',
          properties: { assunto: { type: 'string' }, evidencia: { type: 'string', description: 'Trecho literal do lead' } },
          required: ['assunto', 'evidencia'],
          additionalProperties: false,
        },
      },
    })
  }
  if (agendaAtiva()) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'consultar_horarios',
          description: 'Busca horários LIVRES reais na agenda do consultor. Chame quando o lead aceitar a demonstração. Se ele disse que prefere manhã ou tarde, passe o período. Ofereça ao lead SÓ os horários que esta tool devolver, exatamente como vierem.',
          parameters: {
            type: 'object',
            properties: { periodo: { type: 'string', enum: ['manha', 'tarde', 'qualquer'], description: 'Preferência do lead' } },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'agendar_reuniao',
          description: 'Marca a reunião no horário que o lead ESCOLHEU entre os oferecidos. Passe as palavras do lead ("15h", "o primeiro", "quinta às 10"). O sistema resolve o horário exato e confirma.',
          parameters: {
            type: 'object',
            properties: { escolha: { type: 'string', description: 'O que o lead escreveu ao escolher o horário' } },
            required: ['escolha'],
            additionalProperties: false,
          },
        },
      },
    )
  }
  if (CRM_MAP.catalogo) {
    tools.push({
      type: 'function',
      function: {
        name: 'calcular_tabela',
        description: 'Soma o pedido pela tabela de preços, em código, e grava os itens no CRM. Passe SEMPRE o pedido INTEIRO como está agora (cada chamada substitui a anterior). Use sempre que a pessoa passar ou mudar itens e antes de falar qualquer total. Fale os valores exatamente como a ferramenta devolver.',
        parameters: {
          type: 'object',
          properties: {
            itens: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  codigo: { type: 'string', description: 'Código do catálogo (ex.: LOU-001). Vazio se o item não está no catálogo.' },
                  descricao: { type: 'string', description: 'Nome do item' },
                  quantidade: { type: 'integer' },
                  evidencia: { type: 'string', description: 'Trecho LITERAL do que a pessoa escreveu pedindo este item' },
                },
                required: ['codigo', 'descricao', 'quantidade', 'evidencia'],
                additionalProperties: false,
              },
            },
          },
          required: ['itens'],
          additionalProperties: false,
        },
      },
    })
    tools.push({
      type: 'function',
      function: {
        name: 'consultar_disponibilidade',
        description: 'Consulta a AGENDA DE RESERVAS da loja: quanto de cada item está livre no período da locação (retirada → devolução) para a data do evento. Use quando a pessoa perguntar se tem o item pra data, e na primeira vez que o pedido tiver itens e data. Passe os itens com o código do catálogo e a quantidade.',
        parameters: {
          type: 'object',
          properties: {
            itens: {
              type: 'array',
              items: {
                type: 'object',
                properties: { codigo: { type: 'string' }, quantidade: { type: 'integer' } },
                required: ['codigo', 'quantidade'],
                additionalProperties: false,
              },
            },
            data_evento: { type: 'string', description: 'dd/mm/aaaa. Vazio = a data do evento já gravada.' },
          },
          required: ['itens', 'data_evento'],
          additionalProperties: false,
        },
      },
    })
  }
  tools.push({
    type: 'function',
    function: {
      name: 'finalizar_atendimento',
      description: 'Encerra a participação da IA nesta conversa. Chame ANTES de escrever a mensagem de encerramento. Use quando: o roteiro obrigatório está completo (qualificado); a reunião foi marcada (agendado); o lead não tem o perfil (nao_qualificado); já é cliente com assunto de suporte (ja_e_cliente); o assunto está fora do que a empresa faz (fora_do_escopo); o lead pediu para falar com uma pessoa (pediu_humano); desistiu; o caso é para hoje ou amanhã e a equipe precisa ver já (urgente); ou quer outro serviço da empresa que um consultor atende (outro_servico). Depois disso envie a mensagem de encerramento e NÃO faça perguntas.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', enum: [...MOTIVOS] },
          evidencia: { type: 'string', description: 'Trecho literal do lead que justifica o motivo (dispensado para "qualificado" e "agendado")' },
          resumo: { type: 'string', description: '2 a 4 frases para o time: quem é, a situação e o que busca' },
        },
        required: ['motivo', 'resumo'],
        additionalProperties: false,
      },
    },
  })
  // O modelo só vê as etapas que dependem de julgamento; as mecânicas (Em Contato, Agendada) o código move
  const etapasModelo = CRM_MAP.etapas.filter(e => !e.soCodigo && e.id !== CRM_MAP.etapaEmContatoId && e.id !== CRM_MAP.etapaAgendadoId)
  if (etapasModelo.length && CRM_MAP.oportunidade.pipelineId) {
    tools.push({
      type: 'function',
      function: {
        name: 'mover_etapa',
        description: `Move o lead de etapa no funil. Opções: ${etapasModelo.map(e => `"${e.name}" (${e.quando})`).join('; ')}`,
        parameters: {
          type: 'object',
          properties: { etapa: { type: 'string', enum: etapasModelo.map(e => e.name) } },
          required: ['etapa'],
          additionalProperties: false,
        },
      },
    })
  }
  return tools
}

// ---------- Snapshot do roteiro ----------

export interface Snapshot { preenchidos: Array<{ campo: Campo; valor: string }>; abertos: Campo[] }

export function snapshot(porta: Porta, state: LeadState): Snapshot {
  const preenchidos: Snapshot['preenchidos'] = []
  const abertos: Campo[] = []
  for (const key of porta.roteiro) {
    const campo = campoByKey(key)
    if (!campo || !aplicavel(campo, state)) continue
    const v = state.respostas?.[key]
    if (v) preenchidos.push({ campo, valor: v })
    else if (!(state.semResposta || []).includes(key)) abertos.push(campo)
  }
  return { preenchidos, abertos }
}

export function describeOpen(porta: Porta, s: Snapshot): string {
  if (!porta.roteiro.length) return ''
  if (!s.abertos.length) {
    return agendaAtiva()
      ? 'Roteiro COMPLETO. Se a pessoa tem o perfil: chame mover_etapa("Qualificado") e CONVIDE para a demonstração gratuita perguntando se prefere manhã ou tarde. NÃO finalize agora: finalizar vem só depois de agendar ou se a pessoa recusar a demonstração. Sem perfil: siga a parte "Sem perfil" do prompt.'
      : 'Roteiro COMPLETO. Chame finalizar_atendimento(qualificado) AGORA e depois mande o resumo do pedido para a pessoa conferir, como manda o fechamento do prompt.'
  }
  const prox = s.abertos[0]
  const opc = prox.options ? ` (grave com uma destas opções EXATAS: ${prox.options.join(' | ')})` : ''
  const lista = s.abertos.length > 1 ? ` (em aberto: ${s.abertos.map(c => c.name).join('; ')})` : ''
  const via = prox.soPorTool ? ` [grava com ${prox.soPorTool}]` : ''
  return `Faltam ${s.abertos.length}${lista}. Próximo assunto do roteiro → ${prox.name}${via}${prox.pergunta ? ` ("${prox.pergunta}")` : ''}${opc}. Se o lead já respondeu algo em aberto, grave ANTES de perguntar.`
}

// ---------- Execução ----------

const asArray = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : v ? [String(v)] : []

export function coerce(campo: Campo, raw: string, atual?: unknown, hoje = hojeNoFuso('America/Sao_Paulo')): { value: FieldWrite['value']; texto: string } | { error: string } {
  if (campo.type === 'date') {
    const d = parseDataBR(raw, hoje)
    return 'error' in d ? { error: `${campo.name}: ${d.error}` } : { value: d.iso, texto: formatarData(d.iso) }
  }
  if (campo.type === 'select' || campo.type === 'multiselect') {
    const opts = (campo.options || []).map(value => ({ value }))
    const escolhidas = campo.type === 'multiselect' ? raw.split(/\s*[,;|]\s*/) : [raw]
    const vals: string[] = []
    for (const e of escolhidas) {
      const m = matchOption(e, opts)
      if (!m) return { error: `"${e}" não é opção de "${campo.name}" — use uma destas: ${opts.map(o => o.value).join(' | ')}` }
      vals.push(m.value)
    }
    if (campo.type === 'multiselect') {
      // grava o conjunto inteiro: UNION com o que já existe (não apaga a escolha anterior)
      const all = [...new Set([...asArray(atual), ...vals])]
      return { value: all, texto: vals.join(', ') }
    }
    return { value: vals[0], texto: vals[0] }
  }
  if (campo.type === 'numeric') {
    const n = parseNumeroBR(raw)
    return n === null ? { error: `"${raw}" não é número para "${campo.name}"` } : { value: n, texto: String(n) }
  }
  const t = raw.trim().slice(0, campo.type === 'textarea' ? 2000 : 250)
  return t ? { value: t, texto: t } : { error: `valor vazio para "${campo.name}"` }
}

/** Guard da alçada: só PARA FRENTE, só no funil configurado, etapa conhecida. Fail-closed. */
export function podeMover(lead: LeadView, alvoId: string): string | null {
  const ordem = CRM_MAP.oportunidade.stageOrder
  if (!CRM_MAP.etapas.some(e => e.id === alvoId)) return 'Etapa fora da alçada da IA.'
  if (lead.opportunityId && lead.pipelineId !== CRM_MAP.oportunidade.pipelineId) return 'O lead está em outro funil — não vou mover.'
  const iAlvo = ordem.indexOf(alvoId)
  if (iAlvo < 0) return 'Etapa alvo não está no stageOrder — não vou mover.'
  if (!lead.stageId) return null
  const iAtual = ordem.indexOf(lead.stageId)
  if (iAtual < 0) return 'O lead está numa etapa desconhecida — não vou mover.'
  if (iAtual >= iAlvo) return 'O lead já está nesta etapa ou mais à frente — não vou voltar.'
  return null
}

/** Efeitos no CRM ao finalizar. Ordem importa: primeiro desliga (tag), depois marca o estado. */
export async function aplicarFinalizacao(ctx: ToolCtx, motivo: string, resumoRaw: string, urgente = false): Promise<void> {
  const { port, porta } = ctx
  const state = await port.getState()
  const resumo = resumoRaw.trim().slice(0, 1500)
  if (CRM_MAP.finalizar.removerGate && ctx.gateTag) await port.removeTags([ctx.gateTag])
  const extras = [
    ...CRM_MAP.finalizar.tags,
    ...(CRM_MAP.finalizar.tagsPorMotivo[motivo] || []),
    ...(urgente && CRM_MAP.finalizar.tagUrgente ? [CRM_MAP.finalizar.tagUrgente] : []),
  ]
  if (extras.length) await port.addTags([...new Set(extras)])
  // Qualificado sem reunião marcada: a oportunidade vai para "Qualificado" (código, não o modelo)
  if (motivo === 'qualificado' && CRM_MAP.etapaQualificadoId) {
    try {
      if (!podeMover(await port.getLead(), CRM_MAP.etapaQualificadoId)) await port.moveStage(CRM_MAP.etapaQualificadoId)
    } catch (e) { console.warn('[finalizar] não moveu para Qualificado:', e) }
  }
  // Resumo para o vendedor no campo do contato
  const cr = CRM_MAP.finalizar.campoResumo
  if (cr?.id && resumo) {
    const agendaTxt = state.agendado ? ` Reunião: ${formatSlot(state.agendado.inicio, ctx.timezone)}.` : ''
    const texto = `[IA · ${motivo}] ${resumo}${agendaTxt}`.slice(0, 2000)
    try {
      await port.writeFields([{ campo: { key: 'resumo', id: cr.id, model: cr.model, name: 'Resumo conversa IA', type: 'textarea' }, value: texto }])
    } catch (e) { console.warn('[finalizar] não gravou o resumo:', e) }
  }
  if (CRM_MAP.finalizar.nota) {
    const linhas = snapshot(porta, state).preenchidos.map(p => `• ${p.campo.name}: ${p.valor}`)
    const quem = state.respondenteNome ? `\nQuem conversou: ${state.respondenteNome} (${state.respondenteRelacao || '—'})` : ''
    const outro = state.outroAssunto ? `\nOutro assunto citado: ${state.outroAssunto}` : ''
    const agenda = state.agendado ? `\nReunião marcada: ${formatSlot(state.agendado.inicio, ctx.timezone)}` : ''
    await port.addNote(`🤖 IA finalizou · ${porta.label} · ${motivo}${urgente ? ' · URGENTE' : ''}\n\n${resumo}${quem}${outro}${agenda}\n\n${linhas.join('\n')}`)
  }
  await port.patchState({ finalizado: { motivo, resumo, em: new Date().toISOString() } })
}

export async function runTool(ctx: ToolCtx, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const { port, porta } = ctx
  try {
    switch (name) {
      case 'salvar_respostas': {
        const state = await port.getState()
        const lead = await port.getLead()
        const lista = Array.isArray(input.respostas) ? input.respostas as Array<Record<string, unknown>> : []
        const writes: FieldWrite[] = []
        const respostas = { ...(state.respostas || {}) }
        const semResposta = new Set(state.semResposta || [])
        const salvos: string[] = []
        const erros: string[] = []
        const avisos: string[] = []
        for (const r of lista) {
          const key = String(r.campo || '')
          const campo = porta.roteiro.includes(key) || (porta.extras || []).includes(key) ? campoByKey(key) : undefined
          if (!campo) { erros.push(`"${key}" não é do roteiro`); continue }
          if (campo.soPorTool) { erros.push(`${campo.name} se grava com ${campo.soPorTool}`); continue }
          const ev = String(r.evidencia || '')
          if (state.respostas?.[key]) { erros.push(`${campo.name} já estava respondido (${state.respostas[key]}) — não pergunte de novo`); continue }
          const valor = String(r.valor ?? '')
          const naoSei = DISSE_NAO_SEI.test(ev)
          const respondeuPergunta = !!campo.pergunta && overlap(ctx.lastAgentText, campo.pergunta) >= 0.6 && evidenceFound(ev, ctx.lastLeadText)
          if (!evidenceFound(ev, ctx.leadText)) { erros.push(`${campo.name}: a evidência "${ev}" não aparece no que o lead escreveu — NÃO invente; pergunte`); continue }
          if (campo.sinal && !campo.sinal.test(ev) && !naoSei && !respondeuPergunta) { erros.push(`${campo.name}: a evidência "${ev}" não fala deste assunto — NÃO invente; pergunte`); continue }
          if (/n[aã]o sabe/i.test(valor) && !naoSei) { erros.push(`${campo.name}: "Não sabe" só quando o lead disser que não sabe`); continue }
          if (naoSei && campo.type !== 'select' && campo.type !== 'multiselect') {
            semResposta.add(key)
            salvos.push(`${campo.name} = (não sabe)`)
            continue
          }
          // Texto guarda as PALAVRAS DO LEAD (a evidência literal), nunca o resumo do modelo
          // Campo nativo (nome, e-mail, endereço): vale o valor limpo, desde que esteja dentro da evidência
          const nativoLimpo = campo.id.startsWith(NATIVO) && !!valor.trim() && evidenceFound(valor, ev)
          const hoje = hojeNoFuso(ctx.timezone)
          // "hoje", "amanhã", "sábado": a data sai do código, não da conta do modelo
          const pelaEvidencia = campo.type === 'date' ? dataPelaEvidencia(ev, hoje) : null
          const bruto = pelaEvidencia ?? ((campo.type === 'text' || campo.type === 'textarea') && !nativoLimpo ? ev : valor)
          const c = coerce(campo, bruto, campo.id ? lead.fields[campo.id] : undefined, hoje)
          if ('error' in c) { erros.push(c.error); continue }
          if (campo.type === 'date') {
            const errData = conferirEvidenciaData(ev, String(c.value), hoje)
            if (errData) { erros.push(`${campo.name}: ${errData}. Corrija a data`); continue }
            const dias = diasEntre(hoje, String(c.value))
            if (dias <= 1) avisos.push(`${campo.name} é ${dias === 0 ? 'HOJE' : 'AMANHÃ'}: siga a regra de pedido urgente do prompt`)
          }
          respostas[key] = c.texto
          salvos.push(`${campo.name} = ${c.texto}`)
          if (campo.id && !CRM_MAP.camposProibidos.includes(campo.id)) writes.push({ campo, value: c.value })
        }
        if (writes.length) await port.writeFields(writes)
        const next = await port.patchState({ respostas, semResposta: [...semResposta] })
        return {
          isError: erros.length > 0 && salvos.length === 0,
          content: [salvos.length ? `Salvo: ${salvos.join(' · ')}.` : '', erros.length ? `Não salvo: ${erros.join(' · ')}.` : '', avisos.length ? `⚠️ ${avisos.join(' · ')}.` : '', describeOpen(porta, snapshot(porta, next))].filter(Boolean).join(' '),
        }
      }

      case 'registrar_respondente': {
        const nome = String(input.nome || '').trim().slice(0, 60)
        if (!nome || !evidenceFound(nome, ctx.leadText)) return err('Nome não registrado: ele não aparece no que o lead escreveu.')
        await port.patchState({ respondenteNome: nome, respondenteRelacao: String(input.relacao || '').trim().slice(0, 60) })
        return ok(`Anotado: quem está falando é ${nome}. Chame por este nome.`)
      }

      case 'registrar_outro_assunto': {
        const citado = `${input.assunto || ''} ${input.evidencia || ''}`
        if (!evidenceFound(String(input.evidencia || ''), ctx.leadText)) return err('Não registrado: o lead não citou esse assunto.')
        if (!classificar(citado).some(p => p.id !== porta.id)) return err('Não registrado: isso faz parte do assunto atual. Responda dentro do roteiro.')
        await port.patchState({ outroAssunto: String(input.assunto || '').slice(0, 200) })
        return ok('Registrado para a equipe. Diga ao lead que a equipe também verá esse assunto e SIGA o roteiro atual.')
      }

      case 'consultar_horarios': {
        if (!agendaAtiva()) return err('Agenda não configurada.')
        const state = await port.getState()
        if (state.agendado) return ok(`Já existe reunião marcada: ${formatSlot(state.agendado.inicio, ctx.timezone)}. Não marque outra.`)
        const todos = await port.freeSlots()
        const periodo = String(input.periodo || 'qualquer')
        const hora = (iso: string) => Number(formatSlot(iso, ctx.timezone).slice(-5, -3))
        const doPeriodo = periodo === 'manha' ? todos.filter(x => hora(x) < 12) : periodo === 'tarde' ? todos.filter(x => hora(x) >= 12) : todos
        const livres = doPeriodo.length ? doPeriodo : todos
        if (!livres.length) return err('Nenhum horário livre nos próximos dias. Diga ao lead que o time vai propor um horário e continue a conversa, sem prometer data.')
        const oferta = espalhar(livres, CRM_MAP.agenda.maxOfertas, ctx.timezone)
        await port.saveOffer(oferta)
        await port.patchState({ consultouAgenda: true })
        return ok(`Horários livres (ofereça EXATAMENTE estes, sem inventar outros): ${oferta.map((s, i) => `${i + 1}) ${formatSlot(s, ctx.timezone)}`).join(' · ')}. Fuso: horário de Brasília.`)
      }

      case 'agendar_reuniao': {
        if (!agendaAtiva()) return err('Agenda não configurada.')
        const state = await port.getState()
        if (state.agendado) return ok(`Reunião já marcada para ${formatSlot(state.agendado.inicio, ctx.timezone)}. Confirme ao lead, não marque outra.`)
        const escolha = String(input.escolha || '')
        if (!evidenceFound(escolha, ctx.lastLeadText) && !evidenceFound(escolha, ctx.leadText)) return err('A escolha precisa ser o que o lead escreveu. Pergunte qual horário ele prefere.')
        let oferta = await port.getOffer()
        // Sem oferta salva (expirou): consulta fresca como fallback
        if (!oferta.length) oferta = (await port.freeSlots()).slice(0, 40)
        const r = resolverEscolha(escolha, oferta, ctx.timezone)
        if (!r.ok) {
          if (r.motivo === 'ambiguo') return err(`Mais de um horário combina com "${escolha}": ${r.candidatos.map(s => formatSlot(s, ctx.timezone)).join(' · ')}. Pergunte qual deles.`)
          return err(`"${escolha}" não corresponde a nenhum horário oferecido. Chame consultar_horarios e ofereça de novo.`)
        }
        // Revalida na fonte imediatamente antes de criar
        const livresAgora = await port.freeSlots()
        if (!livresAgora.some(s => Date.parse(s) === Date.parse(r.iso))) return err(`O horário ${formatSlot(r.iso, ctx.timezone)} acabou de ser ocupado. Chame consultar_horarios e ofereça outros.`)
        const ev = await port.book(r.iso)
        await port.patchState({ agendado: { inicio: r.iso, eventoId: ev.id } })
        if (CRM_MAP.etapaAgendadoId) {
          const lead = await port.getLead()
          if (!podeMover(lead, CRM_MAP.etapaAgendadoId)) await port.moveStage(CRM_MAP.etapaAgendadoId)
        }
        return ok(`Reunião MARCADA para ${formatSlot(r.iso, ctx.timezone)} (horário de Brasília). Confirme ao lead exatamente este dia e hora. Depois chame finalizar_atendimento(agendado).`)
      }

      case 'finalizar_atendimento': {
        const motivo = String(input.motivo || '') as Motivo
        if (!MOTIVOS.includes(motivo)) return err(`Motivo inválido: ${motivo}`)
        const state = await port.getState()
        if (motivo === 'qualificado') {
          const sem = new Set(state.semResposta || [])
          const faltando = porta.obrigatorios.filter(key => {
            const campo = campoByKey(key)
            return (!campo || aplicavel(campo, state)) && !state.respostas?.[key] && !(sem.has(key) && !campo?.options)
          })
          if (faltando.length) return err(`Ainda falta: ${faltando.map(key => campoByKey(key)?.name || key).join('; ')}. ${describeOpen(porta, snapshot(porta, state))}`)
          // Qualificado sem tentar agendar = reunião perdida. Só vale depois de consultar a agenda ou se a pessoa recusou.
          const recusou = /n[aã]o (quero|posso|precis|tenho tempo)|agora n[aã]o|depois (eu )?(vejo|marco|falo)|mais pra frente|sem tempo|me chama depois/i.test(ctx.lastLeadText)
          if (agendaAtiva() && !state.consultouAgenda && !recusou) {
            return err('NÃO finalizado: a pessoa tem o perfil e ainda não foi convidada para a demonstração. Convide agora (pergunte se prefere manhã ou tarde) e use consultar_horarios. Finalize como qualificado só se ela recusar marcar ou nenhum horário servir.')
          }
        } else if (motivo === 'agendado') {
          if (!state.agendado) return err('Nenhuma reunião foi marcada ainda. Use agendar_reuniao antes.')
        } else {
          // Urgente sem evidência: a última mensagem do lead serve, se ela mostrar a urgência
          const ev = String(input.evidencia || '') || (motivo === 'urgente' ? ctx.lastLeadText : '')
          const sinal = sinalMotivo(motivo)
          // Urgente: a data já gravada (hoje ou amanhã) é prova suficiente
          const dataGravada = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(state.respostas?.dataEvento || ''))
          const dataUrgente = motivo === 'urgente' && !!dataGravada && diasEntre(hojeNoFuso(ctx.timezone), `${dataGravada[3]}-${dataGravada[2]}-${dataGravada[1]}`) <= 1
          const veto = (CRM_MAP.finalizar as { vetoMotivo?: Record<string, { re: RegExp; salvo?: RegExp; msg: string }> }).vetoMotivo?.[motivo]
          if (veto && veto.re.test(ev) && !veto.salvo?.test(ev)) return err(`NÃO finalizado: ${veto.msg}.`)
          if (!dataUrgente && (!evidenceFound(ev, ctx.leadText) || (sinal && !sinal.test(ev)))) {
            if (!ev.trim()) return err(`NÃO finalizado: falta a evidência. Chame de novo com "evidencia" = o trecho literal do lead que mostra "${motivo}".`)
            return err(`NÃO finalizado: a evidência "${ev}" não comprova "${motivo}" no que o lead escreveu. Continue o atendimento.`)
          }
        }
        const urgente = motivo === 'urgente'
        await aplicarFinalizacao(ctx, motivo, String(input.resumo || ''), urgente)
        return ok(`Atendimento da IA finalizado (${motivo}). Envie a mensagem de encerramento prevista no prompt para este caso. NÃO faça perguntas e NÃO prometa contato em prazo específico.`, { handoff: true, urgente })
      }

      case 'consultar_disponibilidade': {
        const cat = CRM_MAP.catalogo
        if (!cat) return err('Catálogo não configurado.')
        if (!port.disponibilidade) return ok('A agenda de reservas não está ligada. Não fale de disponibilidade: diga que a nossa equipe confere para a data.')
        const hoje = hojeNoFuso(ctx.timezone)
        const state = await port.getState()
        const bruto = String(input.data_evento || '').trim() || String(state.respostas?.dataEvento || '').replace(/^\S+\s/, '')
        const d = bruto ? parseDataBR(bruto, hoje) : { error: 'sem data' }
        if ('error' in d) return err('Sem data do evento válida: pergunte a data antes de consultar a agenda.')
        const pedidos = (Array.isArray(input.itens) ? input.itens as Array<Record<string, unknown>> : [])
          .map(i => ({ item: cat.itens.find(c => c.codigo === String(i.codigo || '').trim().toUpperCase()), quantidade: Number(i.quantidade) }))
          .filter(i => i.item && Number.isInteger(i.quantidade) && i.quantidade > 0)
        if (!pedidos.length) return err('Nenhum item válido: passe o código do catálogo e a quantidade.')
        const periodo = periodoPadrao(d.iso)
        let agenda: Awaited<ReturnType<NonNullable<LeadPort['disponibilidade']>>>
        try { agenda = await port.disponibilidade(pedidos.map(p => p.item!.codigo), periodo.inicio, periodo.fim) }
        catch (e) {
          console.warn('[consultar_disponibilidade] agenda fora:', e)
          return ok('A agenda não respondeu agora. Não fale de disponibilidade: diga que a nossa equipe confere para a data.')
        }
        const r = textoDisponibilidade(pedidos.map(p => {
          const a = agenda.find(x => x.codigo === p.item!.codigo)
          return { codigo: p.item!.codigo, nome: p.item!.nome, quantidade: p.quantidade, livre: a ? a.livre : null }
        }), periodo, d.iso)
        // Só libera falar de "agenda"/"livre" se a agenda tinha o estoque de algum item
        if (r.conhecidos) await port.patchState({ agendaConsultada: { data: d.iso, ok: r.ok, em: Date.now() } })
        return ok(r.texto)
      }

      case 'calcular_tabela': {
        const cat = CRM_MAP.catalogo
        if (!cat) return err('Catálogo não configurado.')
        // Linha repetida com a mesma evidência é eco do modelo, não pedido em dobro ("50 pratos... e mais 30 pratos" tem evidências diferentes)
        const vistos = new Set<string>()
        const lista = (Array.isArray(input.itens) ? input.itens as Array<Record<string, unknown>> : []).filter(i => {
          const chave = `${String(i.codigo || '').trim().toUpperCase()}|${Number(i.quantidade)}|${norm(String(i.evidencia || ''))}`
          if (vistos.has(chave)) return false
          vistos.add(chave)
          return true
        })
        // Mesmo pedido mandado com código E sem código (mesma evidência) = eco: fica só a linha do catálogo
        const evComCodigo = new Set(lista.filter(i => String(i.codigo || '').trim()).map(i => norm(String(i.evidencia || ''))))
        for (let i = lista.length - 1; i >= 0; i--) {
          if (!String(lista[i].codigo || '').trim() && evComCodigo.has(norm(String(lista[i].evidencia || '')))) lista.splice(i, 1)
        }
        const semEvidencia = lista.filter(i => !evidenceFound(String(i.evidencia || ''), ctx.leadText)).map(i => String(i.descricao || i.codigo))
        if (semEvidencia.length) return err(`Nada gravado: a pessoa não pediu ${semEvidencia.join(', ')} (a evidência não aparece no que ela escreveu). NÃO invente item; pergunte.`)
        // Quantidade inventada ("algumas mesas" virando 1): a pessoa tem que ter dito um número
        const semQuantidade = lista.filter(i => !quantidadeDita(String(i.evidencia || ''), Number(i.quantidade), ctx.leadText)).map(i => String(i.descricao || i.codigo))
        if (semQuantidade.length) return err(`Nada gravado: a pessoa não disse quantos quer de ${semQuantidade.join(', ')}. NÃO invente quantidade: responda o que ela perguntou (pode dar o valor por unidade) e pergunte quantos ela precisa.`)
        const r = montarPedido(lista.map(i => ({ codigo: String(i.codigo || ''), descricao: String(i.descricao || ''), quantidade: Number(i.quantidade) })), cat.itens)
        if ('erros' in r) return err(`Nada gravado: ${r.erros.join(' · ')}.`)
        const p = r.pedido
        const campoItens = campoByKey(cat.campoItens)
        const campoValor = cat.campoValor ? campoByKey(cat.campoValor) : undefined
        const texto = textoItens(p)
        const writes: FieldWrite[] = []
        if (campoItens?.id) writes.push({ campo: campoItens, value: texto })
        if (campoValor?.id) writes.push({ campo: campoValor, value: p.total })
        if (writes.length) await port.writeFields(writes)
        if (port.setValor) await port.setValor(p.total)
        const state = await port.getState()
        const respostas = { ...(state.respostas || {}), [cat.campoItens]: p.linhas.map(l => `${l.quantidade} × ${l.descricao}`).join('; ') }
        if (cat.campoValor) respostas[cat.campoValor] = reais(p.total)
        const next = await port.patchState({ respostas })
        if (cat.etapaAoCalcular) {
          try { if (!podeMover(await port.getLead(), cat.etapaAoCalcular)) await port.moveStage(cat.etapaAoCalcular) } catch (e) { console.warn('[calcular_tabela] não moveu a etapa:', e) }
        }
        const avista = cat.descontoAVista ? ` Pagando tudo à vista (${Math.round(cat.descontoAVista * 100)}% no material): ${reais(Math.round(p.total * (1 - cat.descontoAVista) * 100) / 100)}.` : ''
        return ok([
          `Pedido gravado:\n${texto}`,
          `Total de tabela${p.semPreco.length || p.foraDoCatalogo.length ? ' dos itens com preço' : ''}: ${reais(p.total)}, sem frete.${p.total ? avista : ''}`,
          p.semPreco.length ? `Sem preço na tabela (a equipe passa o valor): ${p.semPreco.join(', ')}.` : '',
          p.foraDoCatalogo.length ? `Fora do catálogo (a equipe vê se tem parecido): ${p.foraDoCatalogo.join(', ')}.` : '',
          describeOpen(porta, snapshot(porta, next)),
        ].filter(Boolean).join('\n'))
      }

      case 'mover_etapa': {
        const etapa = CRM_MAP.etapas.find(e => e.name === input.etapa)
        if (!etapa) return err('Etapa fora da alçada.')
        const lead = await port.getLead()
        const bloqueio = podeMover(lead, etapa.id)
        if (bloqueio) return err(bloqueio)
        await port.moveStage(etapa.id)
        return ok(`Lead em "${etapa.name}".`)
      }

      default:
        return err(`Tool desconhecida "${name}".`)
    }
  } catch (e) {
    return err(`Falha ao executar ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const NUMERO_ESCRITO = /\b(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent[oa]s|trezent[oa]s|quatrocent[oa]s|quinhent[oa]s|mil|d[uú]zias?|meia d[uú]zia)\b/i

/** A quantidade veio da pessoa? Número (ou número escrito) na evidência, ou o mesmo número em algo que ela escreveu. */
export function quantidadeDita(evidencia: string, quantidade: number, leadText: string): boolean {
  if (/\d/.test(evidencia) || NUMERO_ESCRITO.test(evidencia)) return true
  return Number.isFinite(quantidade) && new RegExp(`(^|\\D)${quantidade}(\\D|$)`).test(leadText)
}
