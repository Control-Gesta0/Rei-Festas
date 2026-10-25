import type { ItemCatalogo } from './crm-map-types'

/**
 * Soma do pedido pela tabela, em CÓDIGO. O modelo escolhe os códigos e as
 * quantidades; preço, subtotal, total e desconto saem daqui.
 * Arquivo puro (sem env) para rodar em `npm test`.
 */

export interface LinhaPedido { codigo: string; descricao: string; quantidade: number }

export interface Pedido {
  linhas: Array<{ item: ItemCatalogo | null; descricao: string; quantidade: number; subtotal: number | null }>
  /** soma só dos itens com preço */
  total: number
  /** itens do catálogo sem preço ("valor com a equipe") */
  semPreco: string[]
  /** itens fora do catálogo */
  foraDoCatalogo: string[]
}

/** 1234.5 → "R$ 1.234,50" (sem o espaço não separável do toLocaleString) */
export function reais(v: number): string {
  const [int, cent] = v.toFixed(2).split('.')
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cent}`
}

const centavos = (v: number) => Math.round(v * 100) / 100

export function montarPedido(pedido: LinhaPedido[], catalogo: ItemCatalogo[]): { pedido: Pedido } | { erros: string[] } {
  const porCodigo = new Map(catalogo.map(i => [i.codigo, i]))
  const erros: string[] = []
  const somados = new Map<string, LinhaPedido>()
  for (const l of pedido) {
    const codigo = l.codigo.trim().toUpperCase()
    const q = Number(l.quantidade)
    const nome = l.descricao.trim() || codigo
    if (!Number.isInteger(q) || q <= 0 || q > 10000) { erros.push(`quantidade inválida para "${nome}": ${l.quantidade}`); continue }
    if (codigo && !porCodigo.has(codigo)) { erros.push(`o código ${codigo} não existe no catálogo. Procure o item certo no catálogo ou mande codigo vazio se não tiver`); continue }
    if (!codigo && !nome) { erros.push('item sem código e sem descrição'); continue }
    const chave = codigo || `fora:${nome.toLowerCase()}`
    const ja = somados.get(chave)
    somados.set(chave, ja ? { ...ja, quantidade: ja.quantidade + q } : { codigo, descricao: nome, quantidade: q })
  }
  if (erros.length) return { erros }
  if (!somados.size) return { erros: ['pedido vazio'] }
  const linhas: Pedido['linhas'] = []
  const semPreco: string[] = []
  const foraDoCatalogo: string[] = []
  let total = 0
  for (const l of somados.values()) {
    const item = l.codigo ? porCodigo.get(l.codigo)! : null
    const subtotal = item?.preco != null ? centavos(item.preco * l.quantidade) : null
    if (subtotal !== null) total = centavos(total + subtotal)
    else if (item) semPreco.push(item.nome)
    else foraDoCatalogo.push(l.descricao)
    linhas.push({ item, descricao: item?.nome || l.descricao, quantidade: l.quantidade, subtotal })
  }
  return { pedido: { linhas, total, semPreco, foraDoCatalogo } }
}

/** Texto do campo "Itens solicitados" (o que a Karol lê no card). */
export function textoItens(p: Pedido): string {
  return p.linhas.map(l => {
    if (!l.item) return `${l.quantidade} × ${l.descricao} (fora do catálogo)`
    const preco = l.item.preco != null ? ` · ${reais(l.item.preco)} cada = ${reais(l.subtotal!)}` : ' · valor com a equipe'
    return `${l.item.codigo} · ${l.quantidade} × ${l.item.nome}${preco}`
  }).join('\n')
}
