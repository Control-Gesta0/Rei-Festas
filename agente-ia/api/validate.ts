import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CONFIG } from '../lib/config'
import { CRM_MAP } from '../lib/crm-map'
import { fieldOptions, listCalendars, listCustomFields, listPipelines } from '../lib/ghl'
import { loadPromptFile } from '../lib/llm'
import { NATIVO } from '../lib/tools'

/**
 * CRM_MAP × GHL VIVO + coerência interna. Rodar depois de QUALQUER mexida no
 * funil/campos e antes de cada deploy. { ok, problems[], avisos[] }
 *
 * Existe porque o GHL aceita gravar em campo INEXISTENTE devolvendo 200 OK:
 * sem isto, dado some em silêncio (ghl §A.10).
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })
  const problems: string[] = []
  const avisos: string[] = []

  // ---------- Offline ----------
  if (!CONFIG.gateTag) avisos.push('GATE_TAG vazio = a IA atende TODOS os contatos. Só no fim da rampagem.')
  const ids = new Set<string>()
  for (const p of CRM_MAP.portas) {
    if (ids.has(p.id)) problems.push(`porta "${p.id}" duplicada`)
    ids.add(p.id)
    if (p.ativa && !p.promptFile) problems.push(`porta "${p.id}" ativa sem promptFile`)
    if (p.ativa && p.promptFile) {
      try {
        const txt = loadPromptFile(`portas/${p.promptFile}`)
        if (/\[(PREENCHER|NOME|EMPRESA)[^\]]*\]/.test(txt)) problems.push(`prompts/portas/${p.promptFile} ainda tem [PREENCHER]`)
      } catch { problems.push(`prompts/portas/${p.promptFile} não existe`) }
    }
    if (!p.ativa && !p.mensagemSemAgente) problems.push(`porta "${p.id}" inativa sem mensagemSemAgente`)
    for (const key of [...p.roteiro, ...p.obrigatorios]) if (!CRM_MAP.campos[key]) problems.push(`porta "${p.id}": campo "${key}" não existe em CRM_MAP.campos`)
    for (const key of p.obrigatorios) if (!p.roteiro.includes(key)) problems.push(`porta "${p.id}": obrigatório "${key}" fora do roteiro`)
  }
  if (!CRM_MAP.menu.ativo && !CRM_MAP.portas.find(p => p.id === CRM_MAP.menu.portaPadrao)) problems.push(`menu.portaPadrao "${CRM_MAP.menu.portaPadrao}" não existe`)
  try {
    const nucleo = loadPromptFile('nucleo.md')
    if (/\[(PREENCHER|NOME|EMPRESA)[^\]]*\]/.test(nucleo)) problems.push('prompts/nucleo.md ainda tem [PREENCHER] — o cérebro não está escrito')
    if (/—/.test(nucleo)) avisos.push('prompts/nucleo.md tem travessão (—): tell de IA, troque por vírgula ou ponto')
  } catch { problems.push('prompts/nucleo.md não existe') }
  const cat = CRM_MAP.catalogo
  if (cat) {
    if (!cat.itens.length) problems.push('catálogo vazio: rode python scripts/catalogo_agente.py')
    if (!CRM_MAP.campos[cat.campoItens]) problems.push(`catalogo.campoItens "${cat.campoItens}" não existe em CRM_MAP.campos`)
    if (cat.campoValor && !CRM_MAP.campos[cat.campoValor]) problems.push(`catalogo.campoValor "${cat.campoValor}" não existe em CRM_MAP.campos`)
    if (cat.etapaAoCalcular && !CRM_MAP.etapas.some(e => e.id === cat.etapaAoCalcular)) problems.push('catalogo.etapaAoCalcular não é uma das etapas da alçada')
  }
  for (const c of Object.values(CRM_MAP.campos)) if (!c.id) avisos.push(`campo "${c.key}" sem id: fica só no estado, não grava no GHL`)

  const op = CRM_MAP.oportunidade
  if (CRM_MAP.etapas.length && !op.pipelineId) problems.push('há etapas na alçada mas oportunidade.pipelineId está vazio')
  if (op.pipelineId && !op.stageOrder.length) problems.push('oportunidade.stageOrder vazio: o guard anti-retrocesso não funciona')
  for (const e of CRM_MAP.etapas) if (!op.stageOrder.includes(e.id)) problems.push(`etapa da alçada "${e.name}" fora do stageOrder`)
  if (CRM_MAP.etapaAgendadoId && !CRM_MAP.etapas.some(e => e.id === CRM_MAP.etapaAgendadoId)) problems.push('etapaAgendadoId não é uma das etapas da alçada')

  // ---------- Contra o GHL vivo ----------
  try {
    const [cf, of] = await Promise.all([listCustomFields('contact'), listCustomFields('opportunity')])
    const live = { contact: new Map(cf.map(f => [f.id, f])), opportunity: new Map(of.map(f => [f.id, f])) }
    for (const c of Object.values(CRM_MAP.campos)) {
      if (!c.id || c.id.startsWith(NATIVO)) continue
      if (CRM_MAP.camposProibidos.includes(c.id)) problems.push(`campo "${c.key}" aponta para um campo PROIBIDO (${c.id})`)
      const lf = live[c.model].get(c.id)
      if (!lf) {
        const outro = live[c.model === 'contact' ? 'opportunity' : 'contact'].get(c.id)
        problems.push(outro ? `campo "${c.key}" (${c.id}) é do modelo ${c.model === 'contact' ? 'opportunity' : 'contact'}, não ${c.model}` : `campo "${c.key}" (${c.id}) NÃO existe mais no GHL`)
        continue
      }
      if (c.ghlName && lf.name.trim() !== c.ghlName.trim()) problems.push(`campo ${c.id} renomeado: mapa="${c.ghlName}" GHL="${lf.name}"`)
      const dt = lf.dataType.toUpperCase()
      const tipoOk = c.type === 'select' ? /SINGLE_OPTIONS|RADIO|DROPDOWN/.test(dt)
        : c.type === 'multiselect' ? /MULTIPLE_OPTIONS|CHECKBOX/.test(dt)
        : c.type === 'numeric' ? /NUMERICAL|MONETORY|MONETARY|TEXT/.test(dt)
        : c.type === 'date' ? /DATE/.test(dt)
        : /TEXT|LARGE_TEXT|PHONE|EMAIL/.test(dt)
      if (!tipoOk) problems.push(`campo "${c.key}" é ${lf.dataType} no GHL e ${c.type} no mapa`)
      const opts = fieldOptions(lf)
      for (const o of c.options || []) if (!opts.includes(o)) problems.push(`campo "${c.key}": opção "${o}" não existe no GHL (existem: ${opts.join(' | ')})`)
    }

    if (op.pipelineId) {
      const pipes = await listPipelines()
      const p = pipes.find(x => x.id === op.pipelineId)
      if (!p) problems.push(`funil ${op.pipelineId} NÃO existe`)
      else {
        const liveIds = p.stages.map(s => s.id)
        for (const id of op.stageOrder) if (!liveIds.includes(id)) problems.push(`stageOrder: etapa ${id} não existe mais no funil "${p.name}"`)
        for (const id of liveIds) if (!op.stageOrder.includes(id)) problems.push(`etapa nova no funil "${p.name}" fora do stageOrder: ${id} (${p.stages.find(s => s.id === id)?.name})`)
        if (op.etapaInicialId && !liveIds.includes(op.etapaInicialId)) problems.push(`etapaInicialId ${op.etapaInicialId} não existe no funil`)
        for (const e of CRM_MAP.etapas) {
          const s = p.stages.find(x => x.id === e.id)
          if (!s) problems.push(`etapa "${e.name}" (${e.id}) não existe no funil`)
          else if (s.name.trim() !== e.name.trim()) problems.push(`etapa ${e.id} renomeada: mapa="${e.name}" GHL="${s.name}"`)
        }
      }
    }

    if (CRM_MAP.agenda.calendarId) {
      const cals = await listCalendars()
      if (!cals.some(c => c.id === CRM_MAP.agenda.calendarId)) problems.push(`calendário ${CRM_MAP.agenda.calendarId} NÃO existe`)
    }
  } catch (e) {
    problems.push(`falha ao consultar o GHL: ${e instanceof Error ? e.message : String(e)}`)
  }

  return res.status(problems.length ? 500 : 200).json({ ok: problems.length === 0, cliente: CONFIG.clientName, problems, avisos })
}
