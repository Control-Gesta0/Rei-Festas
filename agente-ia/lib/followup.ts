import { CONFIG } from './config'
import { logExec } from './execlog'
import { contactName, contactTags, getContact } from './ghl'
import { SO_AGRADECIMENTO } from './guards'
import { getHydratedHistory, type ChatMsg } from './history'
import { k, redis } from './redis'
import { getState, patchState, type LeadState } from './state'
import { sendReply } from './transport'

/**
 * FOLLOW-UP: o lead escreveu, a IA respondeu e ele sumiu → depois de FOLLOWUP_HORAS
 * (em horário comercial) a IA pergunta UMA vez se ainda pode ajudar.
 * Fila no Redis (sorted set, score = quando enviar); o cron /api/followup esvazia.
 * FOLLOWUP_HORAS=0 desliga.
 */

export const FOLLOWUP_HORAS = Number(process.env.FOLLOWUP_HORAS ?? 2)
/** horário comercial no fuso da loja: das 8h às 20h; fora dele, fica para as 9h */
export const HORARIO = { inicio: 8, fim: 20, retomar: 9 }

const FILA = () => k('followup')

/** Hora e minuto locais (0-23, 0-59) de um instante no fuso. */
function horaLocal(ms: number, tz: string): { h: number; m: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms))
  return { h: Number(p.find(x => x.type === 'hour')?.value) % 24, m: Number(p.find(x => x.type === 'minute')?.value) }
}

/** O instante dentro do horário comercial: igual se já está; senão, as 9h seguintes. */
export function emHorarioComercial(ms: number, tz: string): number {
  const { h, m } = horaLocal(ms, tz)
  if (h >= HORARIO.inicio && h < HORARIO.fim) return ms
  const minutos = h >= HORARIO.fim ? (24 - h + HORARIO.retomar) * 60 - m : (HORARIO.retomar - h) * 60 - m
  return ms + minutos * 60e3
}

export function textoFollowup(nome: string): string {
  const primeiro = (nome || '').trim().split(/\s+/)[0] || ''
  const nomeOk = /^[A-Za-zÀ-ÿ]{2,}$/.test(primeiro) ? `, ${primeiro.charAt(0).toUpperCase()}${primeiro.slice(1).toLowerCase()}` : ''
  return `Oi${nomeOk}! Ainda posso te ajudar com alguma coisa? 😊`
}

/**
 * Por que NÃO mandar o follow-up agora (null = pode mandar).
 * `iaEnviou(id)` diz se a mensagem de saída foi da IA (e não da equipe).
 */
export function motivoSemFollowup(p: {
  state: LeadState; tags: string[]; msgs: ChatMsg[]; iaEnviou: (id: string) => boolean
}): string | null {
  const tags = p.tags.map(t => t.toLowerCase())
  if (tags.includes(CONFIG.humanTag)) return `tag "${CONFIG.humanTag}"`
  if (CONFIG.gateTag && !tags.includes(CONFIG.gateTag)) return `sem a tag "${CONFIG.gateTag}"`
  if (p.state.finalizado) return 'atendimento já passou para a equipe'
  const ultima = p.msgs[p.msgs.length - 1]
  if (!ultima) return 'conversa vazia'
  if (ultima.dir === 'in') return 'o lead respondeu'
  if (!p.iaEnviou(ultima.id)) return 'a equipe respondeu por último'
  const iUltimaIn = p.msgs.map(m => m.dir).lastIndexOf('in')
  if (iUltimaIn < 0) return 'o lead nunca escreveu'
  if (p.state.followupEm && p.state.followupEm > p.msgs[iUltimaIn].ts) return 'follow-up já enviado depois da última mensagem do lead'
  const iAntes = p.msgs.slice(0, iUltimaIn + 1).map(m => m.dir).lastIndexOf('out')
  const ultimoBloco = p.msgs.slice(iAntes + 1, iUltimaIn + 1).map(m => m.text).join(' ')
  if (SO_AGRADECIMENTO.test(ultimoBloco)) return 'o lead só agradeceu'
  return null
}

/** Depois de uma resposta da IA (que não passou para a equipe): agenda o follow-up. */
export async function agendarFollowup(contactId: string, agora = Date.now()): Promise<void> {
  if (!FOLLOWUP_HORAS) return
  const quando = emHorarioComercial(agora + FOLLOWUP_HORAS * 3600e3, CONFIG.timezone)
  await redis.zadd(FILA(), { score: quando, member: contactId })
}

/** Cron: envia os follow-ups vencidos. Cada contato sai da fila antes de ser processado (sem envio duplo). */
export async function rodarFollowups(agora = Date.now(), max = 25): Promise<{ enviados: number; pulados: number; adiados: number }> {
  const r = { enviados: 0, pulados: 0, adiados: 0 }
  if (!FOLLOWUP_HORAS) return r
  const vencidos = await redis.zrange<string[]>(FILA(), 0, agora, { byScore: true, offset: 0, count: max })
  for (const contactId of vencidos) {
    if (!(await redis.zrem(FILA(), contactId))) continue
    let nome = ''
    try {
      const hora = emHorarioComercial(agora, CONFIG.timezone)
      if (hora !== agora) { await redis.zadd(FILA(), { score: hora, member: contactId }); r.adiados++; continue }
      const contato = await getContact(contactId)
      nome = contactName(contato)
      const state = await getState(contactId)
      const conv = await getHydratedHistory(contactId)
      const enviadas = new Set<string>()
      for (const m of conv.msgs.filter(x => x.dir === 'out').slice(-3)) if (await redis.get(k('enviada', m.id))) enviadas.add(m.id)
      const motivo = motivoSemFollowup({ state, tags: contactTags(contato), msgs: conv.msgs, iaEnviou: id => enviadas.has(id) })
      if (motivo) { r.pulados++; console.log(`[followup] ${contactId}: não enviou (${motivo})`); continue }
      const detail = await sendReply(contactId, textoFollowup(nome), conv.instancia)
      await patchState(contactId, { followupEm: Date.now() })
      await logExec({ tipo: 'followup', leadId: contactId, nome, detalhe: detail })
      r.enviados++
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
      console.error(`[followup] ERRO ${contactId}: ${msg}`)
      await logExec({ tipo: 'erro', leadId: contactId, nome, detalhe: `follow-up: ${msg}` })
    }
  }
  return r
}
