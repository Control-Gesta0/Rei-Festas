import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import crypto from 'crypto'
import { extractContactId } from './inbound'
import { CONFIG } from '../lib/config'
import { sincronizarPedido } from '../lib/erp-sync'

/**
 * PEDIDO FECHADO → VHSYS.
 *
 * POST /api/erp?secret=...  ← workflow do GHL "Etapa do pipeline alterada" (Locação: Vendas → Pedido fechado)
 *   Custom Data: contact_id = {{contact.id}}, opportunity_id = {{opportunity.id}}
 *   Responde 200 na hora e sincroniza em segundo plano (GHL reenvia webhook lento).
 *   Grava no VHSYS só com ERP_MODO=gravar; senão é ensaio e o resultado vai para os logs.
 *
 * GET /api/erp?secret=...&contact_id=...[&opportunity_id=...]  ← conferência manual
 *   SEMPRE ensaio: lê GHL e VHSYS e mostra o cliente e o orçamento que seriam criados.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const provided = String(req.headers['x-webhook-secret'] || req.query.secret || '')
  if (!safeEq(provided, CONFIG.webhookSecret)) return res.status(401).json({ error: 'unauthorized' })

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as Record<string, unknown> | null
  const contactId = extractContactId(body, req.query)
  if (!contactId) return res.status(200).json({ ok: false, reason: 'sem contact_id' })
  const opportunityId = extractOpportunityId(body, req.query) || undefined

  if (req.method === 'GET') {
    return res.status(200).json(await sincronizarPedido(contactId, opportunityId, false))
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  waitUntil(sincronizarPedido(contactId, opportunityId).then(r => console.log('[erp]', JSON.stringify(r))))
  return res.status(200).json({ ok: true, modo: CONFIG.erpGravar ? 'gravar' : 'ensaio' })
}

function safeEq(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest())
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : ''

export function extractOpportunityId(body: Record<string, unknown> | null, query: Record<string, unknown> = {}): string {
  const b = body || {}
  const custom = (b.customData || b.custom_data || {}) as Record<string, unknown>
  const opp = (b.opportunity || {}) as Record<string, unknown>
  return str(custom.opportunity_id) || str(custom.opportunityId) || str(b.opportunity_id) || str(opp.id) || str(query.opportunity_id)
}
