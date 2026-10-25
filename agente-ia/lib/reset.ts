import { CONFIG } from './config'
import { addContactTags } from './ghl'
import { k, redis } from './redis'

/**
 * Comando "reset" — SÓ para contatos em TEST_CONTACT_IDS (lead real que digitar
 * "reset" não apaga nada). A conversa no GHL NÃO é apagada (apagar a conversa
 * engasga o "Customer Replied" — ghl §A.6): gravamos um CORTE e o histórico
 * passa a começar dali. Zera estado e devolve a tag de gate.
 */

export const isResetCommand = (contactId: string, text: string) =>
  CONFIG.testContactIds.includes(contactId) && /^\s*reset\s*$/i.test(text)

export async function resetContact(contactId: string): Promise<void> {
  await redis.del(k('state', contactId), k('done', contactId), k('token', contactId), k('lock', contactId), k('rl', contactId), k('slots', contactId))
  await redis.set(k('corte', contactId), String(Date.now() + 1000), { ex: 90 * 86400 })
  if (CONFIG.gateTag) await addContactTags(contactId, [CONFIG.gateTag])
}
