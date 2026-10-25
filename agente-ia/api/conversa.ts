import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CONFIG } from '../lib/config'
import { findConversationId, getConversationMessages, ghl } from '../lib/ghl'
import { isChatMessage, toChatMsgs, ultimaInstancia } from '../lib/history'

/**
 * DIAGNÓSTICO (somente leitura) — GET /api/conversa?secret=...&busca=<nome ou telefone>
 *   ou &contact_id=<id>
 * Mostra como a conversa chega na API: tipo de cada mensagem, direção, quem
 * enviou e o que a IA enxergaria. Serve para acertar canal e filtros da
 * integração de WhatsApp sem adivinhar.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })
  try {
    let contactId = String(req.query.contact_id || '')
    let contatos: unknown[] = []
    if (!contactId && req.query.busca) {
      const q = encodeURIComponent(String(req.query.busca))
      const r = await ghl<{ contacts?: Array<{ id: string; contactName?: string; firstName?: string; lastName?: string; phone?: string; tags?: string[] }> }>('GET', `/contacts/?locationId=${encodeURIComponent(CONFIG.ghlLocationId)}&query=${q}&limit=5`)
      contatos = (r.contacts || []).map(c => ({ id: c.id, nome: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' '), telefone: c.phone, tags: c.tags }))
      contactId = (r.contacts || [])[0]?.id || ''
    }
    if (!contactId) return res.status(200).json({ ok: false, motivo: 'contato não encontrado', contatos })
    const conversationId = await findConversationId(contactId)
    if (!conversationId) return res.status(200).json({ ok: false, contactId, motivo: 'sem conversa', contatos })
    const raw = await getConversationMessages(conversationId, 30)
    const brutas = raw.map(m => {
      const extra = m as unknown as Record<string, unknown>
      return {
        quando: m.dateAdded, direcao: m.direction, messageType: m.messageType, type: m.type,
        userId: m.userId || null, source: m.source || extra.source || null,
        provider: extra.conversationProviderId || extra.providerId || null,
        status: m.status, entraNoHistorico: isChatMessage(m),
        texto: (m.body || '').slice(0, 140), anexos: (m.attachments || []).length,
      }
    })
    const ia = await toChatMsgs(raw, { processarMidiaDesde: 999 })
    return res.status(200).json({
      ok: true, contactId, conversationId, contatos,
      instanciaDetectada: ultimaInstancia(raw),
      tiposEncontrados: [...new Set(raw.map(m => `${m.messageType} (type ${m.type})`))],
      oQueAIaEnxerga: ia.map(m => `${m.dir === 'in' ? 'LEAD' : 'EMPRESA'}: ${m.text.slice(0, 140)}`),
      mensagens: brutas,
    })
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e instanceof Error ? e.message : String(e) })
  }
}
