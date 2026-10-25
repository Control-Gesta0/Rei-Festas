import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'
import {
  addContactNote, addContactTags, createAppointment, createOpportunity, findOpportunity, getContact, getFreeSlots,
  contactName, contactTags, removeContactTags, updateContactFields, updateContactNative, updateOpportunity, valorCampo, type GhlOpportunity,
} from './ghl'
import { k, redis } from './redis'
import { getState, patchState } from './state'
import { NATIVO, type FieldWrite, type LeadPort, type LeadView } from './tools'

/**
 * Porta de produção: GHL + Redis. Relê o contato depois de toda escrita.
 * GHL tem dois objetos: CONTATO (tags, campos do contato, nota) e
 * OPORTUNIDADE (etapa do funil, campos da oportunidade).
 */
export function ghlPort(contactId: string): LeadPort {
  let cached: LeadView | undefined
  let opp: GhlOpportunity | null | undefined
  const pipelineId = CRM_MAP.oportunidade.pipelineId

  async function getOpp(): Promise<GhlOpportunity | null> {
    if (opp === undefined) opp = pipelineId ? await findOpportunity(contactId, pipelineId, CRM_MAP.oportunidade.reusarSoNasEtapas) : null
    return opp
  }

  async function ensureOpp(): Promise<GhlOpportunity> {
    const atual = await getOpp()
    if (atual) return atual
    if (!pipelineId || !CRM_MAP.oportunidade.etapaInicialId) throw new Error('crm-map: oportunidade.pipelineId/etapaInicialId vazios — não dá para criar oportunidade')
    const c = await getContact(contactId)
    opp = await createOpportunity(contactId, pipelineId, CRM_MAP.oportunidade.etapaInicialId, contactName(c) || c.phone || 'Lead WhatsApp')
    return opp
  }

  return {
    async getLead() {
      if (!cached) {
        const c = await getContact(contactId)
        const o = await getOpp()
        const fields: LeadView['fields'] = {}
        for (const f of c.customFields || []) fields[f.id] = valorCampo(f)
        for (const f of o?.customFields || []) fields[f.id] = valorCampo(f)
        cached = { id: c.id, opportunityId: o?.id || null, pipelineId: o?.pipelineId || null, stageId: o?.pipelineStageId || null, fields, tags: contactTags(c) }
      }
      return cached
    },
    async writeFields(values: FieldWrite[]) {
      const permitidos = values.filter(v => v.campo.id && !CRM_MAP.camposProibidos.includes(v.campo.id))
      const nativos = permitidos.filter(v => v.campo.id.startsWith(NATIVO))
      const doContato = permitidos.filter(v => v.campo.model === 'contact' && !v.campo.id.startsWith(NATIVO)).map(v => ({ id: v.campo.id, value: v.value }))
      if (nativos.length) await updateContactNative(contactId, Object.fromEntries(nativos.map(v => [v.campo.id.slice(NATIVO.length), v.value])))
      const daOpp = permitidos.filter(v => v.campo.model === 'opportunity').map(v => ({ id: v.campo.id, value: v.value }))
      if (doContato.length) await updateContactFields(contactId, doContato)
      if (daOpp.length) {
        const o = await ensureOpp()
        await updateOpportunity(o.id, { customFields: daOpp })
      }
      cached = undefined
    },
    async moveStage(stageId) {
      const o = await ensureOpp()
      await updateOpportunity(o.id, { pipelineStageId: stageId })
      opp = { ...o, pipelineStageId: stageId }
      cached = undefined
    },
    async addTags(tags) { await addContactTags(contactId, tags); cached = undefined },
    async removeTags(tags) { await removeContactTags(contactId, tags); cached = undefined },
    async addNote(text) { await addContactNote(contactId, text) },
    async setValor(valor) {
      const o = await ensureOpp()
      await updateOpportunity(o.id, { monetaryValue: valor })
    },
    getState: () => getState(contactId),
    patchState: p => patchState(contactId, p),

    async freeSlots() {
      const a = CRM_MAP.agenda
      const start = Date.now() + 2 * 3600 * 1000 // nunca oferece horário daqui a menos de 2h
      return (await getFreeSlots(a.calendarId, start, start + a.janelaDias * 86400 * 1000, CONFIG.timezone))
        .filter(s => Date.parse(s) >= start)
    },
    async book(startIso) {
      const a = CRM_MAP.agenda
      const end = new Date(Date.parse(startIso) + a.duracaoMin * 60 * 1000).toISOString()
      const c = await getContact(contactId)
      return createAppointment({ calendarId: a.calendarId, contactId, startTime: startIso, endTime: end, title: `${a.tituloEvento} · ${contactName(c) || c.phone || ''}`.trim() })
    },
    async saveOffer(slots) { await redis.set(k('slots', contactId), slots, { ex: 3 * 86400 }) },
    async getOffer() { return (await redis.get<string[]>(k('slots', contactId))) || [] },
  }
}
