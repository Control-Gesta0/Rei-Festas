import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { montarAgenda } from '../lib/agenda'
import { CONFIG } from '../lib/config'
import { CRM_MAP } from '../lib/crm-map'
import { readExecs } from '../lib/execlog'
import { customValue, listOpportunities, listPipelines } from '../lib/ghl'
import { renderLogin, renderPainel, resumirFunil, resumirIA, type DadosPainel } from '../lib/painel'

/**
 * PAINEL DE GESTÃO: GET /api/painel (?dias=7|30|90, ?formato=json).
 * Senha própria (PAINEL_SENHA), separada do WEBHOOK_SECRET: quem vê o painel
 * não ganha acesso aos webhooks. Login por formulário, cookie HttpOnly de 30 dias.
 * Cada fonte (IA, GHL, VHSYS) é lida à parte: uma fora do ar não derruba as outras.
 */
const COOKIE = 'painel_rey'

const fichaDe = (senha: string) => crypto.createHmac('sha256', CONFIG.webhookSecret).update(`painel:${senha}`).digest('hex')
function cookieOk(req: VercelRequest, senha: string): boolean {
  const c = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || ''
  const esperado = fichaDe(senha)
  return c.length === esperado.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(esperado))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const senha = process.env.PAINEL_SENHA || ''
  res.setHeader('Cache-Control', 'no-store')
  if (!senha) return res.status(503).send('Painel desligado: cadastre PAINEL_SENHA na Vercel e faça o redeploy.')

  if (req.method === 'POST') {
    const enviada = String((req.body as Record<string, unknown> | undefined)?.senha || '')
    const ok = enviada.length === senha.length && crypto.timingSafeEqual(Buffer.from(enviada), Buffer.from(senha))
    if (!ok) return res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderLogin(true))
    res.setHeader('Set-Cookie', `${COOKIE}=${fichaDe(senha)}; Path=/api/painel; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`)
    return res.redirect(303, '/api/painel')
  }
  if (!cookieOk(req, senha)) return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderLogin())

  const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 7
  const dados = await coletar(dias)
  if (req.query.formato === 'json') return res.status(200).json(dados)
  return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderPainel(dados))
}

async function coletar(dias: number): Promise<DadosPainel> {
  const agora = Date.now()
  const erro = (e: unknown) => ({ erro: e instanceof Error ? e.message.slice(0, 200) : String(e) })
  const hoje = new Date(agora).toLocaleDateString('en-CA', { timeZone: CONFIG.timezone })
  const em7 = new Date(agora + 6 * 86400000).toLocaleDateString('en-CA', { timeZone: CONFIG.timezone })

  const [ia, funil, locacao] = await Promise.all([
    readExecs(2000).then(execs => resumirIA(execs, agora, dias)).catch(erro),
    (async () => {
      const pipelineId = CRM_MAP.oportunidade.pipelineId
      const [opps, pipes] = await Promise.all([listOpportunities(pipelineId), listPipelines()])
      const etapas = (pipes.find(p => p.id === pipelineId)?.stages || [])
        .slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(s => ({ id: s.id, nome: s.name }))
      const campoMotivo = CRM_MAP.campos.motivoPerda?.id
      return resumirFunil(opps.map(o => ({ ...o, motivoPerda: campoMotivo ? String(customValue(o.customFields, campoMotivo) ?? '') || undefined : undefined })), etapas, agora, dias)
    })().catch(erro),
    (async () => {
      if (!CONFIG.vhsysAccessToken) return { erro: 'tokens do VHSYS não cadastrados' }
      const ag = await montarAgenda(hoje, em7)
      return {
        hoje: ag.hoje,
        devolucoesPendentes: ag.devolucoesPendentes,
        proximos: ag.pedidos,
        maisReservados: ag.itens.slice().sort((a, b) => b.reservado - a.reservado).slice(0, 10).map(i => ({ nome: i.nome, reservado: i.reservado, livre: i.livre, total: i.total })),
        semPeriodo: ag.semPeriodo,
      }
    })().catch(erro),
  ])
  return { geradoEm: new Date(agora).toISOString(), dias, ia, funil, locacao }
}
