/**
 * O EXAME DO CÉREBRO (CLI) — mesma lógica do /api/evals.
 *   npx tsx scripts/evals.ts                  # todos, 1 rodada
 *   npx tsx scripts/evals.ts preco agenda     # filtra por id
 *   EVAL_REPS=3 npx tsx scripts/evals.ts
 * Sem terminal? Use o endpoint: /api/evals?secret=...
 */
import { loadEnv } from './env'

loadEnv()
for (const [key, val] of Object.entries({ GHL_TOKEN: 'pit-eval', GHL_LOCATION_ID: 'eval', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'x', WEBHOOK_SECRET: 'x' })) process.env[key] ||= val

export type { Cenario, Turno, World } from '../lib/evals-runner'

async function main() {
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY ausente no .env.local'); process.exit(1) }
  const { runEvals } = await import('../lib/evals-runner')
  const { CENARIOS } = await import('../evals/cenarios')
  const r = await runEvals({
    apiKey: process.env.OPENAI_API_KEY!,
    cenarios: CENARIOS,
    model: process.env.LLM_MODEL || 'gpt-5.4-mini-2026-03-17',
    judgeModel: process.env.EVAL_JUDGE_MODEL || 'gpt-5.4-2026-03-05',
    filtros: process.argv.slice(2),
    reps: Number(process.env.EVAL_REPS || 1),
    gateTag: process.env.GATE_TAG,
  })
  for (const x of r.resultados) {
    console.log(`\n${x.passou ? '✅' : '❌'} ${x.id} [${x.rodada}] nota ${x.nota}/10`)
    if (!x.passou) {
      for (const t of x.conversa) console.log(`   LEAD: ${t.lead}\n   IA: ${t.resposta}`)
      for (const f of x.falhasCodigo) console.log(`   ⛔ código: ${f}`)
      for (const f of x.falhasJuiz) console.log(`   ⛔ juiz: ${f.criterio} — ${f.porque}`)
      for (const l of x.log) console.log(`   · ${l}`)
    }
  }
  console.log(`\n${r.aprovado ? '✅ Todos aprovados' : `❌ ${r.reprovados} reprovado(s)`} · ${r.total} execução(ões) · custo do agente US$ ${r.custoUsd}`)
  process.exit(r.aprovado ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
