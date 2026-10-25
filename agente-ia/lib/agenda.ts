import { calcularAgenda, lerPeriodo, type LinhaAgenda, type Reserva } from './locacao'
import { k, redis } from './redis'
import { itensDoPedido, listarTudo, pedidoDe, produtoEstoqueDe, type Bruto } from './vhsys'

/**
 * AGENDA DE RESERVAS (somente leitura no VHSYS). Reserva = PEDIDO não cancelado
 * com a linha "LOCAÇÃO: dd/mm/aaaa a dd/mm/aaaa" na observação. Orçamento não
 * reserva: só o pedido (sinal pago). Itens casados pelo id_produto → código do
 * catálogo (cod_produto). Reservas ficam 5 min em cache (cada pedido custa uma
 * chamada para os itens).
 */

export interface Agenda {
  de: string
  ate: string
  itens: LinhaAgenda[]
  reservas: number
  /** pedidos recentes sem a linha LOCAÇÃO (não entram na conta: conferir) */
  semPeriodo: string[]
  pedidosLidos: number
  bruto?: { pedido?: Bruto; produto?: Bruto; itemPedido?: Bruto }
}

const CACHE_S = 300
const cancelado = (s: string) => /cancel/i.test(s)

async function carregar(bruto: boolean) {
  const produtosRaw = await listarTudo('/produtos', 4)
  const produtos = produtosRaw.map(produtoEstoqueDe)
  const porId = new Map(produtos.map(p => [p.id, p]))
  const estoque = new Map(produtos.filter(p => p.codigo).map(p => [p.codigo, { nome: p.nome, total: p.estoque }]))

  const chave = k('agenda', 'reservas')
  let cache = bruto ? null : await redis.get<{ reservas: Reserva[]; semPeriodo: string[]; lidos: number }>(chave)
  let amostra: Agenda['bruto'] | undefined
  if (!cache) {
    const pedidosRaw = await listarTudo('/pedidos')
    const hoje = new Date().toISOString().slice(0, 10)
    const reservas: Reserva[] = []
    const semPeriodo: string[] = []
    for (const raw of pedidosRaw) {
      const p = pedidoDe(raw)
      if (cancelado(p.situacao)) continue
      const periodo = lerPeriodo(p.obs)
      if (!periodo) { if (semPeriodo.length < 30) semPeriodo.push(p.numero || p.id); continue }
      if (periodo.fim < hoje) continue // locação que já voltou não ocupa nada daqui pra frente
      const itens = (await itensDoPedido(p.id))
        .map(i => ({ codigo: porId.get(i.idProduto)?.codigo || `id:${i.idProduto}`, quantidade: i.quantidade }))
        .filter(i => i.quantidade > 0)
      reservas.push({ pedido: p.numero || p.id, cliente: p.cliente, ...periodo, itens })
    }
    cache = { reservas, semPeriodo, lidos: pedidosRaw.length }
    await redis.set(chave, cache, { ex: CACHE_S })
    if (bruto) {
      const p0 = pedidosRaw[0]
      let itemPedido: Bruto | undefined
      if (p0) { try { itemPedido = (await listarTudo(`/pedidos/${encodeURIComponent(pedidoDe(p0).id)}/produtos`, 1))[0] } catch { /* só diagnóstico */ } }
      amostra = { pedido: p0, produto: produtosRaw[0], itemPedido }
    }
  }
  return { estoque, cache, amostra }
}

export async function montarAgenda(de: string, ate = de, bruto = false): Promise<Agenda> {
  const { estoque, cache, amostra } = await carregar(bruto)
  return {
    de, ate,
    itens: calcularAgenda(cache.reservas, estoque, de, ate).filter(l => l.reservado > 0 || bruto),
    reservas: cache.reservas.filter(r => r.inicio <= ate && r.fim >= de).length,
    semPeriodo: cache.semPeriodo,
    pedidosLidos: cache.lidos,
    ...(amostra ? { bruto: amostra } : {}),
  }
}

/** Disponibilidade de alguns códigos num intervalo (para a IA, na fase 3). */
export async function disponibilidade(codigos: string[], de: string, ate = de): Promise<LinhaAgenda[]> {
  const { estoque, cache } = await carregar(false)
  const alvo = new Set(codigos.map(c => c.toUpperCase()))
  return calcularAgenda(cache.reservas, estoque, de, ate).filter(l => alvo.has(l.codigo))
}
