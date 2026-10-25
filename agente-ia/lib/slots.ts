
/**
 * Agenda — funções PURAS (testáveis sem env).
 *
 * comum/PEGADINHAS §44: o lead responde "15h" ou "o primeiro" num turno em que o
 * modelo NÃO vê mais o resultado da consulta. Por isso a oferta fica salva no
 * Redis e a escolha do lead é resolvida em CÓDIGO contra ela — o modelo nunca
 * reconstrói o ISO.
 */

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

export function partes(iso: string, tz: string) {
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]))
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dow)
  return { dia: Number(p.day), mes: Number(p.month), hora: Number(p.hour) % 24, minuto: Number(p.minute), semana: DIAS[idx] }
}

/** "qui 24/09 às 15:00" */
export function formatSlot(iso: string, tz: string): string {
  const p = partes(iso, tz)
  const dd = String(p.dia).padStart(2, '0')
  const mm = String(p.mes).padStart(2, '0')
  return `${p.semana} ${dd}/${mm} às ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`
}

/** Escolhe até `max` horários espalhados (não 4 seguidos no mesmo dia). */
export function espalhar(slots: string[], max: number, tz: string): string[] {
  const porDia = new Map<string, string[]>()
  for (const s of slots) {
    const p = partes(s, tz)
    const key = `${p.mes}-${p.dia}`
    porDia.set(key, [...(porDia.get(key) || []), s])
  }
  const out: string[] = []
  const dias = [...porDia.values()]
  for (let rodada = 0; out.length < max && rodada < 24; rodada++) {
    for (const lista of dias) {
      const i = rodada === 0 ? 0 : Math.floor((lista.length - 1) / 2) + rodada - 1
      if (lista[i] && !out.includes(lista[i]) && out.length < max) out.push(lista[i])
    }
    if (rodada > 0 && dias.every(l => l.length <= rodada)) break
  }
  return out.sort((a, b) => Date.parse(a) - Date.parse(b))
}

const ORDINAIS: Array<[RegExp, number]> = [
  [/\b(primeir[oa]|1|opcao 1)\b/, 0],
  [/\b(segund[oa]|2|opcao 2)\b/, 1],
  [/\b(terceir[oa]|3|opcao 3)\b/, 2],
  [/\b(quart[oa]|4|opcao 4)\b/, 3],
  [/\b(ultim[oa])\b/, -1],
]

const SEMANA_RE: Array<[RegExp, string]> = [
  [/\bsegunda\b/, 'seg'], [/\bterca\b/, 'ter'], [/\bquarta\b/, 'qua'],
  [/\bquinta\b/, 'qui'], [/\bsexta\b/, 'sex'], [/\bsabado\b/, 'sab'], [/\bdomingo\b/, 'dom'],
]

export type Resolucao = { ok: true; iso: string } | { ok: false; motivo: 'nenhum' | 'ambiguo'; candidatos: string[] }

/** Resolve o que o lead escreveu ("15h", "16 horas", "o primeiro", "quinta 10:30") contra a oferta salva. */
const limpa = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9:/]+/g, ' ').trim()

export function resolverEscolha(escolha: string, oferta: string[], tz: string): Resolucao {
  const t = ` ${limpa(escolha)} `
  if (!oferta.length) return { ok: false, motivo: 'nenhum', candidatos: [] }

  let cands = [...oferta]
  // hora: "15h", "15:30", "15h30", "15 horas", "as 15"
  const hm = t.match(/\b(\d{1,2})\s*(?:h|horas?|:)\s*(\d{2})?\b/) || t.match(/\bas\s+(\d{1,2})\b/)
  const temHora = !!hm
  if (hm) {
    const h = Number(hm[1])
    const m = hm[2] ? Number(hm[2]) : null
    cands = cands.filter(s => { const p = partes(s, tz); return p.hora === h && (m === null || p.minuto === m) })
    // "15h" sem minutos = 15:00 quando existe; senão aceita 15:30
    if (m === null && cands.some(s => partes(s, tz).minuto === 0)) cands = cands.filter(s => partes(s, tz).minuto === 0)
  }
  // dia do mês: "24/09" ou "dia 24"
  const dm = t.match(/\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/) || t.match(/\bdia\s+(\d{1,2})\b/)
  if (dm) {
    const dia = Number(dm[1])
    cands = cands.filter(s => partes(s, tz).dia === dia)
  }
  // dia da semana
  // "a segunda" sem hora/dia/"feira" é ordinal ("a segunda opção"), não segunda-feira
  const sem = SEMANA_RE.find(([re, d]) => re.test(t) && (d !== 'seg' || /segunda\s*feira/.test(t) || !!hm || !!dm))
  if (sem) cands = cands.filter(s => partes(s, tz).semana === sem[1])

  if (!temHora && !dm && !sem) {
    const ord = ORDINAIS.find(([re]) => re.test(t))
    if (ord) {
      const iso = ord[1] === -1 ? oferta[oferta.length - 1] : oferta[ord[1]]
      return iso ? { ok: true, iso } : { ok: false, motivo: 'nenhum', candidatos: [] }
    }
    return { ok: false, motivo: 'nenhum', candidatos: [] }
  }
  if (cands.length === 1) return { ok: true, iso: cands[0] }
  return { ok: false, motivo: cands.length ? 'ambiguo' : 'nenhum', candidatos: cands }
}
