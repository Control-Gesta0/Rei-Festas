import { k, redis } from './redis'

/**
 * Estado estruturado do lead (o que o modelo NÃO decide sozinho):
 * porta travada, quem está digitando, respostas coletadas e finalização.
 * Coleta e finalização são ESTADO, não decisão livre do modelo (kommo §11).
 */

export interface LeadState {
  /** porta travada pelo roteador — nunca muda depois de definida */
  porta?: string
  /** ts (ms) da 1ª mensagem do bloco que travou a porta — o cérebro só vê a conversa daí em diante */
  portaEm?: number
  /** o menu foi enviado e o lead ainda não escolheu */
  menuEnviado?: boolean
  /** escolheu "outros assuntos": a próxima mensagem é o resumo do caso */
  aguardandoResumo?: boolean
  respondenteNome?: string
  respondenteRelacao?: string
  /** respostas do roteiro, por chave do campo (espelho do que foi gravado no CRM) */
  respostas?: Record<string, string>
  /** campos que o lead disse não saber */
  semResposta?: string[]
  /** assunto de outra porta citado no meio da conversa */
  outroAssunto?: string
  finalizado?: { motivo: string; em: string; resumo: string }
  /** reunião marcada pela IA (evita agendar duas vezes) */
  agendado?: { inicio: string; eventoId?: string }
  /** a IA já consultou a agenda nesta conversa (convite feito) */
  consultouAgenda?: boolean
}

const TTL = 90 * 86400

export async function getState(contactId: string): Promise<LeadState> {
  return (await redis.get<LeadState>(k('state', contactId))) || {}
}

export async function patchState(contactId: string, patch: Partial<LeadState>): Promise<LeadState> {
  const next = { ...(await getState(contactId)), ...patch }
  await redis.set(k('state', contactId), next, { ex: TTL })
  return next
}

export async function clearState(contactId: string): Promise<void> {
  await redis.del(k('state', contactId))
}
