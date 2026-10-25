import { REGRAS_CLIENTE } from './regras'

/**
 * Travas determinísticas — arquivo puro (sem env) para rodar em `npm test`.
 */

export interface Violation { regra: string; trecho: string }

export function checkReply(text: string, regras = REGRAS_CLIENTE): Violation[] {
  const out: Violation[] = []
  for (const { regra, re } of regras) {
    const m = text.match(re)
    if (m) out.push({ regra, trecho: m[0] })
  }
  // GPT-5.4 Mini sem raciocínio às vezes vaza sintaxe de tool, JSON ou alfabeto estranho (comum §49)
  const corrupt = text.match(/to=functions\.|\w+\(\{"|[ऀ-෿฀-๿ក-៿぀-ヿ一-鿿가-힯]/)
  if (corrupt) out.push({ regra: 'texto corrompido', trecho: corrupt[0] })
  const json = text.match(/^\s*[\[{]|"(campo|evidencia|respostas|motivo|resumo|valor)"\s*:/)
  if (json) out.push({ regra: 'texto corrompido', trecho: json[0] })
  const perguntas = contarPerguntas(text)
  if (perguntas > 1) out.push({ regra: 'mais de uma pergunta', trecho: `${perguntas} interrogações` })
  if (!text.trim()) out.push({ regra: 'vazio', trecho: '' })
  return out
}

/** "Olá, tudo certo?" é cumprimento, não pergunta: não conta na regra de uma pergunta por vez. */
const CUMPRIMENTO = /\b(tudo (bem|certo|bom|joia|tranquilo|ok)|como vai( você)?|beleza|td bem)\s*\?/gi
export function contarPerguntas(text: string): number {
  return (text.replace(CUMPRIMENTO, '').match(/\?/g) || []).length
}

export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** "1.800", "R$ 1.491,00", "2,6 mil", "1800.50" → número. null se não der. */
export function parseNumeroBR(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  let s = String(input ?? '').toLowerCase().replace(/r\$|reais|\s/g, '')
  if (!s) return null
  let mult = 1
  if (/mil$/.test(s)) { mult = 1000; s = s.replace(/mil$/, '') }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) && s !== '' ? Math.round(n * mult * 100) / 100 : null
}

/** Casa o valor do modelo com a opção EXATA do CRM (tolerante a acento/pontuação). */
export function matchOption<T extends { value: string }>(valor: string, options: T[]): T | null {
  const v = norm(valor)
  if (!v) return null
  const exact = options.find(o => norm(o.value) === v)
  if (exact) return exact
  const prefix = options.filter(o => norm(o.value).startsWith(v) || v.startsWith(norm(o.value)))
  return prefix.length === 1 ? prefix[0] : null
}

/** Anti-invenção: 60% das palavras relevantes da evidência aparecem no que o lead escreveu. */
export function evidenceFound(evidencia: string, leadText: string): boolean {
  const words = norm(evidencia).split(' ').filter(w => w.length >= 3 || /\d/.test(w))
  if (!words.length) return /^(sim|nao|n)$/.test(norm(evidencia)) && new RegExp(`\\b${norm(evidencia)}\\b`).test(norm(leadText))
  const hay = ` ${norm(leadText)} `
  return words.filter(w => hay.includes(` ${w}`) || hay.includes(`${w} `)).length / words.length >= 0.6
}

const STOP = new Set(['voce', 'voces', 'para', 'qual', 'algum', 'alguma', 'essa', 'esse', 'pessoa', 'hoje', 'sobre', 'isso', 'caso', 'posso', 'perguntar', 'antes', 'mais', 'ainda', 'tem', 'que', 'uma', 'com', 'dos', 'das', 'seu', 'sua', 'nome'])

/** Quanto das palavras relevantes de `ref` aparece em `text` (0–1). */
export function overlap(text: string, ref: string): number {
  const words = norm(ref).split(' ').filter(w => w.length >= 3 && !STOP.has(w))
  if (!words.length) return 0
  const hay = ` ${norm(text)} `
  return words.filter(w => hay.includes(` ${w}`)).length / words.length
}

/** Mantém só a ÚLTIMA frase interrogativa quando as outras são eco da pergunta do lead. */
export function keepLastQuestion(text: string, lastLead = ''): string | null {
  const frases = text.split(/(?<=[.!?])\s+/)
  const ultima = frases.map(f => f.includes('?')).lastIndexOf(true)
  const removidas = frases.filter((f, i) => f.includes('?') && i !== ultima)
  if (lastLead && removidas.some(f => overlap(lastLead, f) < 0.5)) return null
  return frases.filter((f, i) => !f.includes('?') || i === ultima).join(' ').replace(/\s{2,}/g, ' ').trim()
}

export const DISSE_NAO_SEI = /n[aã]o sei|sei l[aá]|n[aã]o lembro|n[aã]o fa[cç]o ideia|n[aã]o tenho certeza/i

/**
 * Primeira mensagem sem o cumprimento da loja: põe "Olá, boa tarde! Tudo bem?" na frente.
 * Usa o período que o lead usou ("boa tarde"); senão, a hora (0-23) no fuso.
 */
export function comCumprimento(text: string, hora: number, textoLead = ''): string {
  if (/^\W*(ol[aá]|oi\b|bom dia|boa tarde|boa noite)/i.test(text)) return text
  const doLead = /\b(bom dia|boa tarde|boa noite)\b/i.exec(textoLead)?.[1].toLowerCase()
  const periodo = doLead || (hora < 12 ? 'bom dia' : hora < 18 ? 'boa tarde' : 'boa noite')
  return `Olá, ${periodo}! Tudo bem? ${text}`
}
