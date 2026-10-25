import { norm } from './guards'

/**
 * Datas ditas pelo lead → AAAA-MM-DD, em CÓDIGO. O modelo erra dia da semana
 * e ano com frequência; aqui a conta é feita uma vez e conferida.
 * Arquivo puro (sem env) para rodar em `npm test`.
 */

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Hoje (AAAA-MM-DD) no fuso informado. */
export function hojeNoFuso(timezone: string, agora = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: timezone })
}

const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function valida(a: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(a, m - 1, d))
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Dias entre duas datas AAAA-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

export function diaDaSemana(isoData: string): number {
  return new Date(`${isoData}T12:00:00Z`).getUTCDay()
}

/** "sáb 31/10/2026" */
export function formatarData(isoData: string): string {
  const [a, m, d] = isoData.split('-')
  return `${DIAS_CURTOS[diaDaSemana(isoData)]} ${d}/${m}/${a}`
}

/**
 * "2026-11-20", "20/11/2026", "20/11/26", "20/11", "20 de novembro" → AAAA-MM-DD.
 * Sem ano: a próxima ocorrência a partir de hoje. Data que já passou é recusada.
 */
export function parseDataBR(raw: string, hoje: string): { iso: string } | { error: string } {
  const t = norm(raw)
  let a: number | undefined
  let m: number | undefined
  let d: number | undefined
  let r = t.match(/^(\d{4}) (\d{1,2}) (\d{1,2})$/)
  if (r) [a, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])]
  if (!r && (r = t.match(/^(\d{1,2}) (\d{1,2})(?: (\d{2}|\d{4}))?$/))) {
    d = Number(r[1]); m = Number(r[2])
    if (r[3]) a = r[3].length === 2 ? 2000 + Number(r[3]) : Number(r[3])
  }
  if (!r && (r = t.match(/^(?:dia )?(\d{1,2}) (?:de )?([a-z]+)(?: (?:de )?(\d{4}))?$/))) {
    const i = MESES.findIndex(x => x.startsWith(r![2].slice(0, 3)))
    if (i >= 0) { d = Number(r[1]); m = i + 1; if (r[3]) a = Number(r[3]) }
  }
  if (d === undefined || m === undefined) return { error: `"${raw}" não é uma data. Passe no formato dd/mm/aaaa` }
  const anoHoje = Number(hoje.slice(0, 4))
  if (a === undefined) {
    a = anoHoje
    if (valida(a, m, d) && iso(a, m, d) < hoje) a++
  }
  if (!valida(a, m, d)) return { error: `"${raw}" não é uma data válida` }
  const out = iso(a, m, d)
  if (out < hoje) return { error: `${formatarData(out)} já passou. Confirme a data com a pessoa` }
  if (diasEntre(hoje, out) > 730) return { error: `${formatarData(out)} está a mais de 2 anos. Confirme a data com a pessoa` }
  return { iso: out }
}

/**
 * A evidência do lead fala "sábado", "amanhã" ou "hoje"? A data calculada tem
 * que bater. Devolve o erro ou null.
 */
export function conferirEvidenciaData(evidencia: string, isoData: string, hoje: string): string | null {
  const ev = norm(evidencia)
  if (/\bhoje\b/.test(ev) && isoData !== hoje) return `a pessoa disse "hoje", que é ${formatarData(hoje)}`
  if (/\bamanha\b/.test(ev) && diasEntre(hoje, isoData) !== 1) {
    const amanha = new Date(Date.parse(`${hoje}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
    return `a pessoa disse "amanhã", que é ${formatarData(amanha)}`
  }
  const dia = DIAS.findIndex(x => new RegExp(`\\b${x}\\b`).test(ev))
  if (dia >= 0 && !/\d/.test(ev) && diaDaSemana(isoData) !== dia) return `${formatarData(isoData)} não cai num(a) ${DIAS[dia]}`
  return null
}
