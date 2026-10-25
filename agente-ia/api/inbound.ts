import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import crypto from 'crypto'
import { processContact } from '../lib/agent'
import { CONFIG } from '../lib/config'
import { redis } from '../lib/redis'

/**
 * Webhook do workflow do GHL ("Customer Replied" → Custom Webhook).
 * URL: POST /api/inbound?secret=<WEBHOOK_SECRET>
 * Corpo: o payload padrão do GHL (tem contact_id) ou Custom Data com contact_id.
 *
 * 200 IMEDIATO + waitUntil: se demorar, o GHL REENVIA o webhook e o lead
 * recebe resposta dupla. O conteúdo da mensagem NÃO vem do webhook: o agente
 * lê a conversa na API (fonte da verdade, com mídia hidratada).
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    let redisOk = false
    try { redisOk = (await redis.ping()) === 'PONG' } catch { /* redis fora */ }
    return res.status(200).json({ ok: true, service: 'agente-ia-ghl', cliente: CONFIG.clientName, model: CONFIG.llmModel, gate: CONFIG.gateTag || '(todos)', redis: redisOk })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const provided = String(req.headers['x-webhook-secret'] || req.query.secret || '')
  if (!safeEq(provided, CONFIG.webhookSecret)) return res.status(401).json({ error: 'unauthorized' })

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as Record<string, unknown> | null
  const contactId = extractContactId(body, req.query)
  if (!contactId) return res.status(200).json({ ok: false, reason: 'sem contact_id no corpo' })
  const locationId = extractLocationId(body)
  if (locationId && locationId !== CONFIG.ghlLocationId) return res.status(200).json({ ok: false, reason: 'outra location' })

  waitUntil(processContact(contactId, crypto.randomUUID()))
  return res.status(200).json({ ok: true })
}

function safeEq(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest())
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : ''

export function extractContactId(body: Record<string, unknown> | null, query: Record<string, unknown> = {}): string {
  const b = body || {}
  const custom = (b.customData || b.custom_data || {}) as Record<string, unknown>
  const contact = (b.contact || {}) as Record<string, unknown>
  return str(custom.contact_id) || str(custom.contactId) || str(b.contact_id) || str(b.contactId) || str(contact.id) || str(query.contact_id)
}

export function extractLocationId(body: Record<string, unknown> | null): string {
  const b = body || {}
  const location = (b.location || {}) as Record<string, unknown>
  return str(location.id) || str(b.location_id) || str(b.locationId)
}
