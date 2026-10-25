import { CONFIG } from './config'

/**
 * Client da API do GHL (LeadConnector v2).
 * - Version 2021-07-28 em tudo, EXCETO calendários (2021-04-15).
 * - User-Agent de browser sempre: sem ele o Cloudflare responde 403 "Error 1010".
 * - Retry com backoff 2/4/8s em 429 (~100 req/10s por location) e 5xx.
 *   O envio de mensagem NÃO repete em 5xx: um 502 pode ter enviado, e repetir
 *   duplicaria a mensagem pro lead.
 */

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

interface ReqOpts { version?: string; retries?: number; retry5xx?: boolean }

export async function ghl<T>(method: string, path: string, body?: unknown, opts: ReqOpts = {}): Promise<T> {
  const retries = opts.retries ?? 3
  const retry5xx = opts.retry5xx ?? true
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${CONFIG.ghlBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${CONFIG.ghlToken}`,
        Version: opts.version || '2021-07-28',
        Accept: 'application/json',
        'User-Agent': UA,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    if (res.ok) return (text ? JSON.parse(text) : {}) as T
    const retryable = res.status === 429 || (retry5xx && res.status >= 500)
    if (retryable && attempt < retries) {
      await sleep(2000 * 2 ** attempt)
      continue
    }
    throw new Error(`GHL ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  }
}

const loc = () => encodeURIComponent(CONFIG.ghlLocationId)

// ---------- Contato ----------

export interface GhlCustomValue { id: string; value?: unknown; field_value?: unknown; fieldValue?: unknown; [k: string]: unknown }

/**
 * Valor de um custom field em qualquer formato que o GHL devolve: contato usa
 * `value`; oportunidade (API v2) usa `fieldValueString`, `fieldValueNumber`,
 * `fieldValueDate`, `fieldValueArray`... conforme o tipo.
 */
export function valorCampo(f: GhlCustomValue): unknown {
  for (const key of ['value', 'field_value', 'fieldValue']) if (f[key] != null) return f[key]
  for (const [key, v] of Object.entries(f)) if (key.startsWith('fieldValue') && v != null) return v
  return null
}

export interface GhlContact {
  id: string
  firstName?: string
  lastName?: string
  name?: string
  contactName?: string
  phone?: string
  email?: string
  address1?: string
  city?: string
  state?: string
  postalCode?: string
  tags?: string[]
  customFields?: GhlCustomValue[]
}

export const contactName = (c: GhlContact) =>
  (c.contactName || c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || '').trim()

/**
 * GET /contacts/{id} às vezes devolve customFields: [] mesmo com dado (ghl §A.12).
 * Para LER campos, o POST /contacts/search é o confiável — fazemos os dois e juntamos.
 */
export async function getContact(contactId: string): Promise<GhlContact> {
  const r = await ghl<{ contact: GhlContact }>('GET', `/contacts/${encodeURIComponent(contactId)}`)
  const c = r.contact
  if (!c.customFields?.length) {
    try {
      const s = await ghl<{ contacts?: GhlContact[] }>('POST', '/contacts/search', {
        locationId: CONFIG.ghlLocationId, pageLimit: 1,
        filters: [{ field: 'id', operator: 'eq', value: contactId }],
      })
      const hit = s.contacts?.find(x => x.id === contactId)
      if (hit?.customFields?.length) c.customFields = hit.customFields
    } catch { /* leitura extra é best-effort */ }
  }
  return c
}

export const contactTags = (c: GhlContact) => (c.tags || []).map(t => String(t))

export async function updateContactFields(contactId: string, values: Array<{ id: string; value: unknown }>): Promise<void> {
  if (!values.length) return
  await ghl('PUT', `/contacts/${encodeURIComponent(contactId)}`, {
    customFields: values.map(v => ({ id: v.id, field_value: v.value, value: v.value })),
  })
}

/** Campos nativos do contato (nome, e-mail, endereço...). `name` vira firstName + lastName. */
export async function updateContactNative(contactId: string, values: Record<string, unknown>): Promise<void> {
  const body: Record<string, unknown> = { ...values }
  if (typeof body.name === 'string') {
    const [first, ...rest] = body.name.trim().split(/\s+/)
    body.firstName = first
    body.lastName = rest.join(' ')
    delete body.name
  }
  if (!Object.keys(body).length) return
  await ghl('PUT', `/contacts/${encodeURIComponent(contactId)}`, body)
}

/** Tags no GHL têm endpoint próprio de add/remove (não substitui o conjunto). */
export async function addContactTags(contactId: string, tags: string[]): Promise<void> {
  if (!tags.length) return
  await ghl('POST', `/contacts/${encodeURIComponent(contactId)}/tags`, { tags })
}

export async function removeContactTags(contactId: string, tags: string[]): Promise<void> {
  if (!tags.length) return
  await ghl('DELETE', `/contacts/${encodeURIComponent(contactId)}/tags`, { tags })
  // Prova: relê. Tag que "saiu com 200" e continua lá = IA que não desliga.
  const drop = new Set(tags.map(t => t.toLowerCase()))
  const still = contactTags(await getContact(contactId)).filter(t => drop.has(t.toLowerCase()))
  if (still.length) throw new Error(`tags não removidas do contato ${contactId}: ${still.join(', ')}`)
}

export async function addContactNote(contactId: string, body: string): Promise<void> {
  await ghl('POST', `/contacts/${encodeURIComponent(contactId)}/notes`, { body })
}

// ---------- Oportunidade ----------

export interface GhlOpportunity {
  id: string
  name?: string
  pipelineId: string
  pipelineStageId: string
  status?: string
  monetaryValue?: number
  contactId?: string
  customFields?: GhlCustomValue[]
}

export async function getOpportunity(id: string): Promise<GhlOpportunity> {
  const r = await ghl<{ opportunity: GhlOpportunity }>('GET', `/opportunities/${encodeURIComponent(id)}`)
  return r.opportunity
}

/**
 * `etapas` informado: só reaproveita oportunidade ABERTA numa destas etapas.
 * Fora delas (pedido antigo já reservado, ganho ou perdido) devolve null e a
 * IA abre uma oportunidade nova em vez de escrever por cima da antiga.
 */
export async function findOpportunity(contactId: string, pipelineId: string, etapas?: string[]): Promise<GhlOpportunity | null> {
  const q = `location_id=${loc()}&contact_id=${encodeURIComponent(contactId)}&pipeline_id=${encodeURIComponent(pipelineId)}&limit=20`
  const r = await ghl<{ opportunities?: GhlOpportunity[] }>('GET', `/opportunities/search?${q}`)
  const list = (r.opportunities || []).filter(o => o.pipelineId === pipelineId)
  const abertas = list.filter(o => (o.status || 'open') === 'open')
  if (etapas?.length) return abertas.find(o => etapas.includes(o.pipelineStageId)) || null
  return abertas[0] || list[0] || null
}

export async function createOpportunity(contactId: string, pipelineId: string, stageId: string, name: string): Promise<GhlOpportunity> {
  const r = await ghl<{ opportunity: GhlOpportunity }>('POST', '/opportunities/', {
    locationId: CONFIG.ghlLocationId, pipelineId, pipelineStageId: stageId, contactId, name, status: 'open',
  })
  return r.opportunity
}

/** PUT de oportunidade: custom field usa a chave `field_value` (não `value`) — ghl §A.12. */
export async function updateOpportunity(id: string, patch: { pipelineStageId?: string; pipelineId?: string; monetaryValue?: number; status?: 'open' | 'won' | 'lost'; customFields?: Array<{ id: string; value: unknown }> }): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.monetaryValue !== undefined) body.monetaryValue = patch.monetaryValue
  if (patch.status) body.status = patch.status
  if (patch.pipelineStageId) body.pipelineStageId = patch.pipelineStageId
  if (patch.pipelineId) body.pipelineId = patch.pipelineId
  if (patch.customFields?.length) body.customFields = patch.customFields.map(v => ({ id: v.id, field_value: v.value }))
  await ghl('PUT', `/opportunities/${encodeURIComponent(id)}`, body)
}

// ---------- Conversa ----------

export interface GhlMessage {
  id: string
  direction?: 'inbound' | 'outbound' | string
  messageType?: string
  type?: number
  body?: string
  attachments?: string[]
  dateAdded?: string
  userId?: string
  source?: string
  status?: string
}

export async function findConversationId(contactId: string): Promise<string | null> {
  const r = await ghl<{ conversations?: Array<{ id: string }> }>('GET', `/conversations/search?locationId=${loc()}&contactId=${encodeURIComponent(contactId)}&limit=1`)
  return r.conversations?.[0]?.id || null
}

/** Últimas mensagens da conversa, da mais ANTIGA para a mais nova. */
export async function getConversationMessages(conversationId: string, limit = 40): Promise<GhlMessage[]> {
  const r = await ghl<{ messages?: { messages?: GhlMessage[] } | GhlMessage[] }>('GET', `/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`)
  const raw = Array.isArray(r.messages) ? r.messages : r.messages?.messages || []
  return [...raw].sort((a, b) => Date.parse(a.dateAdded || '') - Date.parse(b.dateAdded || ''))
}

/** Envio de texto. Sem retry em 5xx (ver topo do arquivo). */
export async function sendMessage(contactId: string, message: string): Promise<{ messageId?: string; conversationId?: string }> {
  return ghl('POST', '/conversations/messages', { type: CONFIG.ghlChannel, contactId, message }, { retry5xx: false })
}

// ---------- Calendário (Version 2021-04-15) ----------

export async function getFreeSlots(calendarId: string, startMs: number, endMs: number, timezone: string): Promise<string[]> {
  const q = `startDate=${startMs}&endDate=${endMs}&timezone=${encodeURIComponent(timezone)}`
  const r = await ghl<Record<string, { slots?: string[] } | unknown>>('GET', `/calendars/${encodeURIComponent(calendarId)}/free-slots?${q}`, undefined, { version: '2021-04-15' })
  const out: string[] = []
  for (const [key, v] of Object.entries(r)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
    const slots = (v as { slots?: string[] })?.slots || []
    out.push(...slots)
  }
  return out.sort((a, b) => Date.parse(a) - Date.parse(b))
}

export async function createAppointment(p: { calendarId: string; contactId: string; startTime: string; endTime: string; title: string }): Promise<{ id?: string }> {
  return ghl('POST', '/calendars/events/appointments', {
    calendarId: p.calendarId, locationId: CONFIG.ghlLocationId, contactId: p.contactId,
    startTime: p.startTime, endTime: p.endTime, title: p.title,
    appointmentStatus: 'confirmed', toNotify: true,
  }, { version: '2021-04-15', retry5xx: false })
}

// ---------- Descoberta / validação ----------

export interface GhlPipeline { id: string; name: string; stages: Array<{ id: string; name: string; position?: number }> }
export interface GhlField { id: string; name: string; fieldKey?: string; dataType: string; model?: string; picklistOptions?: string[]; options?: Array<string | { label?: string; value?: string }> }

export async function listPipelines(): Promise<GhlPipeline[]> {
  return (await ghl<{ pipelines?: GhlPipeline[] }>('GET', `/opportunities/pipelines?locationId=${loc()}`)).pipelines || []
}

export async function listCustomFields(model: 'contact' | 'opportunity'): Promise<GhlField[]> {
  return (await ghl<{ customFields?: GhlField[] }>('GET', `/locations/${loc()}/customFields?model=${model}`)).customFields || []
}

export async function listCalendars(): Promise<Array<{ id: string; name: string }>> {
  return (await ghl<{ calendars?: Array<{ id: string; name: string }> }>('GET', `/calendars/?locationId=${loc()}`, undefined, { version: '2021-04-15' })).calendars || []
}

export async function listTags(): Promise<string[]> {
  return ((await ghl<{ tags?: Array<{ name: string }> }>('GET', `/locations/${loc()}/tags`)).tags || []).map(t => t.name)
}

export const fieldOptions = (f: GhlField): string[] =>
  f.picklistOptions?.length ? f.picklistOptions : (f.options || []).map(o => typeof o === 'string' ? o : (o.label || o.value || '')).filter(Boolean)

export function customValue(list: GhlCustomValue[] | undefined, id: string): unknown {
  const f = (list || []).find(v => v.id === id)
  return f ? valorCampo(f) : null
}
