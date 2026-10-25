import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CONFIG } from '../lib/config'
import { montarAgenda } from '../lib/agenda'

/**
 * AGENDA DE RESERVAS (somente leitura).
 *   GET /api/agenda?secret=...&data=20/11/2026            → itens reservados nesse dia e quanto sobra
 *   GET /api/agenda?secret=...&de=20/11/2026&ate=23/11/2026 → pico de reservas no intervalo
 *   &bruto=1 → inclui um pedido, um produto e um item de pedido como o VHSYS devolve (conferir nomes de campo)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })
  const de = iso(req.query.de ?? req.query.data) || new Date().toLocaleDateString('en-CA', { timeZone: CONFIG.timezone })
  const ate = iso(req.query.ate) || de
  if (ate < de) return res.status(400).json({ ok: false, erro: '"ate" antes de "de"' })
  try {
    return res.status(200).json({ ok: true, ...(await montarAgenda(de, ate, String(req.query.bruto || '') === '1')) })
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e instanceof Error ? e.message : String(e) })
  }
}

/** "20/11/2026" ou "2026-11-20" → "2026-11-20" */
function iso(v: unknown): string {
  const s = String(v ?? '').trim()
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}
