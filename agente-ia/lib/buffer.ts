import crypto from 'crypto'
import { CONFIG } from './config'
import { sleep } from './ghl'
import { k, redis } from './redis'

/**
 * Buffer de 10s + eleição: rajada de mensagens vira UMA resposta.
 *  - "último webhook vence" (token)
 *  - lock com dono (compare-and-delete): retry nunca duplica
 *  - rate limit 10/min por lead: proteção de custo E de loop de eco
 */

const LOCK_TTL = 240

export interface Claim { proceed: boolean; reason: string; lockOwner?: string }

export async function debounceAndClaim(contactId: string, webhookId: string): Promise<Claim> {
  const rl = await redis.incr(k('rl', contactId))
  if (rl === 1) await redis.expire(k('rl', contactId), 60)
  if (rl > 10) return { proceed: false, reason: 'rate limit (10/min) — possível loop de eco' }

  await redis.set(k('token', contactId), webhookId, { ex: 600 })
  await sleep(CONFIG.debounceSeconds * 1000)
  if ((await redis.get<string>(k('token', contactId))) !== webhookId) return { proceed: false, reason: 'webhook mais novo assumiu' }

  const lockOwner = crypto.randomUUID()
  const locked = await redis.set(k('lock', contactId), lockOwner, { nx: true, ex: LOCK_TTL })
  if (locked !== 'OK') return { proceed: false, reason: 'lock ocupado (o dono re-checa ao final)' }
  return { proceed: true, reason: 'ok', lockOwner }
}

export async function releaseLock(contactId: string, lockOwner?: string): Promise<void> {
  if (!lockOwner) return
  await redis.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, [k('lock', contactId)], [lockOwner])
}

export async function renewLock(contactId: string, lockOwner: string): Promise<void> {
  await redis.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ${LOCK_TTL}) else return 0 end`, [k('lock', contactId)], [lockOwner])
}

export const currentToken = (contactId: string) => redis.get<string>(k('token', contactId))

export async function adoptToken(contactId: string, webhookId: string): Promise<void> {
  await redis.set(k('token', contactId), webhookId, { ex: 600 })
}
