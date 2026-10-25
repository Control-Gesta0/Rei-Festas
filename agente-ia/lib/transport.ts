import { sendMessage } from './ghl'
import { rememberSent } from './history'
import { comInstancia } from './instancia'

/**
 * Envio no GHL: direto pela API de conversas (POST /conversations/messages).
 * Com a integração por instâncias, a 1ª linha "#switch:<instância>" faz a
 * mensagem sair pelo MESMO número em que o lead escreveu (igual ao bot do menu).
 * WHATSAPP_INSTANCIA fixa uma instância; USAR_INSTANCIA=0 desliga o prefixo.
 *
 * O id da mensagem fica no Redis para a IA saber o que foi ela que mandou.
 * Voz NUNCA passa pelo GHL (o provedor descarta áudio outbound — ghl §A.1).
 */
export async function sendReply(contactId: string, text: string, instancia: string | null = null): Promise<string> {
  const body = text.trim()
  if (!body) throw new Error('resposta vazia — nada enviado')
  const usar = process.env.USAR_INSTANCIA !== '0'
  const inst = usar ? (process.env.WHATSAPP_INSTANCIA || instancia) : null
  const r = await sendMessage(contactId, comInstancia(body, inst))
  await rememberSent(r.messageId)
  return `enviado${inst ? ` via ${inst}` : ''} (${r.messageId || 'sem id'})`
}
