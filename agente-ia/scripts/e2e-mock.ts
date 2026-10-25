/**
 * E2E SIMULADO (sem rede): GHL, OpenAI e Upstash falsos via fetch.
 * Prova o caminho inteiro: webhook → gate → buffer → histórico (sem nota interna)
 * → LLM com tool → trava → envio pelo GHL → diário.
 */
process.env.GHL_TOKEN = 'pit-x'; process.env.GHL_LOCATION_ID = 'LOC'
process.env.OPENAI_API_KEY = 'sk-x'; process.env.UPSTASH_REDIS_REST_URL = 'https://redis.mock'
process.env.UPSTASH_REDIS_REST_TOKEN = 'x'; process.env.WEBHOOK_SECRET = 's'
process.env.DEBOUNCE_SECONDS = '0'; process.env.GATE_TAG = 'ia-ativa'

const db = new Map<string, any>()
const enviados: string[] = []
let tags = ['ia-ativa']
let llmCalls = 0
const openaiBodies: any[] = []
const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } })

function redisCmd(c: any[]): any {
  const [cmd, key, ...a] = c.map((x: any) => typeof x === 'string' ? x : String(x))
  switch (cmd.toLowerCase()) {
    case 'ping': return 'PONG'
    case 'incr': db.set(key, Number(db.get(key) || 0) + 1); return db.get(key)
    case 'expire': return 1
    case 'set': { const nx = a.map(s => s.toLowerCase()).includes('nx'); if (nx && db.has(key)) return null; db.set(key, a[0]); return 'OK' }
    case 'get': return db.has(key) ? db.get(key) : null
    case 'del': { let n = 0; for (const k of [key, ...a]) n += db.delete(k) ? 1 : 0; return n }
    case 'lpush': { const l = db.get(key) || []; l.unshift(...a); db.set(key, l); return l.length }
    case 'ltrim': return 'OK'
    case 'lrange': return (db.get(key) || []).slice(Number(a[0]), Number(a[1]) === -1 ? undefined : Number(a[1]) + 1)
    case 'eval': { const lk = c[3]; const own = c[4]; if (db.get(lk) === own) { if (/del/.test(c[1])) db.delete(lk); return 1 } return 0 }
    default: throw new Error('redis mock: ' + cmd)
  }
}

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input)
  const body = init.body ? JSON.parse(init.body) : undefined
  if (url.startsWith('https://redis.mock')) {
    // o client pede respostas em base64 (header Upstash-Encoding)
    const enc = (r: any): any => typeof r === 'string' ? Buffer.from(r).toString('base64') : Array.isArray(r) ? r.map(enc) : r
    if (url.endsWith('/pipeline') || url.endsWith('/multi-exec')) return ok(body.map((c: any) => ({ result: enc(redisCmd(c)) })))
    return ok({ result: enc(redisCmd(body)) })
  }
  if (url.includes('api.openai.com')) {
    openaiBodies.push(body); llmCalls++
    if (llmCalls === 1) return ok({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'salvar_respostas', arguments: JSON.stringify({ respostas: [{ campo: 'necessidade', evidencia: 'queria saber dos planos', valor: 'queria saber dos planos' }] }) } }] } }], usage: { prompt_tokens: 3000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 2000 } } })
    if (llmCalls === 2) return ok({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Oi, Carla — tudo bem? Como posso ajudar?' } }], usage: { prompt_tokens: 3100, completion_tokens: 20 } })
    return ok({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Oi, Carla, tudo bem? Me conta o que você procura.' } }], usage: { prompt_tokens: 3200, completion_tokens: 20 } })
  }
  if (url.includes('leadconnectorhq.com')) {
    const h = init.headers || {}
    if (!/Mozilla/.test(h['User-Agent'] || '')) return new Response('error code: 1010', { status: 403 })
    if (url.includes('/contacts/C1') && (init.method || 'GET') === 'GET') return ok({ contact: { id: 'C1', firstName: 'Carla', tags, customFields: [{ id: 'f', value: 'x' }] } })
    if (url.includes('/conversations/search')) return ok({ conversations: [{ id: 'CV1' }] })
    if (url.includes('/conversations/CV1/messages')) return ok({ messages: { messages: [
      { id: 'm2', messageType: 'TYPE_WHATSAPP', direction: 'inbound', body: 'aqui é a Carla, queria saber dos planos', dateAdded: new Date(Date.now() - 5000).toISOString() },
      { id: 'n1', messageType: 'TYPE_INTERNAL_COMMENT', direction: 'outbound', body: 'SEGREDO: cliente caloteiro', dateAdded: new Date(Date.now() - 60000).toISOString() },
    ] } })
    if (url.endsWith('/conversations/messages') && init.method === 'POST') { enviados.push(body.message); return ok({ messageId: 'out1', conversationId: 'CV1' }) }
    return ok({})
  }
  throw new Error('rede não mockada: ' + url)
}) as typeof fetch

async function main() {
  // @ts-ignore: faz o SDK da OpenAI usar o fetch global (o mock)
  require('openai/shims/web')
  const { processContact } = await import('../lib/agent')
  const { readExecs } = await import('../lib/execlog')
  await processContact('C1', 'w1')
  const execs = await readExecs(10)
  const ctxTxt = JSON.stringify(openaiBodies[0]?.messages || [])
  const checks: Array<[string, boolean]> = [
    ['enviou exatamente 1 mensagem', enviados.length === 1],
    ['travessão foi barrado e reescrito', !/[—–]/.test(enviados[0] || '—') && llmCalls === 3],
    ['nota interna NÃO chegou ao modelo', !ctxTxt.includes('SEGREDO')],
    ['mensagem do lead chegou ao modelo', ctxTxt.includes('queria saber dos planos')],
    ['diário registrou resposta com a tool', execs[0]?.tipo === 'resposta' && (execs[0].tools || []).includes('salvar_respostas')],
    ['estado gravou a resposta do roteiro', JSON.stringify(db.get('agente-cliente:state:C1') || '').includes('planos')],
    ['id enviado lembrado (IA ≠ humano)', db.has('agente-cliente:enviada:out1')],
  ]
  // 2ª execução com o mesmo inbound: não responde de novo
  await processContact('C1', 'w2')
  checks.push(['retry do webhook não duplica', enviados.length === 1])
  // sem a tag de gate: silêncio
  tags = []
  db.delete('agente-cliente:done:C1')
  await processContact('C1', 'w3')
  checks.push(['sem tag de gate não responde', enviados.length === 1])
  let falhas = 0
  for (const [n, v] of checks) { console.log(`${v ? '✅' : '❌'} ${n}`); if (!v) falhas++ }
  console.log('Resposta enviada:', enviados[0], '| custo US$', execs[0]?.custoUsd)
  process.exit(falhas ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
