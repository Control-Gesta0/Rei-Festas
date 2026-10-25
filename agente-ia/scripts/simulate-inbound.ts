/**
 * Dispara o /api/inbound no deploy como se fosse o workflow do GHL.
 *   npx tsx scripts/simulate-inbound.ts <CONTACT_ID>
 * O contato PRECISA ter a GATE_TAG e uma mensagem inbound recente no GHL:
 * o agente lê a conversa da API (o texto não vem do webhook). A resposta REAL
 * sai para o WhatsApp do contato.
 */
import { loadEnv } from './env'

loadEnv()
const [contactId] = process.argv.slice(2)
const url = (process.env.DEPLOY_URL || '').replace(/\/+$/, '')
if (!contactId || !url) { console.error('uso: tsx scripts/simulate-inbound.ts <CONTACT_ID>  (DEPLOY_URL no .env.local)'); process.exit(1) }

fetch(`${url}/api/inbound?secret=${encodeURIComponent(process.env.WEBHOOK_SECRET || '')}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ contact_id: contactId, location: { id: process.env.GHL_LOCATION_ID } }),
}).then(async r => console.log(r.status, await r.text()))
