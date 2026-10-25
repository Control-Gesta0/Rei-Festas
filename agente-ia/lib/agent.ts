import { adoptToken, currentToken, debounceAndClaim, releaseLock, renewLock } from './buffer'
import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'
import { logExec } from './execlog'
import { contactName, contactTags, getContact } from './ghl'
import { alreadyAnswered, getHydratedHistory, humanSpokeRecently, lastInbound, markAnswered, type ChatMsg } from './history'
import { createBrain } from './llm'
import { ghlPort } from './port'
import { isResetCommand, resetContact } from './reset'
import { rotear } from './router'
import { clearState, getState, patchState } from './state'
import { aplicarFinalizacao, podeMover, type ToolCtx } from './tools'
import { sendReply } from './transport'

/**
 * Núcleo: gate → buffer → histórico do GHL → roteador (código) → cérebro
 * (LLM) → travas → envio.
 */

const MAX_ROUNDS = 3

const brain = createBrain({ apiKey: CONFIG.openaiApiKey, model: CONFIG.llmModel })

/** Bloco atual do lead: inbounds depois da última outbound. */
function blocoAtual(history: ChatMsg[]): ChatMsg[] {
  const i = history.map(m => m.dir).lastIndexOf('out')
  return history.slice(i + 1).filter(m => m.dir === 'in')
}

export async function processContact(contactId: string, webhookId: string): Promise<void> {
  const t0 = Date.now()
  let lockOwner: string | undefined
  let nome = ''
  const pular = async (motivo: string, registrar = true) => {
    console.log(`[agente] PULOU ${contactId} (${nome}): ${motivo}`)
    if (registrar) await logExec({ tipo: 'pulou', leadId: contactId, nome, detalhe: motivo })
  }
  try {
    const contato = await getContact(contactId)
    nome = contactName(contato)
    const tags = contactTags(contato).map(t => t.toLowerCase())
    if (tags.includes(CONFIG.humanTag)) return pular(`tag "${CONFIG.humanTag}"`, false)
    // Gate em código também (o workflow já filtra, mas fail-closed se alguém mexer nele)
    if (CONFIG.gateTag && !tags.includes(CONFIG.gateTag)) return pular(`sem a tag "${CONFIG.gateTag}"`, false)

    // Tag de gate de volta num lead já finalizado = novo ciclo
    const st0 = await getState(contactId)
    if (st0.finalizado) {
      await clearState(contactId)
      console.log(`[agente] ${contactId} voltou com a tag de gate — novo ciclo`)
    }

    const claim = await debounceAndClaim(contactId, webhookId)
    if (!claim.proceed) { console.log(`[debounce] ${contactId}: ${claim.reason}`); return }
    lockOwner = claim.lockOwner
    let myToken = webhookId

    for (let round = 0; round < MAX_ROUNDS; round++) {
      await renewLock(contactId, lockOwner!)
      const conv = await getHydratedHistory(contactId)
      const history = conv.msgs
      const target = lastInbound(history)
      if (!target) return pular('nenhuma mensagem do lead no histórico do GHL')
      if (await alreadyAnswered(contactId, target.id)) return
      const bloco = blocoAtual(history)
      const textoTurno = bloco.map(m => m.text).join('\n')

      // Reset de teste (só contatos em TEST_CONTACT_IDS). Vale a ÚLTIMA mensagem: com a IA
      // travada (humano recente), o bloco junta tudo o que ficou sem resposta
      if (isResetCommand(contactId, target.text.trim())) {
        await resetContact(contactId)
        await sendReply(contactId, 'Teste reiniciado. Mande a primeira mensagem como se fosse um lead novo.', conv.instancia)
        await markAnswered(contactId, target.id)
        await logExec({ tipo: 'reset', leadId: contactId, nome, detalhe: 'reset de teste' })
        return
      }

      if (await humanSpokeRecently(conv.raw, Date.now(), conv.corteMs)) return pular('um humano respondeu pelo GHL nas últimas 6h — a IA não atropela')

      const state = await getState(contactId)

      // 1. Roteador em código
      const rota = rotear(state, textoTurno)
      if (rota.tipo === 'mensagem') {
        await patchState(contactId, rota.patch)
        const detail = await sendReply(contactId, rota.texto, conv.instancia)
        await markAnswered(contactId, target.id)
        await logExec({ tipo: 'menu', leadId: contactId, nome, ms: Date.now() - t0, detalhe: `${detail} · ${rota.texto.slice(0, 60)}` })
        return
      }
      const porta = rota.porta
      if (rota.travou) {
        await patchState(contactId, { porta: porta.id, portaEm: bloco[0]?.ts ?? target.ts, aguardandoResumo: false })
        console.log(`[roteador] ${contactId} → porta ${porta.id}`)
      }
      const portaEm = (await getState(contactId)).portaEm ?? 0
      // Com menu desligado a porta trava no 1º contato: o contexto é a conversa inteira desde o corte
      const conversa = CRM_MAP.menu.ativo ? history.filter(m => m.ts >= portaEm) : history

      const port = ghlPort(contactId)
      const iLast = conversa.map(m => m.dir).lastIndexOf('in')
      const ctx: ToolCtx = {
        port, porta, gateTag: CONFIG.gateTag, timezone: CONFIG.timezone,
        leadText: conversa.filter(m => m.dir === 'in').map(m => m.text).join('\n'),
        lastLeadText: textoTurno,
        lastAgentText: [...conversa.slice(0, Math.max(iLast, 0))].reverse().find(m => m.dir === 'out')?.text || '',
      }

      // 2. Porta sem agente: mensagem fixa e finaliza (sem LLM)
      if (!porta.ativa) {
        const texto = porta.mensagemSemAgente || 'O nosso time vai continuar seu atendimento por aqui.'
        await aplicarFinalizacao(ctx, 'porta_sem_agente', `Assunto: ${porta.label}. Primeira mensagem: ${textoTurno.slice(0, 300)}`)
        const detail = await sendReply(contactId, texto, conv.instancia)
        await markAnswered(contactId, target.id)
        await logExec({ tipo: 'finalizou', leadId: contactId, nome, porta: porta.id, ms: Date.now() - t0, detalhe: `porta sem agente · ${detail}` })
        return
      }

      // 3. Cérebro
      const primeiroContatoDaPorta = !conversa.some(m => m.dir === 'out')
      const reply = await brain.generateReply(ctx, { nomeContato: nome, primeiroContatoDaPorta }, conversa)
      if (!reply?.text) {
        await logExec({ tipo: 'erro', leadId: contactId, nome, porta: porta.id, detalhe: 'modelo não gerou resposta' })
        return
      }

      // Chegou mensagem nova durante a geração? Reprocessa com o contexto novo
      // (exceto se a IA já finalizou: a tag saiu, a despedida precisa sair)
      const tok = await currentToken(contactId)
      if (tok && tok !== myToken && !reply.handoff) {
        myToken = tok
        await adoptToken(contactId, myToken)
        continue
      }

      const detail = await sendReply(contactId, reply.text, conv.instancia)
      await markAnswered(contactId, target.id)
      // 1ª resposta da IA: a oportunidade nasce/anda para "Em Contato" (código, fail-closed, nunca derruba a resposta)
      if (primeiroContatoDaPorta && CRM_MAP.etapaEmContatoId && !reply.handoff) {
        try {
          if (!podeMover(await port.getLead(), CRM_MAP.etapaEmContatoId)) await port.moveStage(CRM_MAP.etapaEmContatoId)
        } catch (e) { console.warn(`[agente] ${contactId}: não moveu para Em Contato:`, e) }
      }
      await logExec({
        tipo: reply.handoff ? 'finalizou' : 'resposta', leadId: contactId, nome, porta: porta.id, ms: Date.now() - t0,
        tools: reply.toolsUsed, guard: reply.guard, usage: reply.usage, urgente: reply.urgente || undefined, detalhe: detail,
      })
      console.log(`[agente] RESPONDEU ${contactId} (${porta.id}) em ${Date.now() - t0}ms · tools: ${reply.toolsUsed.join(', ') || '—'}${reply.guard.length ? ` · trava: ${reply.guard.join(' | ')}` : ''}`)
      return
    }
    await pular('MAX_ROUNDS: lead mandando rápido demais — o próximo webhook responde')
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    console.error(`[agente] ERRO ${contactId} após ${Date.now() - t0}ms: ${msg}`, e)
    await logExec({ tipo: 'erro', leadId: contactId, nome, ms: Date.now() - t0, detalhe: msg })
  } finally {
    await releaseLock(contactId, lockOwner)
  }
}
