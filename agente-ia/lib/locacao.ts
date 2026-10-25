/**
 * LOCAÇÃO SEM O APP LOCAÇÕES (decisão D20). O pedido de locação é o PEDIDO do
 * VHSYS (gerado do orçamento da integração). O período da locação vai numa linha
 * fixa da observação do pedido, que a nossa equipe pode ajustar:
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

export interface ItemConsulta { codigo: string; nome: string; quantidade: number; livre: number | null }

/**
 * Resposta da ferramenta consultar_disponibilidade para o modelo (D20, fase 3).
 * Regra de fala decidida pelo mestre: "pela nossa agenda tem ... livres; a Karol
 * confirma ao fechar o orçamento". Só o pedido (sinal pago) reserva: dois clientes
 * podem querer o mesmo item antes disso, por isso nunca "reservado" ou "garantido".
 */
export function textoDisponibilidade(itens: ItemConsulta[], periodo: { inicio: string; fim: string }, dataEvento: string): { texto: string; ok: boolean; conhecidos: number } {
  const linhas: string[] = []
  let falta = false
  const conhecidos = itens.filter(i => i.livre != null).length
  for (const i of itens) {
    if (i.livre == null) linhas.push(`${i.nome}: estoque não cadastrado na agenda → NÃO fale de disponibilidade deste item; diga que a nossa equipe confere`)
    else if (i.livre >= i.quantidade) linhas.push(`${i.nome}: pediu ${i.quantidade}, livres ${i.livre} → TEM`)
    else { falta = true; linhas.push(`${i.nome}: pediu ${i.quantidade}, livres só ${Math.max(0, i.livre)} → FALTA ${i.quantidade - Math.max(0, i.livre)}`) }
  }
  const dia = formatarData(dataEvento).slice(4, 9)
  const como = !conhecidos
    ? 'A agenda não tem o estoque destes itens: NÃO fale de agenda nem de livre. Diga que a nossa equipe confere a disponibilidade para a data.'
    : falta
    ? `Diga quantos a agenda mostra livres do item que falta e que a nossa equipe vê opções pra completar (ex.: "pela nossa agenda só tem 50 livres pro dia ${dia}; a nossa equipe vê opções pra completar, com outro modelo ou mais unidades"); siga montando o pedido.`
    : `Diga: "pela nossa agenda tem livre pro dia ${dia}; a nossa equipe confirma quando fechar o orçamento"${conhecidos < itens.length ? ' (só dos itens marcados TEM; dos outros, a nossa equipe confere)' : ''}.`
  return {
    ok: !falta,
    conhecidos,
    texto: [
      `Agenda de ${formatarData(periodo.inicio).slice(4)} a ${formatarData(periodo.fim).slice(4)} (retirada → devolução do evento ${formatarData(dataEvento).slice(4)}):`,
      ...linhas.map(l => `- ${l}`),
      como,
      'NUNCA diga reservado, garantido ou separado: só o pedido com sinal pago reserva. Não fale a quantidade total do estoque, só o que está livre.',
    ].join('\n'),
  }
}

/** A resposta fala da agenda ou de quantidade livre? (trava: só depois de consultar_disponibilidade). Devolve o trecho. */
export function falouDaAgenda(texto: string): string | null {
  const m = texto.match(/\bpela (?:nossa )?agenda\b|\bna (?:nossa )?agenda\b|\b\d+\s+(?:[a-zà-ú]+\s+){0,4}livres?\b|\btem livres?\b|\best[aá]o livres?\b/i)
  return m ? m[0] : null
}

/** O lead perguntou se tem o item pra uma data? (dispara a cobrança de consultar_disponibilidade) */
export function perguntouDisponibilidade(textoLead: string, temDataGravada: boolean): boolean {
  const pergunta = /\b(?:voc[eê]s\s+)?t[eê]m\b[^.?!]*\?|\bdispon[ií]ve(?:l|is)\b|\blivres?\b|\bainda tem\b|\bconsegue[ms]?\b[^.?!]*\?/i.test(textoLead)
  const data = temDataGravada || /\b\d{1,2}\/\d{1,2}\b|\bdia\s+\d{1,2}\b|s[aá]bado|domingo|segunda|ter[cç]a|quarta|quinta|sexta|amanh[aã]|hoje/i.test(textoLead)
  return pergunta && data
}
