import OpenAI from 'openai'
import { CRM_MAP, portaById } from './crm-map'
import { costUsd } from './execlog'
import type { ChatMsg } from './history'
import { createBrain } from './llm'
import type { LeadPort } from './tools'

/**
 * O EXAME DO CÉREBRO — roda os prompts do deploy com as tools REAIS numa porta
 * em memória (zero efeito no CRM, zero mensagem enviada). Usado pelo CLI
 * (scripts/evals.ts) e pelo endpoint /api/evals (roda na Vercel).
 *
 * Cada cenário: checagens em CÓDIGO + critérios para um juiz cego.
 * Portão: qualquer checagem falhando ou critério reprovado = reprovado.
 */

export interface World {
  stageId: string | null
  pipelineId: string | null
  fields: Record<string, unknown>
  /** horários livres simulados da agenda (ISO) */
  slots: string[]
  oferta: string[]
  agendamentos: string[]
  tags: Set<string>
  notes: string[]
  state: Record<string, any>
  log: string[]
}

export interface Turno { lead: string; resposta: string; tools: string[]; guard: string[]; handoff: boolean }

export interface Cenario {
  id: string
  porta: string
  nomeContato?: string
  /** conversa anterior (já em andamento) */
  historico?: Array<['in' | 'out', string]>
  state?: Record<string, any>
  msgs: string[]
  /** agenda simulada (ISO). Padrão: 3 dias úteis à frente, 10h/14h/16h */
  slots?: string[]
  checks: Array<{ nome: string; fn: (w: World, t: Turno[]) => boolean }>
  criterios: string[]
}

export interface ResultadoCenario {
  id: string
  rodada: number
  passou: boolean
  nota: number
  falhasCodigo: string[]
  falhasJuiz: Array<{ criterio: string; porque: string }>
  conversa: Turno[]
  log: string[]
}

export interface Relatorio { aprovado: boolean; total: number; reprovados: number; custoUsd: number; modelo: string; resultados: ResultadoCenario[] }

/** Agenda simulada: próximos 3 dias úteis às 10h, 14h e 16h (Brasília). */
export function slotsPadrao(): string[] {
  const out: string[] = []
  const d = new Date()
  while (out.length < 9) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue
    const ymd = d.toISOString().slice(0, 10)
    for (const h of ['10', '14', '16']) out.push(`${ymd}T${h}:00:00-03:00`)
  }
  return out
}

function memoryPort(w: World): LeadPort {
  return {
    async getLead() { return { id: 'eval', opportunityId: w.stageId ? 'opp' : null, pipelineId: w.pipelineId, stageId: w.stageId, fields: structuredClone(w.fields), tags: [...w.tags] } },
    async writeFields(vs) { for (const v of vs) { w.fields[v.campo.id] = v.value; w.log.push(`grava ${v.campo.key}=${JSON.stringify(v.value).slice(0, 120)}`) } },
    async moveStage(s) { w.stageId = s; w.pipelineId = CRM_MAP.oportunidade.pipelineId || 'eval'; w.log.push(`etapa → ${CRM_MAP.etapas.find(e => e.id === s)?.name || s}`) },
    async addTags(t) { t.forEach(x => w.tags.add(x.toLowerCase())); w.log.push(`tags + ${t.join(',')}`) },
    async removeTags(t) { t.forEach(x => w.tags.delete(x.toLowerCase())); w.log.push(`tags - ${t.join(',')}`) },
    async addNote(n) { w.notes.push(n) },
    async getState() { return structuredClone(w.state) },
    async patchState(p) { Object.assign(w.state, p); return structuredClone(w.state) },
    async freeSlots() { return [...w.slots] },
    async book(iso) { w.agendamentos.push(iso); w.slots = w.slots.filter(s => s !== iso); w.log.push(`agendou ${iso}`); return { id: `ev${w.agendamentos.length}` } },
    async saveOffer(s) { w.oferta = [...s] },
    async getOffer() { return [...w.oferta] },
  }
}

export async function runEvals(opts: {
  apiKey: string
  cenarios: Cenario[]
  model: string
  judgeModel: string
  filtros?: string[]
  reps?: number
  gateTag?: string
}): Promise<Relatorio> {
  const openai = new OpenAI({ apiKey: opts.apiKey })
  const GATE = (opts.gateTag || 'gate').toLowerCase()
  const lista = opts.cenarios.filter(c => !opts.filtros?.length || opts.filtros.some(f => c.id.includes(f)))
  const reps = opts.reps || 1
  let custo = 0

  async function rodar(c: Cenario, rodada: number): Promise<ResultadoCenario> {
    const porta = portaById(c.porta)
    if (!porta) throw new Error(`cenário ${c.id}: porta ${c.porta} não existe`)
    const w: World = { stageId: null, pipelineId: null, fields: {}, slots: c.slots || slotsPadrao(), oferta: [], agendamentos: [], tags: new Set([GATE]), notes: [], state: { porta: porta.id, portaEm: 0, ...structuredClone(c.state || {}) }, log: [] }
    const brain = createBrain({
      apiKey: opts.apiKey, model: opts.model,
      onTool: (nome, input, out) => { w.log.push(`${nome}(${JSON.stringify(input).slice(0, 200)}) → ${out.isError ? 'ERRO ' : ''}${out.content.slice(0, 200)}`) },
    })
    const history: ChatMsg[] = (c.historico || []).map(([dir, text], i) => ({ id: `h${i}`, dir, text, ts: i + 1 }))
    const turnos: Turno[] = []
    for (const msg of c.msgs) {
      if (w.state.finalizado) break
      history.push({ id: `m${history.length}`, dir: 'in', text: msg, ts: history.length + 1 })
      const iOut = history.map(m => m.dir).lastIndexOf('out')
      const bloco = history.slice(iOut + 1).map(m => m.text).join('\n')
      const reply = await brain.generateReply({
        port: memoryPort(w), porta, gateTag: GATE, timezone: 'America/Sao_Paulo',
        leadText: history.filter(m => m.dir === 'in').map(m => m.text).join('\n'),
        lastLeadText: bloco,
        lastAgentText: iOut >= 0 ? history[iOut].text : '',
      }, { nomeContato: c.nomeContato || '', primeiroContatoDaPorta: !history.some(m => m.dir === 'out') }, history)
      const resposta = reply?.text || ''
      custo += reply ? costUsd(opts.model, reply.usage) || 0 : 0
      turnos.push({ lead: msg, resposta, tools: reply?.toolsUsed || [], guard: reply?.guard || [], handoff: !!reply?.handoff })
      history.push({ id: `r${history.length}`, dir: 'out', text: resposta, ts: history.length + 1 })
    }

    const falhasCodigo = c.checks.filter(ch => { try { return !ch.fn(w, turnos) } catch { return true } }).map(ch => ch.nome)
    const transcript = turnos.map(t => `LEAD: ${t.lead}\nIA: ${t.resposta}`).join('\n\n')
    const juiz = await openai.chat.completions.create({
      model: opts.judgeModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Você avalia a conversa de um atendente virtual de WhatsApp. Para CADA critério responda se foi atendido. Seja rigoroso e literal. JSON: {"criterios":[{"criterio":"...","ok":true|false,"porque":"..."}]}' },
        { role: 'user', content: `CRITÉRIOS:\n${c.criterios.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nCONVERSA:\n${transcript}` },
      ],
    })
    const veredito = JSON.parse(juiz.choices[0].message.content || '{"criterios":[]}') as { criterios: Array<{ criterio: string; ok: boolean; porque: string }> }
    const falhasJuiz = (veredito.criterios || []).filter(x => !x.ok).map(x => ({ criterio: x.criterio, porque: x.porque }))
    const nota = c.criterios.length ? Math.round(((c.criterios.length - falhasJuiz.length) / c.criterios.length) * 100) / 10 : 10
    const passou = !falhasCodigo.length && !falhasJuiz.length && (veredito.criterios || []).length >= c.criterios.length
    return { id: c.id, rodada, passou, nota, falhasCodigo, falhasJuiz, conversa: turnos, log: w.log }
  }

  // Cenários em paralelo (cabe no tempo de uma função da Vercel)
  const jobs: Array<Promise<ResultadoCenario>> = []
  for (const c of lista) for (let r = 1; r <= reps; r++) jobs.push(rodar(c, r).catch(e => ({
    id: c.id, rodada: r, passou: false, nota: 0, falhasCodigo: [`erro: ${e instanceof Error ? e.message : String(e)}`], falhasJuiz: [], conversa: [], log: [],
  })))
  const resultados = await Promise.all(jobs)
  const reprovados = resultados.filter(r => !r.passou).length
  return { aprovado: reprovados === 0, total: resultados.length, reprovados, custoUsd: Math.round(custo * 10000) / 10000, modelo: opts.model, resultados }
}
