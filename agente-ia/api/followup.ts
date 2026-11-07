import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CONFIG } from '../lib/config'
import { rodarFollowups } from '../lib/followup'

/**
 * GET /api/followup — cron da Vercel a cada 15 min (vercel.json): manda os follow-ups vencidos.
 * Autenticação: header do cron (Bearer CRON_SECRET) ou ?secret=WEBHOOK_SECRET (teste manual).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = String(req.headers.authorization || '')
  const doCron = !!CONFIG.cronSecret && auth === `Bearer ${CONFIG.cronSecret}`
  if (!doCron && String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })
  const r = await rodarFollowups(Date.now())
  return res.status(200).json({ ok: true, ...r })
}
