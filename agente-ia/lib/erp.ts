/**
 * PEDIDO FECHADO → VHSYS. A jornada do GHL termina em "Pedido fechado" (o
 * aceite do cliente). Daí para a frente (reserva no app Locações, sinal, saldo,
 * recebimento) é tudo no VHSYS. Esta é a ponte:
 *
 *   1. cliente: busca pelo CPF/CNPJ e cadastra se não existir (nunca sobrescreve
 *      um cadastro que já está no VHSYS);
 *   2. orçamento: itens do card com código do catálogo, quantidade e preço;
 *   3. volta no GHL: nº do orçamento no card, id do cliente no contato, nota,
 *      tag erp-sincronizado e oportunidade marcada como Ganho.
 *
 * O app Locações não tem API: a Karol lança a locação a partir do orçamento.
 *
 * ERP_MODO=gravar cria de verdade; qualquer outro valor é ENSAIO (só lê o VHSYS
 * e devolve o plano). Funções puras primeiro (testadas em scripts/test-cliente.ts).
 */
import type { ItemCatalogo } from './crm-map-types'
import { reais } from './catalogo'

// ---------- Funções puras ----------

export interface ItemPedido { codigo: string; quantidade: number; descricao: string; valorUnit: number | null }

/**
 * Lê o campo "Itens solicitados" do card. Formato gravado pela calcular_tabela:
 *   "LOU-001 · 30 × Prato Refeição Fundo · R$ 3,50 cada = R$ 105,00"
 *   "1 × Arranjo de flores (fora do catálogo)"
 * A Karol pode editar a lista no card antes do aceite: vale o código e a
 * quantidade de cada linha; o preço da linha, se tiver, senão o da tabela.
 */
export function lerItens(texto: string, catalogo: ItemCatalogo[]): { itens: ItemPedido[]; semCodigo: string[] } {
  const porCodigo = new Map(catalogo.map(i => [i.codigo.toUpperCase(), i]))
  const itens: ItemPedido[] = []
  const semCodigo: string[] = []
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const linha = bruta.trim()
    if (!linha) continue
    const m = linha.match(/^([A-Z]{3}-\d{3})\s*[·\-|]\s*(\d+)\s*[×x]\s*(.+?)\s*(?:·\s*R\$\s*([\d.]+,\d{2})\s*cada.*)?$/i)
    const item = m ? porCodigo.get(m[1].toUpperCase()) : undefined
    if (!m || !item) { semCodigo.push(linha); continue }
    const daLinha = m[4] ? Number(m[4].replace(/\./g, '').replace(',', '.')) : null
    const quantidade = Number(m[2])
    if (!quantidade) { semCodigo.push(linha); continue }
    const ja = itens.find(i => i.codigo === item.codigo)
    if (ja) { ja.quantidade += quantidade; continue }
    itens.push({ codigo: item.codigo, quantidade, descricao: item.nome, valorUnit: daLinha ?? item.preco })
  }
  return { itens, semCodigo }
}

/** CPF (11 dígitos) ou CNPJ (14), formatado como o VHSYS guarda. */
export function documento(raw: unknown): { tipo: 'PF' | 'PJ'; digitos: string; formatado: string } | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11) return { tipo: 'PF', digitos: d, formatado: d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') }
  if (d.length === 14) return { tipo: 'PJ', digitos: d, formatado: d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') }
  return null
}

/** Data de campo DATE do GHL (ISO, "AAAA-MM-DD" ou epoch ms) → "dd/mm/aaaa". */
export function dataBR(v: unknown): string {
  if (v == null || v === '') return ''
  const n = typeof v === 'number' ? v : /^\d{10,}$/.test(String(v)) ? Number(v) : NaN
  const iso = Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : String(v).slice(0, 10)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v)
}

export interface DadosPedido {
  nome: string
  documento: string
  rg?: string
  email?: string
  telefone?: string
  endereco?: string
  cidade?: string
  itensTexto: string
  dataEvento?: unknown
  entregaRetirada?: string
  enderecoEvento?: string
  contatoLocal?: string
  tipoEvento?: string
  convidados?: unknown
  formaPagamento?: string
  opportunityId: string
}

export function payloadCliente(d: DadosPedido, doc: NonNullable<ReturnType<typeof documento>>, hoje: string): Record<string, unknown> {
  const p: Record<string, unknown> = {
    tipo_pessoa: doc.tipo,
    tipo_cadastro: 'Cliente',
    razao_cliente: d.nome,
    cnpj_cliente: doc.formatado,
    obs_cliente: `Cadastrado pela integração com o CRM (GHL) em ${hoje}.`,
  }
  if (d.rg) p.rg_cliente = d.rg
  if (d.email) p.email_cliente = d.email
  if (d.telefone) p.celular_cliente = d.telefone
  if (d.endereco) p.endereco_cliente = d.endereco
  if (d.cidade) p.cidade_cliente = d.cidade
  return p
}

/** Observação do orçamento: o que a Karol precisa para lançar a locação sem abrir o GHL. */
export function obsOrcamento(d: DadosPedido, semCodigo: string[]): string {
  const linhas = [
    d.dataEvento ? `Data do evento: ${dataBR(d.dataEvento)}` : '',
    d.entregaRetirada ? `Entrega ou retirada: ${d.entregaRetirada}` : '',
    d.entregaRetirada === 'Entrega' && d.enderecoEvento ? `Endereço do evento: ${d.enderecoEvento}` : '',
    d.entregaRetirada === 'Entrega' && d.contatoLocal ? `Quem recebe no local: ${d.contatoLocal}` : '',
    d.tipoEvento ? `Evento: ${d.tipoEvento}${d.convidados ? `, ${d.convidados} convidados` : ''}` : '',
    d.formaPagamento ? `Pagamento preferido: ${d.formaPagamento}` : '',
    semCodigo.length ? `Itens sem código do catálogo (conferir): ${semCodigo.join('; ')}` : '',
  ]
  return linhas.filter(Boolean).join('\n')
}

export function totalItens(itens: ItemPedido[]): number {
  return Math.round(itens.reduce((s, i) => s + (i.valorUnit ?? 0) * i.quantidade, 0) * 100) / 100
}

export function resumoNota(r: { clienteId: string; clienteNovo: boolean; orcamento: string; itens: ItemPedido[]; semCodigo: string[] }): string {
  return [
    `[ERP] Pedido enviado ao VHSYS. Orçamento nº ${r.orcamento}.`,
    `Cliente ${r.clienteNovo ? 'cadastrado' : 'já existia'} no VHSYS (id ${r.clienteId}).`,
    `${r.itens.length} item(ns), total de tabela ${reais(totalItens(r.itens))}.`,
    r.semCodigo.length ? `Conferir à mão (sem código do catálogo): ${r.semCodigo.join('; ')}` : '',
    'Próximo passo: lançar a locação no app Locações a partir do orçamento.',
  ].filter(Boolean).join('\n')
}
