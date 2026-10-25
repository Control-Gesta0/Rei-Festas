import { CONFIG } from './config'

/**
 * Cliente mínimo da API v2 do VHSYS (Control ERP Lite) da Rey Festas.
 * Mesma autenticação de scripts/vhsys_api.py: headers access-token e
 * secret-access-token do app "Integração via API" da conta da Rey Festas.
 *
 * Os nomes de campo do VHSYS ficam SÓ neste arquivo. Cliente (razao_cliente,
 * cnpj_cliente, ...) confere com o código que já rodou na conta; orçamento e
 * produtos do orçamento seguem o padrão da API v2 e são conferidos no primeiro
 * envio em ERP_MODO=gravar (o VHSYS devolve o nome do campo que recusou).
 */

export interface VhsysCliente { id_cliente: number | string; razao_cliente?: string; fantasia_cliente?: string; cnpj_cliente?: string }
export interface VhsysProduto { id_produto: number | string; cod_produto?: string; desc_produto?: string; valor_produto?: string }

// O VHSYS responde 403 "Nenhum(a) ... encontrado(a)" em vez de lista vazia
const SEM_RESULTADO = /Nenhum[a]? .{0,40}encontrad[oa]/i

async function vh<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  if (!CONFIG.vhsysAccessToken || !CONFIG.vhsysSecretToken) throw new Error('VHSYS_ACCESS_TOKEN / VHSYS_SECRET_ACCESS_TOKEN ausentes')
  const res = await fetch(`${CONFIG.vhsysBaseUrl}${path}`, {
    method,
    headers: {
      'access-token': CONFIG.vhsysAccessToken,
      'secret-access-token': CONFIG.vhsysSecretToken,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (res.status === 404 || (method === 'GET' && res.status === 403 && SEM_RESULTADO.test(text))) return null
  if (!res.ok) throw new Error(`VHSYS ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  const json = JSON.parse(text || '{}') as { status?: string; data?: T }
  if (json.status && json.status !== 'success') throw new Error(`VHSYS ${method} ${path}: ${text.slice(0, 300)}`)
  return (json.data ?? null) as T | null
}

const lista = <T>(d: T | T[] | null): T[] => (d ? (Array.isArray(d) ? d : [d]) : [])
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/** Cliente pelo CPF/CNPJ (compara só os dígitos: o VHSYS guarda formatado). */
export async function buscarClientePorDocumento(doc: string): Promise<VhsysCliente | null> {
  const alvo = digitos(doc)
  for (const termo of new Set([doc, alvo])) {
    const achados = lista(await vh<VhsysCliente[]>('GET', `/clientes?cnpj_cliente=${encodeURIComponent(termo)}`))
    const hit = achados.find(c => digitos(c.cnpj_cliente) === alvo)
    if (hit) return hit
  }
  return null
}

export async function criarCliente(payload: Record<string, unknown>): Promise<VhsysCliente> {
  const r = await vh<VhsysCliente | VhsysCliente[]>('POST', '/clientes', payload)
  const c = lista(r)[0]
  if (!c?.id_cliente) throw new Error('VHSYS não devolveu id_cliente ao cadastrar o cliente')
  return c
}

/** Produto pelo código do catálogo (LOU-001...), gravado em cod_produto na carga de 209 itens. */
export async function buscarProdutoPorCodigo(codigo: string): Promise<VhsysProduto | null> {
  const achados = lista(await vh<VhsysProduto[]>('GET', `/produtos?cod_produto=${encodeURIComponent(codigo)}`))
  return achados.find(p => String(p.cod_produto || '').toUpperCase() === codigo.toUpperCase()) || null
}

export async function criarOrcamento(payload: Record<string, unknown>): Promise<{ id: string; numero: string }> {
  type Resp = Record<string, unknown>
  const r: Resp = lista<Resp>(await vh<Resp>('POST', '/orcamentos', payload))[0] ?? {}
  const id = String(r.id_orcamento ?? r.id_pedido ?? r.id ?? '')
  if (!id) throw new Error(`VHSYS não devolveu o id do orçamento: ${JSON.stringify(r).slice(0, 200)}`)
  return { id, numero: String(r.id_pedido ?? r.numero_orcamento ?? id) }
}

export async function adicionarProdutoOrcamento(idOrcamento: string, payload: Record<string, unknown>): Promise<void> {
  await vh('POST', `/orcamentos/${encodeURIComponent(idOrcamento)}/produtos`, payload)
}
