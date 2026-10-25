import { CRM_MAP, portaById, type Porta } from './crm-map'
import type { LeadState } from './state'

/**
 * Roteador em CÓDIGO (zero token). Substitui o "agente de triagem" do n8n que
 * pagava LLM para reconhecer "3". A porta, uma vez travada, nunca muda.
 *
 * Ordem: porta travada → número do menu → resumo de "outros" → texto livre
 * com sinal inequívoco → menu (1ª vez) → "não entendi".
 */

export type Rota =
  | { tipo: 'porta'; porta: Porta; travou: boolean }
  | { tipo: 'mensagem'; texto: string; patch: Partial<LeadState> }

/** "3", "3️⃣", "3 - BPC", "3) bpc", "opção 3" → 3 */
export function escolhaMenu(text: string): number | null {
  const t = text.trim()
  const m = t.match(/^(?:op[cç][aã]o\s*)?(\d{1,2})(?:️?⃣)?(?:\s*[-–.)]|\s|$)/i)
  return m ? Number(m[1]) : null
}

/** Portas cujos sinais aparecem no texto. */
export function classificar(text: string, portas = CRM_MAP.portas): Porta[] {
  return portas.filter(p => p.sinais.source !== '$^' && p.sinais.test(text))
}

export function rotear(state: LeadState, textoTurno: string): Rota {
  const travada = portaById(state.porta)
  if (travada) return { tipo: 'porta', porta: travada, travou: false }

  // Sem menu: todo lead entra direto na porta padrão
  if (!CRM_MAP.menu.ativo) {
    const padrao = portaById(CRM_MAP.menu.portaPadrao)
    if (padrao) return { tipo: 'porta', porta: padrao, travou: true }
  }

  // Antes de o menu ser mostrado, só vale número SOZINHO ("2 anos que parou" não é opção 2)
  const soNumero = /^\s*(?:op[cç][aã]o\s*)?\d{1,2}️?⃣?\s*$/i.test(textoTurno)
  const n = state.menuEnviado || soNumero ? escolhaMenu(textoTurno) : null
  if (n !== null) {
    const porta = CRM_MAP.portas.find(p => p.menu === n)
    if (porta) return { tipo: 'porta', porta, travou: true }
    if (n === CRM_MAP.menu.outros) {
      return { tipo: 'mensagem', texto: CRM_MAP.menu.pedirResumo, patch: { aguardandoResumo: true, menuEnviado: true } }
    }
  }

  if (state.aguardandoResumo) {
    const achadas = classificar(textoTurno)
    const porta = achadas.length === 1 ? achadas[0] : portaById(CRM_MAP.menu.portaPadraoOutros)
    if (porta) return { tipo: 'porta', porta, travou: true }
  }

  if (CRM_MAP.menu.classificarTextoLivre) {
    const achadas = classificar(textoTurno)
    if (achadas.length === 1) return { tipo: 'porta', porta: achadas[0], travou: true }
  }

  if (!state.menuEnviado) return { tipo: 'mensagem', texto: CRM_MAP.menu.texto, patch: { menuEnviado: true } }
  return { tipo: 'mensagem', texto: CRM_MAP.menu.naoEntendi, patch: {} }
}
