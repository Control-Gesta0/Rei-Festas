/**
 * LOCAÇÃO SEM O APP LOCAÇÕES (decisão D20). O pedido de locação é o PEDIDO do
 * VHSYS (gerado do orçamento da integração). O período da locação vai numa linha
 * fixa da observação do pedido, que a Karol pode ajustar:
 *
 *   LOCAÇÃO: 30/10/2026 a 02/11/2026
 *
 * (retirada ou entrega → devolução ou recolha). A agenda de reservas lê os
 * pedidos, essa linha e os itens, e calcula quanto de cada item está livre em
 * cada data. Funções puras (testadas em scripts/test-cliente.ts).
 */
import { diaDaSemana, formatarData } from './datas'

const umDia = 86400000
const somaDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * umDia).toISOString().slice(0, 10)
const util = (iso: string) => { const d = diaDaSemana(iso); return d >= 1 && d <= 5 }

/**
 * Período padrão pelas regras da loja: sai no último dia útil (seg a sex) ANTES do
 * evento e volta no primeiro dia útil DEPOIS dele. Evento no fim de semana vira
 * sexta → segunda; não há devolução no sábado. Feriado não é considerado: a Karol
 * ajusta a linha no pedido.
 */
export function periodoPadrao(dataEventoIso: string): { inicio: string; fim: string } {
  let inicio = somaDias(dataEventoIso, -1)
  while (!util(inicio)) inicio = somaDias(inicio, -1)
  let fim = somaDias(dataEventoIso, 1)
  while (!util(fim)) fim = somaDias(fim, 1)
  return { inicio, fim }
}

const br = (iso: string) => formatarData(iso).slice(4) // "30/10/2026"

export function linhaPeriodo(p: { inicio: string; fim: string }): string {
  return `LOCAÇÃO: ${br(p.inicio)} a ${br(p.fim)}`
}

/** Lê a linha "LOCAÇÃO: dd/mm/aaaa a dd/mm/aaaa" de uma observação. */
export function lerPeriodo(obs: unknown): { inicio: string; fim: string } | null {
  const m = String(obs ?? '').match(/LOCA[ÇC][ÃA]O:\s*(\d{2})\/(\d{2})\/(\d{4})\s*(?:a|até|-)\s*(\d{2})\/(\d{2})\/(\d{4})/i)
  if (!m) return null
  const inicio = `${m[3]}-${m[2]}-${m[1]}`
  const fim = `${m[6]}-${m[5]}-${m[4]}`
  if (Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fim)) || fim < inicio) return null
  return { inicio, fim }
}

export interface Reserva { pedido: string; cliente: string; inicio: string; fim: string; itens: Array<{ codigo: string; quantidade: number }> }

export interface LinhaAgenda {
  codigo: string
  nome: string
  total: number | null
  /** maior quantidade comprometida num mesmo dia do intervalo */
  reservado: number
  livre: number | null
  pedidos: string[]
}

/**
 * Disponibilidade de cada item no intervalo [de, ate]: total do estoque menos o
 * PICO de reservas num mesmo dia (duas locações em dias diferentes do intervalo
 * não somam). Total desconhecido (estoque não cadastrado) → livre null.
 */
export function calcularAgenda(
  reservas: Reserva[],
  estoque: Map<string, { nome: string; total: number | null }>,
  de: string,
  ate: string = de,
): LinhaAgenda[] {
  const noIntervalo = reservas.filter(r => r.inicio <= ate && r.fim >= de)
  const codigos = new Set<string>([...estoque.keys()])
  for (const r of noIntervalo) for (const i of r.itens) codigos.add(i.codigo)
  const linhas: LinhaAgenda[] = []
  for (const codigo of codigos) {
    let pico = 0
    for (let dia = de; dia <= ate; dia = somaDias(dia, 1)) {
      const noDia = noIntervalo.filter(r => r.inicio <= dia && r.fim >= dia)
        .reduce((s, r) => s + r.itens.filter(i => i.codigo === codigo).reduce((a, i) => a + i.quantidade, 0), 0)
      pico = Math.max(pico, noDia)
    }
    const pedidos = noIntervalo.filter(r => r.itens.some(i => i.codigo === codigo)).map(r => r.pedido)
    const e = estoque.get(codigo)
    const total = e?.total ?? null
    if (!pico && !e) continue
    linhas.push({ codigo, nome: e?.nome || codigo, total, reservado: pico, livre: total == null ? null : total - pico, pedidos })
  }
  return linhas.sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/** Situação do pedido no VHSYS que encerra a locação (material de volta). Conferir os nomes com ?bruto=1. */
export const pedidoCancelado = (situacao: string) => /cancel/i.test(situacao)
export const pedidoConcluido = (situacao: string) => /atendid|conclu|finaliz|devolvid/i.test(situacao)

/**
 * Modelo A (D20): o estoque do VHSYS é o patrimônio; quem ocupa é a reserva.
 * - cancelado ou concluído (atendido): não ocupa nada, nem que o período não tenha acabado
 *   (material devolvido antes da hora libera na hora);
 * - período vencido e não concluído: DEVOLUÇÃO PENDENTE. O material continua fora, então
 *   ocupa até hoje e aparece na lista para a equipe cobrar ou dar baixa;
 * - senão: ocupa o período da linha LOCAÇÃO.
 */
export function classificarReserva(
  periodo: { inicio: string; fim: string },
  situacao: string,
  hoje: string,
): { tipo: 'ignorar' } | { tipo: 'ativa' | 'atrasada'; inicio: string; fim: string; diasAtraso: number } {
  if (pedidoCancelado(situacao) || pedidoConcluido(situacao)) return { tipo: 'ignorar' }
  if (periodo.fim < hoje) {
    const diasAtraso = Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${periodo.fim}T12:00:00Z`)) / umDia)
    return { tipo: 'atrasada', inicio: periodo.inicio, fim: hoje, diasAtraso }
  }
  return { tipo: 'ativa', ...periodo, diasAtraso: 0 }
}
