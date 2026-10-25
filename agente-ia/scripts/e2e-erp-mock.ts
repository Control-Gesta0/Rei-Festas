/**
 * E2E SIMULADO da sincronização Pedido fechado → VHSYS (sem rede): GHL, VHSYS e
 * Upstash falsos via fetch. Prova: ensaio não grava; gravar cria cliente e
 * orçamento com os produtos e volta no GHL; repetir não duplica; pedido sem
 * CPF vira tag erp-erro com nota.
 */
process.env.GHL_TOKEN = 'pit-x'; process.env.GHL_LOCATION_ID = 'LOC'
process.env.OPENAI_API_KEY = 'sk-x'; process.env.UPSTASH_REDIS_REST_URL = 'https://redis.mock'
process.env.UPSTASH_REDIS_REST_TOKEN = 'x'; process.env.WEBHOOK_SECRET = 's'
process.env.VHSYS_ACCESS_TOKEN = 'a'; process.env.VHSYS_SECRET_ACCESS_TOKEN = 'b'

const db = new Map<string, any>()
const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } })

function redisCmd(c: any[]): any {
  const [cmd, key, ...a] = c.map((x: any) => typeof x === 'string' ? x : String(x))
  switch (cmd.toLowerCase()) {
    case 'set': { const nx = a.map(s => s.toLowerCase()).includes('nx'); if (nx && db.has(key)) return null; db.set(key, a[0]); return 'OK' }
    case 'get': return db.has(key) ? db.get(key) : null
    case 'del': { let n = 0; for (const k of [key, ...a]) n += db.delete(k) ? 1 : 0; return n }
    case 'lpush': { const l = db.get(key) || []; l.unshift(...a); db.set(key, l); return l.length }
    case 'ltrim': return 'OK'
    default: throw new Error('redis mock: ' + cmd)
  }
}

// ---------- estado falso ----------
const CAMPO_ORC = 'fOrc'
const CAMPO_CLI = 'fCli'
let contato: any
let oportunidade: any
let vhsysClientes: any[] = []
const posts: Array<{ url: string; body: any }> = []
const notas: string[] = []
let tags: string[] = []

function reset(cpf: string | null) {
  contato = {
    id: 'C1', firstName: 'Maria', lastName: 'Souza', phone: '+5511999999999', email: 'maria@x.com', tags: [],
    customFields: cpf ? [{ id: 'mxHxoUwk3ML2vWErl7eX', value: cpf }] : [],
  }
  oportunidade = {
    id: 'O1', pipelineId: '5ZqhXairBGVSgpWC8PwA', pipelineStageId: 'f2ef927d-4b4d-49a7-ac91-d7026c588c7b', status: 'open',
    customFields: [
      // formato real da API v2 do GHL para oportunidade: fieldValue<Tipo>
      { id: 'hr7BVj2MLWiTEN7NGkD4', fieldValueString: 'LOU-001 · 30 × Prato Refeição Fundo · R$ 3,50 cada = R$ 105,00\nTAL-009 · 30 × Garfo Refeição Class · R$ 1,20 cada = R$ 36,00' },
      { id: 'i24isUy3ILG7v7RXMir5', fieldValueDate: Date.UTC(2026, 9, 31, 3) },
      { id: 'do2qOzlfkZZfvZauMNBv', fieldValueString: 'Retirada na loja' },
    ],
  }
  posts.length = 0; notas.length = 0; tags = []; vhsysClientes = []
}

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input)
  const method = (init.method || 'GET').toUpperCase()
  const body = init.body ? JSON.parse(init.body) : undefined
  if (url.startsWith('https://redis.mock')) {
    const enc = (r: any): any => typeof r === 'string' ? Buffer.from(r).toString('base64') : Array.isArray(r) ? r.map(enc) : r
    if (url.endsWith('/pipeline') || url.endsWith('/multi-exec')) return ok(body.map((c: any) => ({ result: enc(redisCmd(c)) })))
    return ok({ result: enc(redisCmd(body)) })
  }
  if (url.includes('leadconnectorhq.com')) {
    if (method !== 'GET') posts.push({ url, body })
    if (url.includes('/customFields')) {
      return ok({ customFields: url.includes('model=contact') ? [{ id: CAMPO_CLI, name: 'ID no ERP', dataType: 'TEXT' }] : [{ id: CAMPO_ORC, name: 'Nº do pedido no ERP', dataType: 'TEXT' }] })
    }
    if (url.endsWith('/contacts/C1') && method === 'GET') return ok({ contact: contato })
    if (url.endsWith('/opportunities/O1') && method === 'GET') return ok({ opportunity: oportunidade })
    if (url.endsWith('/opportunities/O1') && method === 'PUT') {
      for (const f of body.customFields || []) oportunidade.customFields.push({ id: f.id, fieldValue: f.field_value })
      if (body.status) oportunidade.status = body.status
      return ok({ opportunity: oportunidade })
    }
    if (url.endsWith('/contacts/C1') && method === 'PUT') return ok({ contact: contato })
    if (url.endsWith('/contacts/C1/notes')) { notas.push(body.body); return ok({}) }
    if (url.endsWith('/contacts/C1/tags') && method === 'POST') { tags.push(...body.tags); return ok({}) }
    if (url.endsWith('/contacts/C1/tags') && method === 'DELETE') { tags = tags.filter(t => !body.tags.includes(t)); contato.tags = tags; return ok({}) }
    if (url.includes('/contacts/search')) return ok({ contacts: [contato] })
    throw new Error('GHL mock sem rota: ' + method + ' ' + url)
  }
  if (url.includes('api.vhsys.com')) {
    if (method !== 'GET') posts.push({ url, body })
    if (url.includes('/clientes?')) {
      const hit = vhsysClientes.filter(c => c.cnpj_cliente.replace(/\D/g, '') === decodeURIComponent(url.split('cnpj_cliente=')[1]).replace(/\D/g, ''))
      return hit.length ? ok({ status: 'success', data: hit }) : new Response('{"status":"error","data":"Nenhum cliente encontrado"}', { status: 403 })
    }
    if (url.endsWith('/clientes') && method === 'POST') { const c = { id_cliente: 500, ...body }; vhsysClientes.push(c); return ok({ status: 'success', data: c }) }
    if (url.includes('/produtos?cod_produto=')) {
      const cod = decodeURIComponent(url.split('cod_produto=')[1])
      return ok({ status: 'success', data: [{ id_produto: cod === 'LOU-001' ? 11 : 22, cod_produto: cod }] })
    }
    if (url.endsWith('/orcamentos') && method === 'POST') return ok({ status: 'success', data: { id_orcamento: 900, id_pedido: 123 } })
    if (/\/orcamentos\/900\/produtos$/.test(url)) return ok({ status: 'success', data: body })
    throw new Error('VHSYS mock sem rota: ' + method + ' ' + url)
  }
  throw new Error('rede no teste: ' + url)
}) as typeof fetch

let falhas = 0
const eq = (nome: string, got: unknown, want: unknown) => {
  const okk = JSON.stringify(got) === JSON.stringify(want)
  if (!okk) falhas++
  console.log(`${okk ? '✅' : '❌'} ${nome}${okk ? '' : ` → recebido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`}`)
}

async function main() {
  const { sincronizarPedido } = await import('../lib/erp-sync')
  const vhsysPosts = () => posts.filter(p => p.url.includes('vhsys'))

  // 1. Ensaio: lê e planeja, não grava nada em lugar nenhum
  reset('123.456.789-09')
  const e = await sincronizarPedido('C1', 'O1', false)
  eq('ensaio: ok', [e.ok, e.ensaio, e.erro], [true, true, undefined])
  eq('ensaio: cliente novo planejado com CPF formatado', [e.cliente?.novo, e.cliente?.payload?.cnpj_cliente], [true, '123.456.789-09'])
  eq('ensaio: 2 produtos com id do VHSYS', e.orcamento?.produtos.map(p => `${p.id_produto}:${p.qtde_produto}:${p.valor_unit_produto}`), ['11:30:3.50', '22:30:1.20'])
  eq('ensaio: total do orçamento', e.orcamento?.payload.valor_total_produtos, '141.00')
  eq('ensaio: data do evento lida do fieldValueDate', /31\/10\/2026/.test(String(e.orcamento?.payload.obs_pedido)), true)
  eq('ensaio: nada foi gravado', posts.length, 0)

  // 2. Gravar: cliente, orçamento, produtos e volta no GHL
  reset('123.456.789-09')
  const g = await sincronizarPedido('C1', 'O1', true)
  eq('gravar: ok', [g.ok, g.erro], [true, undefined])
  eq('gravar: VHSYS recebeu cliente, orçamento e 2 produtos', vhsysPosts().map(p => p.url.replace('https://api.vhsys.com/v2', '')), ['/clientes', '/orcamentos', '/orcamentos/900/produtos', '/orcamentos/900/produtos'])
  eq('gravar: orçamento ligado ao cliente criado', posts.find(p => p.url.endsWith('/orcamentos'))?.body.id_cliente, '500')
  eq('gravar: nº do orçamento no card e oportunidade ganha', [oportunidade.customFields.find((f: any) => f.id === CAMPO_ORC)?.fieldValue, oportunidade.status], ['123', 'won'])
  eq('gravar: id do cliente no contato', posts.find(p => p.url.endsWith('/contacts/C1') && p.body.customFields)?.body.customFields[0].field_value, '500')
  eq('gravar: tag erp-sincronizado e nota', [tags.includes('erp-sincronizado'), /Orçamento nº 123/.test(notas[0] || '')], [true, true])

  // 3. Repetir (retry do webhook / card movido de novo): não duplica
  const antes = vhsysPosts().length
  const rep = await sincronizarPedido('C1', 'O1', true)
  eq('repetir: reconhece que já foi', [rep.ok, rep.jaSincronizado], [true, '123'])
  eq('repetir: nenhum orçamento novo', vhsysPosts().length, antes)

  // 4. Cliente que já existe no VHSYS: não cadastra de novo
  reset('123.456.789-09')
  vhsysClientes = [{ id_cliente: 77, cnpj_cliente: '123.456.789-09', razao_cliente: 'Maria Souza' }]
  const ex = await sincronizarPedido('C1', 'O1', true)
  eq('cliente existente: reaproveita o id', [ex.cliente?.novo, ex.cliente?.id], [false, '77'])
  eq('cliente existente: não chama POST /clientes', vhsysPosts().some(p => p.url.endsWith('/clientes')), false)

  // 5. Sem CPF: não envia, marca erro para a Karol ver
  reset(null)
  const s = await sincronizarPedido('C1', 'O1', true)
  eq('sem CPF: falha explicada', [s.ok, /CPF\/CNPJ/.test(s.erro || '')], [false, true])
  eq('sem CPF: nada foi para o VHSYS', vhsysPosts().length, 0)
  eq('sem CPF: tag erp-erro e nota', [tags.includes('erp-erro'), /NÃO foi enviado/.test(notas[0] || '')], [true, true])

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ Sincronização com o ERP OK')
  process.exit(falhas ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })

export {}
