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

export interface VhsysOrcamento { id: string; numero: string; idCliente: string; obsInterna: string }

/** id interno (vai na URL) e número que a Karol vê na tela ("Número orçamento") */
function orcamentoDe(r: Record<string, unknown>): VhsysOrcamento | null {
  const id = String(r.id_orcamento ?? r.id ?? '')
  if (!id) return null
  return {
    id,
    numero: String(r.id_pedido ?? r.numero_orcamento ?? r.num_orcamento ?? id),
    idCliente: String(r.id_cliente ?? ''),
    obsInterna: String(r.obs_interno_pedido ?? r.obs_interna_pedido ?? ''),
  }
}

/**
 * ATENÇÃO (teste real de 25/10/2026): o POST /orcamentos criou o orçamento e
 * mesmo assim respondeu {"status":"error","data":"Erro ao comunicar com a API"}.
 * Por isso quem chama confirma pela listagem (orcamentosDoCliente) antes de
 * concluir que falhou.
 */
export async function criarOrcamento(payload: Record<string, unknown>): Promise<VhsysOrcamento> {
  type Resp = Record<string, unknown>
  const r = orcamentoDe(lista<Resp>(await vh<Resp>('POST', '/orcamentos', payload))[0] ?? {})
  if (!r) throw new Error('VHSYS não devolveu o id do orçamento')
  return r
}

/** Orçamentos do cliente (os mais recentes). Filtra de novo aqui: o VHSYS pode ignorar o filtro. */
export async function orcamentosDoCliente(idCliente: string): Promise<VhsysOrcamento[]> {
  type Resp = Record<string, unknown>
  const achados = lista<Resp>(await vh<Resp[]>('GET', `/orcamentos?id_cliente=${encodeURIComponent(idCliente)}&limit=250`))
  return achados.map(orcamentoDe).filter((o): o is VhsysOrcamento => !!o && (!o.idCliente || o.idCliente === idCliente))
}

/** id_produto dos itens que já estão no orçamento (para retentar sem duplicar). */
export async function produtosDoOrcamento(idOrcamento: string): Promise<string[]> {
  type Resp = Record<string, unknown>
  const achados = lista<Resp>(await vh<Resp[]>('GET', `/orcamentos/${encodeURIComponent(idOrcamento)}/produtos`))
  return achados.map(p => String(p.id_produto ?? '')).filter(Boolean)
}

export async function adicionarProdutoOrcamento(idOrcamento: string, payload: Record<string, unknown>): Promise<void> {
  await vh('POST', `/orcamentos/${encodeURIComponent(idOrcamento)}/produtos`, payload)
}
