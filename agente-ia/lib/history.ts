import { findConversationId, getConversationMessages, sleep, type GhlMessage } from './ghl'
import { mediaKindFromUrl, mediaToText } from './media'
import { ehComandoOuSistema, instanciaDaMensagem, limparTexto } from './instancia'
import { k, redis } from './redis'

/**
 * Histórico: no GHL a fonte da verdade é o PRÓPRIO CRM (o agente é stateless).
 * O Redis guarda só o que o GHL não guarda: a transcrição da mídia (feita UMA
 * vez), os ids do que a IA enviou (para distinguir humano × IA) e o corte do
 * "reset" de teste.
 *
 * Regras que vêm de cicatriz (ghl/PEGADINHAS):
 *  - ALLOWLIST de messageType: nota interna NUNCA entra no contexto (§A.11)
 *  - inbound vazio NÃO é descartado: vira "[mídia recebida sem texto]" (§A.3)
 *  - outbound vazio vira marcador (voz enviada por fora cria gap) (§A.4)
 *  - hidratação: o GHL processa o anexo DEPOIS do webhook → espera explícita
 */

export interface ChatMsg { id: string; dir: 'in' | 'out'; text: string; ts: number }

/**
 * Canais de conversa. A Vertisell usa integração de WhatsApp por instâncias, que
 * pode chegar como SMS/custom: aceita WHATSAPP/SMS/CUSTOM/LIVE_CHAT e recusa o
 * que nunca é conversa com o lead (nota interna, activity, e-mail, ligação).
 * Env MESSAGE_TYPES (lista) substitui a regra, se precisar.
 */
const TYPES_ENV = (process.env.MESSAGE_TYPES || '').split(',').map(x => x.trim()).filter(Boolean)
const TYPE_OK = /WHATSAPP|SMS|CUSTOM|LIVE_CHAT/i
const TYPE_NUNCA = /INTERNAL|COMMENT|ACTIVITY|EMAIL|CALL|VOICEMAIL|REVIEW|NOTE/i
const TTL_S = 90 * 86400

export function isChatMessage(m: GhlMessage): boolean {
  if (m.messageType) {
    if (TYPES_ENV.length) return TYPES_ENV.includes(m.messageType)
    return TYPE_OK.test(m.messageType) && !TYPE_NUNCA.test(m.messageType)
  }
  // Sem messageType: só aceita tipos numéricos de WhatsApp/SMS conhecidos (19 = WhatsApp, 2 = SMS)
  return m.type === 19 || m.type === 2
}

/** Último inbound ainda "placeholder" (sem texto e sem anexo) = anexo não hidratado. */
export function lastInboundPending(msgs: GhlMessage[]): boolean {
  const chat = msgs.filter(isChatMessage)
  const last = [...chat].reverse().find(m => m.direction === 'inbound')
  return !!last && !(last.body || '').trim() && !(last.attachments || []).length
}

async function mediaText(m: GhlMessage, allowProcess: boolean): Promise<string> {
  const url = (m.attachments || [])[0]
  if (!url) return ''
  const cacheKey = k('midia', m.id)
  const cached = await redis.get<string>(cacheKey)
  if (cached) return cached
  const kind = mediaKindFromUrl(url)
  if (!allowProcess || !kind) return `[${kind === 'audio' ? 'áudio' : kind === 'image' ? 'imagem' : 'arquivo'} enviado]`
  const text = await mediaToText(kind, url, '')
  await redis.set(cacheKey, text, { ex: TTL_S })
  return text
}

export async function toChatMsgs(raw: GhlMessage[], opts: { corteMs?: number; processarMidiaDesde?: number } = {}): Promise<ChatMsg[]> {
  const out: ChatMsg[] = []
  const chat = raw.filter(isChatMessage)
  const processarDesde = opts.processarMidiaDesde ?? Math.max(0, chat.length - 6)
  for (let i = 0; i < chat.length; i++) {
    const m = chat[i]
    const ts = Date.parse(m.dateAdded || '') || 0
    if (opts.corteMs && ts < opts.corteMs) continue
    const dir: 'in' | 'out' = m.direction === 'inbound' ? 'in' : 'out'
    // Comando da integração ("#attpic") e aviso "[System]:" não são conversa
    if (ehComandoOuSistema(m.body || '')) continue
    let text = limparTexto(m.body || '')
    // outbound que era só "#switch:X" (sem texto) = nada a mostrar
    if (!text && dir === 'out' && (m.body || '').trim() && !(m.attachments || []).length) continue
    if ((m.attachments || []).length) {
      const midia = dir === 'in' ? await mediaText(m, i >= processarDesde) : '[arquivo enviado]'
      text = text ? `${text}\n${midia}` : midia
    }
    if (!text) text = dir === 'in' ? '[mídia recebida sem texto]' : '[mensagem enviada por áudio ou arquivo aqui]'
    out.push({ id: m.id, dir, text, ts })
  }
  return out
}

export interface Conversa { conversationId: string | null; raw: GhlMessage[]; msgs: ChatMsg[]; instancia: string | null; corteMs: number }

/** Instância (número) em que o lead escreveu por último: a IA responde por ela. */
export function ultimaInstancia(raw: GhlMessage[]): string | null {
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i].direction !== 'inbound') continue
    const inst = instanciaDaMensagem(raw[i].body || '')
    if (inst) return inst
  }
  return null
}

/** Lê a conversa do GHL esperando a hidratação do anexo (backoff 12×2s ≈ 24s). */
export async function getHydratedHistory(contactId: string): Promise<Conversa> {
  const conversationId = await findConversationId(contactId)
  if (!conversationId) return { conversationId: null, raw: [], msgs: [], instancia: null, corteMs: 0 }
  let raw = await getConversationMessages(conversationId)
  for (let i = 0; i < 12 && lastInboundPending(raw); i++) {
    await sleep(2000)
    raw = await getConversationMessages(conversationId)
  }
  const corteMs = Number(await redis.get<string>(k('corte', contactId))) || 0
  return { conversationId, raw, msgs: await toChatMsgs(raw, { corteMs }), instancia: ultimaInstancia(raw), corteMs }
}

export function lastInbound(msgs: ChatMsg[]): ChatMsg | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].dir === 'in') return msgs[i]
  return null
}

export async function alreadyAnswered(contactId: string, inboundId: string): Promise<boolean> {
  return (await redis.get<string>(k('done', contactId))) === inboundId
}

export async function markAnswered(contactId: string, inboundId: string): Promise<void> {
  await redis.set(k('done', contactId), inboundId, { ex: 86400 })
}

// ---------- Quem enviou: IA × humano ----------

export async function rememberSent(messageId: string | undefined): Promise<void> {
  if (messageId) await redis.set(k('enviada', messageId), '1', { ex: TTL_S })
}

const HUMANO_JANELA_MS = 6 * 3600 * 1000

/**
 * Um humano do time respondeu pelo GHL nas últimas 6h? A IA recua.
 * Humano = outbound com userId que NÃO foi enviado pela IA.
 * (Mensagem de workflow/automação não tem userId e não conta como humano.)
 * Antes do corte (reset de teste) não conta: o teste recomeça do zero.
 */
export async function humanSpokeRecently(raw: GhlMessage[], now = Date.now(), corteMs = 0): Promise<boolean> {
  const recentes = raw.filter(m =>
    isChatMessage(m) && m.direction === 'outbound' && m.userId &&
    // comando/sistema da integração e mensagem de bot (#switch) não são humano falando
    !ehComandoOuSistema(m.body || '') && !/^\s*#switch:/i.test(m.body || '') &&
    now - (Date.parse(m.dateAdded || '') || 0) < HUMANO_JANELA_MS &&
    (Date.parse(m.dateAdded || '') || 0) >= corteMs)
  for (const m of recentes) {
    if (!(await redis.get(k('enviada', m.id)))) return true
  }
  return false
}
