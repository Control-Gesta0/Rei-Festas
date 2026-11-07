import { CRM_MAP } from './crm-map'
import type { ChatMsg } from './history'
import type { LeadState } from './state'

/**
 * CICLO DE ATENDIMENTO no modo "atende todos" (GATE_TAG vazio). Funções PURAS.
 *
 * Sem a tag de gate, quem diz se a IA entra é o estado da conversa:
 *  - pedido em andamento com a equipe (card aberto depois da IA): silêncio, o negócio é da Karol;
 *  - acabou de passar para a equipe (finalizou): silêncio por SILENCIO_POS_HANDOFF_H;
 *  - nunca atendido pela IA, ou conversa parada há NOVO_CICLO_APOS_DIAS: atendimento NOVO,
 *    que começa na mensagem atual (o histórico antigo com a equipe não entra no contexto);
 *  - senão: continua o atendimento em andamento.
 */

/** horas em que a IA fica quieta depois de passar o atendimento para a equipe */
export const SILENCIO_POS_HANDOFF_H = Number(process.env.SILENCIO_POS_HANDOFF_H || 24)
/** conversa parada há mais que isso: a próxima mensagem abre um atendimento novo */
export const NOVO_CICLO_APOS_DIAS = Number(process.env.NOVO_CICLO_APOS_DIAS || 3)

/** etapas em que o pedido já está com a equipe (depois da IA) */
export const ETAPAS_DA_EQUIPE: string[] = CRM_MAP.oportunidade.stageOrder.filter(
  id => !CRM_MAP.oportunidade.reusarSoNasEtapas.includes(id),
)

export type Silencio = { silencio: true; motivo: string } | { silencio: false; limparEstado: boolean }

/** Antes do buffer: a IA fica quieta? (e o estado de um atendimento finalizado já venceu?) */
export function decidirSilencio(p: { state: LeadState; agora: number; etapaDaEquipe: string | null }): Silencio {
  if (p.etapaDaEquipe) return { silencio: true, motivo: `pedido em andamento com a equipe (card em "${p.etapaDaEquipe}")` }
  const fin = p.state.finalizado
  if (fin) {
    const horas = (p.agora - Date.parse(fin.em)) / 3600e3
    if (horas < SILENCIO_POS_HANDOFF_H) return { silencio: true, motivo: `passou para a equipe há ${Math.floor(horas)}h (${fin.motivo})` }
    return { silencio: false, limparEstado: true }
  }
  return { silencio: false, limparEstado: false }
}

/**
 * Depois de ler a conversa: começa um atendimento novo? Devolve o corte (ts da 1ª mensagem
 * do bloco atual do lead) ou null para continuar o que já existe.
 */
export function inicioDoNovoCiclo(p: { state: LeadState; msgs: ChatMsg[]; agora: number }): number | null {
  const limite = NOVO_CICLO_APOS_DIAS * 86400e3
  const iOut = p.msgs.map(m => m.dir).lastIndexOf('out')
  const bloco = p.msgs.slice(iOut + 1).filter(m => m.dir === 'in')
  if (!bloco.length) return null
  // Mensagens antigas sem resposta no começo do bloco não entram: o bloco começa depois do último buraco grande
  let i = bloco.length - 1
  while (i > 0 && bloco[i].ts - bloco[i - 1].ts <= limite) i--
  const inicio = bloco[i].ts
  if (!p.state.porta || i > 0) return inicio
  const anterior = iOut >= 0 ? p.msgs[iOut].ts : null
  if (anterior !== null && inicio - anterior > limite) return inicio
  return null
}
