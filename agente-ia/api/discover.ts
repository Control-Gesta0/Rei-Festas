import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CONFIG } from '../lib/config'
import { fieldOptions, ghl, listCalendars, listCustomFields, listPipelines, listTags } from '../lib/ghl'

/**
 * DESCOBERTA AO VIVO (somente leitura) — GET /api/discover?secret=...
 *
 * Lê a location do GHL e devolve o que o crm-map.ts precisa: funis e etapas,
 * campos do contato e da oportunidade (com opções), calendários e tags.
 * Roda NA VERCEL: funciona mesmo quando a rede local não alcança o GHL.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })
  const out: Record<string, unknown> = { location: CONFIG.ghlLocationId }
  const tentar = async (nome: string, fn: () => Promise<unknown>) => {
    try { out[nome] = await fn() } catch (e) { out[nome] = { erro: e instanceof Error ? e.message : String(e) } }
  }
  await tentar('conta', async () => {
    const r = await ghl<{ location?: { name?: string; timezone?: string } }>('GET', `/locations/${encodeURIComponent(CONFIG.ghlLocationId)}`)
    return { nome: r.location?.name, timezone: r.location?.timezone }
  })
  await tentar('funis', async () => (await listPipelines()).map(p => ({
    id: p.id, nome: p.name,
    etapas: [...p.stages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(s => ({ id: s.id, nome: s.name })),
  })))
  const campos = async (model: 'contact' | 'opportunity') => (await listCustomFields(model)).map(f => ({
    id: f.id, nome: f.name, tipo: f.dataType, chave: f.fieldKey, ...(fieldOptions(f).length ? { opcoes: fieldOptions(f) } : {}),
  }))
  await tentar('camposContato', () => campos('contact'))
  await tentar('camposOportunidade', () => campos('opportunity'))
  await tentar('calendarios', listCalendars)
  await tentar('tags', listTags)
  return res.status(200).json(out)
}
