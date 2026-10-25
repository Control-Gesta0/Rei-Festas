import { calcularAgenda, classificarReserva, lerPeriodo, type LinhaAgenda, type Reserva } from './locacao'
import { k, redis } from './redis'
import { itensDoPedido, listarTudo, pedidoDe, produtoEstoqueDe, type Bruto } from './vhsys'

/**
 * AGENDA DE RESERVAS (somente leitura no VHSYS), modelo A (D20): o estoque do
 * VHSYS é o patrimônio e nunca é lançado na locação. Reserva = PEDIDO com a linha
 * "LOCAÇÃO: dd/mm/aaaa a dd/mm/aaaa" na observação, que não foi cancelado nem
 * marcado como atendido. Orçamento não reserva: só o pedido (sinal pago).
 * Período vencido sem "atendido" = devolução pendente (ocupa até hoje). Itens casados pelo id_produto → código do
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
  /** período vencido e o pedido não foi marcado como atendido: material ainda fora */
  devolucoesPendentes: Array<{ pedido: string; cliente: string; devolucao: string; diasAtraso: number }>
  /** pedidos que saem (início) e voltam (fim) hoje */
  hoje: { data: string; saem: string[]; voltam: string[] }
  /** pedidos que ocupam o intervalo consultado (para o painel) */
  pedidos: Array<{ pedido: string; cliente: string; inicio: string; fim: string; itens: number; pecas: number }>
  pedidosLidos: number
  bruto?: { pedido?: Bruto; produto?: Bruto; itemPedido?: Bruto; pedidos?: Array<{ numero: string; situacao: string; periodo: string | null; classificacao: string; itens?: number }> }
}

const CACHE_S = 300
type Pendente = Agenda['devolucoesPendentes'][number]
const hojeLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

async function carregar(bruto: boolean) {
  const produtosRaw = await listarTudo('/produtos', 4)
  const produtos = produtosRaw.map(produtoEstoqueDe)
  const porId = new Map(produtos.map(p => [p.id, p]))
  const estoque = new Map(produtos.filter(p => p.codigo).map(p => [p.codigo, { nome: p.nome, total: p.estoque }]))

  const chave = k('agenda', 'reservas')
  let cache = bruto ? null : await redis.get<{ reservas: Reserva[]; semPeriodo: string[]; pendentes: Pendente[]; lidos: number }>(chave)
  let amostra: Agenda['bruto'] | undefined
  if (!cache) {
    const pedidosRaw = await listarTudo('/pedidos')
    const hoje = hojeLocal()
    const reservas: Reserva[] = []
    const semPeriodo: string[] = []
    const pendentes: Pendente[] = []
    // Diagnóstico (?bruto=1): como cada pedido foi lido e classificado
    const diag: NonNullable<NonNullable<Agenda['bruto']>['pedidos']> = []
    for (const raw of pedidosRaw) {
      const p = pedidoDe(raw)
      const periodo = lerPeriodo(p.obs)
      const d = { numero: p.numero || p.id, situacao: p.situacao, periodo: periodo ? `${periodo.inicio} a ${periodo.fim}` : null, classificacao: 'sem período' } as (typeof diag)[number]
      if (diag.length < 100) diag.push(d)
      if (!periodo) { if (semPeriodo.length < 30 && !/cancel/i.test(p.situacao)) semPeriodo.push(p.numero || p.id); continue }
      const c = classificarReserva(periodo, p.situacao, hoje)
      d.classificacao = c.tipo === 'ignorar' ? 'ignorado (cancelado ou atendido)' : c.tipo
      if (c.tipo === 'ignorar') continue
      const pedido = p.numero || p.id
      if (c.tipo === 'atrasada') pendentes.push({ pedido, cliente: p.cliente, devolucao: periodo.fim, diasAtraso: c.diasAtraso })
      const itens = (await itensDoPedido(p.id))
        .map(i => ({ codigo: porId.get(i.idProduto)?.codigo || `id:${i.idProduto}`, quantidade: i.quantidade }))
        .filter(i => i.quantidade > 0)
      d.itens = itens.length
      reservas.push({ pedido, cliente: p.cliente, inicio: c.inicio, fim: c.fim, itens })
    }
    cache = { reservas, semPeriodo, pendentes: pendentes.sort((a, b) => b.diasAtraso - a.diasAtraso), lidos: pedidosRaw.length }
    await redis.set(chave, cache, { ex: CACHE_S })
    if (bruto) {
      const p0 = pedidosRaw[0]
      let itemPedido: Bruto | undefined
      if (p0) { try { itemPedido = (await listarTudo(`/pedidos/${encodeURIComponent(pedidoDe(p0).id)}/produtos`, 1))[0] } catch { /* só diagnóstico */ } }
      amostra = { pedidos: diag, itemPedido, pedido: p0, produto: produtosRaw[0] }
    }
  }
  return { estoque, cache, amostra }
}

export async function montarAgenda(de: string, ate = de, bruto = false): Promise<Agenda> {
  const { estoque, cache, amostra } = await carregar(bruto)
  const hoje = hojeLocal()
  const pendentes = cache.pendentes || [] // cache gravado antes desta versão não tem a lista
  const atrasados = new Set(pendentes.map(p => p.pedido))
  return {
    de, ate,
    // só o que está reservado (com bruto=1 também: o catálogo inteiro deixava a resposta ilegível)
    itens: calcularAgenda(cache.reservas, estoque, de, ate).filter(l => l.reservado > 0),
    reservas: cache.reservas.filter(r => r.inicio <= ate && r.fim >= de).length,
    semPeriodo: cache.semPeriodo,
    devolucoesPendentes: pendentes,
    hoje: {
      data: hoje,
      saem: cache.reservas.filter(r => r.inicio === hoje).map(r => `${r.pedido} · ${r.cliente}`),
      voltam: cache.reservas.filter(r => r.fim === hoje && !atrasados.has(r.pedido)).map(r => `${r.pedido} · ${r.cliente}`),
    },
    pedidos: cache.reservas.filter(r => r.inicio <= ate && r.fim >= de)
      .map(r => ({ pedido: r.pedido, cliente: r.cliente, inicio: r.inicio, fim: r.fim, itens: r.itens.length, pecas: r.itens.reduce((s, i) => s + i.quantidade, 0) }))
      .sort((a, b) => a.inicio.localeCompare(b.inicio)),
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
