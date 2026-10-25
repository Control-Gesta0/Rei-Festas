import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CENARIOS } from '../evals/cenarios'
import { CONFIG } from '../lib/config'
import { runEvals } from '../lib/evals-runner'

/**
 * GET /api/evals?secret=...[&filtro=preco,agenda][&reps=1][&formato=texto]
 * Roda o exame do cérebro NA VERCEL, com os prompts deste deploy.
 * Zero efeito no CRM e zero mensagem enviada (porta em memória).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })
  const filtros = String(req.query.filtro || '').split(',').map(s => s.trim()).filter(Boolean)
  const reps = Math.min(Math.max(Number(req.query.reps || 1), 1), 3)
  const r = await runEvals({
    apiKey: CONFIG.openaiApiKey,
    cenarios: CENARIOS,
    model: CONFIG.llmModel,
    judgeModel: process.env.EVAL_JUDGE_MODEL || 'gpt-5.4-2026-03-05',
    filtros, reps, gateTag: CONFIG.gateTag,
  })
  if (String(req.query.formato || '') === 'texto') {
    const linhas = [`${r.aprovado ? 'APROVADO' : 'REPROVADO'} · ${r.total - r.reprovados}/${r.total} · modelo ${r.modelo} · custo US$ ${r.custoUsd}`, '']
    for (const x of r.resultados) {
      linhas.push(`${x.passou ? '[OK]' : '[FALHOU]'} ${x.id} (rodada ${x.rodada}) nota ${x.nota}/10`)
      if (!x.passou) {
        for (const t of x.conversa) linhas.push(`   LEAD: ${t.lead}`, `   IA:   ${t.resposta}`)
        for (const f of x.falhasCodigo) linhas.push(`   x código: ${f}`)
        for (const f of x.falhasJuiz) linhas.push(`   x juiz: ${f.criterio} :: ${f.porque}`)
        for (const l of x.log) linhas.push(`   · ${l}`)
      }
      linhas.push('')
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(r.aprovado ? 200 : 500).send(linhas.join('\n'))
  }
  return res.status(r.aprovado ? 200 : 500).json(r)
}
