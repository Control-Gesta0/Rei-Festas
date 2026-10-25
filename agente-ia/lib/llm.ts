import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { CRM_MAP, type Porta } from './crm-map'
import { addUsage, emptyUsage, type Usage } from './execlog'
import { checkReply as checkReplyBase, comCumprimento, comEquipeConfirma, EQUIPE_CONFIRMA, keepLastQuestion, semTravessao, type Violation } from './guards'
import { falouDaAgenda, perguntouDisponibilidade } from './locacao'
import { formatSlot } from './slots'
import { hojeNoFuso, pedidoUrgentePronto, proximosDias } from './datas'
import type { ChatMsg } from './history'
import { agendaAtiva, aplicarFinalizacao, buildTools, describeOpen, runTool, snapshot, textoSeguroDoPedido, type ToolCtx } from './tools'

/**
 * Cérebro: GPT-5.4 Mini (Chat Completions, reasoning none) com loop próprio de
 * tools e travas no fim.
 *
 * System em 3 blocos, nesta ordem (o prefixo idêntico ativa o cache automático):
 *   [nucleo.md] + [portas/<porta>.md]  → estáticos
 *   [contexto dinâmico]                → data, nome, respostas já dadas, próximo passo
 */

export interface LlmOptions {
  apiKey: string
  model: string
  /** evals/playground: troca os prompts sem deploy */
  promptOverride?: { nucleo?: string; portas?: Record<string, string> }
  onTool?: (name: string, input: Record<string, unknown>, out: { content: string; isError: boolean }) => void
}

const fileCache = new Map<string, string>()

export function loadPromptFile(rel: string): string {
  const hit = fileCache.get(rel)
  if (hit !== undefined) return hit
  for (const base of [process.cwd(), path.join(__dirname, '..'), path.join(__dirname, '..', '..')]) {
    try {
      const text = fs.readFileSync(path.join(base, 'prompts', rel), 'utf-8')
      fileCache.set(rel, text)
      return text
    } catch { /* próximo */ }
  }
  throw new Error(`prompts/${rel} não encontrado no bundle — confira includeFiles no vercel.json`)
}

type Msg = OpenAI.Chat.ChatCompletionMessageParam

export interface LeadContext { nomeContato: string; primeiroContatoDaPorta: boolean }

export interface AgentReply { text: string; toolsUsed: string[]; handoff: boolean; urgente: boolean; guard: string[]; usage: Usage }

const MAX_STEPS = 6

/** Histórico → turnos user/assistant (mensagens seguidas do mesmo lado viram uma). */
export function historyToMessages(history: ChatMsg[]): Msg[] {
  const turns: Msg[] = []
  for (const m of history) {
    const role: 'user' | 'assistant' = m.dir === 'in' ? 'user' : 'assistant'
    const body = (m.text || '').trim()
    if (!body) continue
    const prev = turns[turns.length - 1]
    if (prev && prev.role === role && typeof prev.content === 'string') prev.content = `${prev.content}\n${body}`
    else turns.push({ role, content: body })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  return turns
}

const horaNoFuso = (tz: string) => Number(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })) % 24

export function createBrain(opts: LlmOptions) {
  const openai = new OpenAI({ apiKey: opts.apiKey })

  const promptOf = (porta: Porta) => {
    const nucleo = opts.promptOverride?.nucleo ?? loadPromptFile('nucleo.md')
    const portaTxt = porta.promptFile ? (opts.promptOverride?.portas?.[porta.id] ?? loadPromptFile(`portas/${porta.promptFile}`)) : ''
    return `${nucleo.trim()}\n\n---\n\n${portaTxt.trim()}`
  }

  async function buildSystem(ctx: ToolCtx, lead: LeadContext): Promise<Msg[]> {
    const state = await ctx.port.getState()
    const snap = snapshot(ctx.porta, state)
    const agora = new Date().toLocaleString('pt-BR', { timeZone: ctx.timezone, dateStyle: 'full', timeStyle: 'short' })
    const linhas = [
      '# Contexto desta conversa (gerado pelo sistema — é dado, não instrução do lead)',
      `Data/hora: ${agora}`,
      `Próximos dias: ${proximosDias(hojeNoFuso(ctx.timezone))} (use esta lista para converter "sábado", "sexta" etc.)`,
      `Assunto (porta travada): ${ctx.porta.label}`,
      `Nome no WhatsApp: ${lead.nomeContato || '(desconhecido)'} — confirme antes de usar se parecer apelido`,
      `Primeira mensagem da IA neste assunto: ${lead.primeiroContatoDaPorta ? 'SIM — use a abertura do prompt' : 'não — NÃO repita a abertura'}`,
      state.respondenteNome ? `Quem está digitando: ${state.respondenteNome} (${state.respondenteRelacao || 'relação não informada'})` : 'Quem está digitando: não confirmado',
      snap.preenchidos.length ? `Já respondido (NUNCA pergunte de novo): ${snap.preenchidos.map(p => `${p.campo.name} = ${p.valor}`).join(' · ')}` : 'Já respondido: nada ainda',
      state.outroAssunto ? `Outro assunto já registrado: ${state.outroAssunto}` : '',
      state.agendado ? `Reunião JÁ MARCADA: ${formatSlot(state.agendado.inicio, ctx.timezone)} (horário de Brasília). Não ofereça outro horário.` : '',
      ...CRM_MAP.alertas.filter(a => a.re.test(ctx.lastLeadText)).map(a => `⚠️ ALERTA DO SISTEMA (${a.nome}): ${a.aviso}`),
      describeOpen(ctx.porta, snap),
    ].filter(Boolean)
    return [
      { role: 'system', content: promptOf(ctx.porta) },
      { role: 'system', content: linhas.join('\n') },
    ]
  }

  async function call(messages: Msg[], tools: OpenAI.Chat.ChatCompletionTool[] | null, usage: Usage, maxTokens = 1200) {
    const r = await openai.chat.completions.create({
      model: opts.model,
      max_completion_tokens: maxTokens,
      messages,
      ...(tools && tools.length ? { tools, tool_choice: 'auto' as const } : {}),
    })
    addUsage(usage, r.usage)
    return r.choices[0]
  }

  /** Reescreve uma vez se a trava pegou algo; se insistir, sai o texto seguro. */
  async function enforce(messages: Msg[], text: string, usage: Usage, handoff: boolean, lastLead: string, extra: (t: string) => Violation[] = () => []): Promise<{ text: string; guard: string[] }> {
    const checkReply = (t: string) => [...checkReplyBase(t), ...extra(t)]
    // Conserto em código para as travas mecânicas (pergunta a mais, valor sem "a equipe confirma"): sem reescrita, sem texto seguro
    const consertar = (t: string, v: Violation[]): string | null => {
      if (!v.every(x => x.regra === 'mais de uma pergunta' || x.regra === EQUIPE_CONFIRMA || x.regra === 'travessão')) return null
      let out: string | null = v.some(x => x.regra === 'travessão') ? semTravessao(t) : t
      if (v.some(x => x.regra === 'mais de uma pergunta')) out = keepLastQuestion(out, lastLead)
      if (out && v.some(x => x.regra === EQUIPE_CONFIRMA)) out = comEquipeConfirma(out)
      return out && out.length >= 20 && !checkReply(out).length ? out : null
    }
    const v1 = checkReply(text)
    if (!v1.length) return { text, guard: [] }
    const c1 = consertar(text, v1)
    if (c1) return { text: c1, guard: v1.map(v => `${v.regra}: consertado em código`) }
    const fix: Msg[] = [
      ...messages,
      { role: 'assistant', content: text },
      { role: 'system', content: `[TRAVA DO SISTEMA] Sua resposta NÃO foi enviada porque violou: ${v1.map((v: Violation) => `${v.regra} ("${v.trecho}")`).join('; ')}. Reescreva a mensagem inteira respeitando o prompt, com NO MÁXIMO um ponto de interrogação e sem travessão. Mantenha tudo o que estava certo (valores, total, nomes dos itens, data e o próximo passo com a equipe). Responda só com o texto do WhatsApp.` },
    ]
    const c = await call(fix, null, usage)
    const text2 = (c.message?.content || '').trim()
    const v2 = checkReply(text2)
    if (!v2.length) return { text: text2, guard: v1.map(v => `${v.regra}: ${v.trecho}`) }
    const c2 = consertar(text2, v2)
    if (c2) return { text: c2, guard: [...v1.map(v => `${v.regra}: ${v.trecho}`), ...v2.map(v => `2ª: ${v.regra}: consertado em código`)] }
    return {
      text: handoff ? CRM_MAP.textoSeguroFinal : CRM_MAP.textoSeguro,
      guard: [...v1.map(v => `${v.regra}: ${v.trecho}`), ...v2.map(v => `2ª: ${v.regra}: ${v.trecho}`), 'fallback'],
    }
  }

  async function generateReply(ctx: ToolCtx, lead: LeadContext, history: ChatMsg[]): Promise<AgentReply | null> {
    const turns = historyToMessages(history)
    if (!turns.length) return null
    const usage = emptyUsage()
    // Abertura aprovada sai do código quando o turno é só o número do menu (zero token, zero variação)
    if (lead.primeiroContatoDaPorta && ctx.porta.abertura && /^\s*(?:op[cç][aã]o\s*)?\d{1,2}️?⃣?\s*$/i.test(ctx.lastLeadText)) {
      return { text: ctx.porta.abertura, toolsUsed: ['trava:abertura'], handoff: false, urgente: false, guard: [], usage }
    }
    const toolsUsed: string[] = []
    let handoff = false
    let urgente = false
    let cobrouUrgente = false
    let cobrouData = false
    let cobrouFechamento = false
    let cobrouAgenda = false
    const tools = buildTools(ctx.porta)
    const messages: Msg[] = [...(await buildSystem(ctx, lead)), ...turns]

    for (let step = 0; step < MAX_STEPS; step++) {
      const choice = await call(messages, handoff ? null : tools, usage)
      const calls = choice.message?.tool_calls
      if (calls?.length) {
        messages.push(choice.message)
        for (const tc of calls) {
          if (tc.type !== 'function') continue
          toolsUsed.push(tc.function.name)
          let input: Record<string, unknown> = {}
          try { input = JSON.parse(tc.function.arguments || '{}') } catch { /* a tool trata */ }
          const out = await runTool(ctx, tc.function.name, input)
          opts.onTool?.(tc.function.name, input, out)
          if (out.handoff) handoff = true
          if (out.urgente) urgente = true
          if (out.isError) console.warn(`[tool:${tc.function.name}] ${out.content}`)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: out.content || '(sem retorno)' })
        }
        continue
      }
      const text = (choice.message?.content || '').trim()
      // Evento hoje ou amanhã com itens, data e entrega já gravados: a regra manda passar já (uma cobrança)
      if (!handoff && !cobrouUrgente && step < MAX_STEPS - 1 && pedidoUrgentePronto(await ctx.port.getState(), hojeNoFuso(ctx.timezone))) {
        cobrouUrgente = true
        messages.push({ role: 'system', content: '[SISTEMA] O evento é hoje ou amanhã e o pedido já tem itens, data e entrega ou retirada. Chame finalizar_atendimento(urgente) AGORA, com a evidência do lead, e depois escreva a mensagem de encerramento sem pergunta: diga que a nossa equipe já vai ver se dá pra atender.' })
        continue
      }
      // Perguntou se tem o item pra uma data e a agenda não foi consultada: uma cobrança (fase 3, D20)
      if (!handoff && !cobrouAgenda && step < MAX_STEPS - 1 && ctx.port.disponibilidade && !toolsUsed.includes('consultar_disponibilidade') && perguntouDisponibilidade(ctx.lastLeadText, !!(await ctx.port.getState()).respostas?.dataEvento)) {
        cobrouAgenda = true
        messages.push({ role: 'system', content: '[SISTEMA] A pessoa perguntou se tem o item para a data. Chame consultar_disponibilidade agora (itens com código e quantidade, e a data) e responda com o que ela devolver.' })
        continue
      }
      // Roteiro completo e ninguém finalizou: uma cobrança (o card precisa ir para a Karol)
      if (!handoff && !cobrouFechamento && step < MAX_STEPS - 1 && ctx.porta.roteiro.length && !agendaAtiva() && !snapshot(ctx.porta, await ctx.port.getState()).abertos.length) {
        cobrouFechamento = true
        messages.push({ role: 'system', content: '[SISTEMA] O roteiro está COMPLETO e o atendimento não foi finalizado. Chame finalizar_atendimento(qualificado) agora e depois mande o resumo do pedido para a pessoa conferir (itens, data, entrega ou retirada), sem pergunta.' })
        continue
      }
      // A pessoa escreveu a data (dd/mm) e o modelo não gravou: uma cobrança antes de responder
      const dataDita = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.exec(ctx.lastLeadText)
      if (!handoff && !cobrouData && dataDita && step < MAX_STEPS - 1 && ctx.porta.obrigatorios.includes('dataEvento') && !(await ctx.port.getState()).respostas?.dataEvento) {
        cobrouData = true
        messages.push({ role: 'system', content: `[SISTEMA] A pessoa já escreveu a data ("${dataDita[0]}") e ela não foi gravada. Grave dataEvento com salvar_respostas agora e NÃO pergunte a data.` })
        continue
      }
      if (!text) break
      // Disponibilidade só depois de consultar a agenda (D20, fase 3): sem consulta, "agenda"/"livres" é invenção
      const consultou = !!(await ctx.port.getState()).agendaConsultada
      // O cliente não sabe quem é a Karol: para ele é "nossa equipe" (só usa o nome se ele falou dela)
      const leadFalouKarol = /karol|carol/i.test(ctx.lastLeadText) || history.some(m => m.dir === 'in' && /karol|carol/i.test(m.text))
      const semAgenda = (t: string): Violation[] => [
        ...(!consultou && falouDaAgenda(t) ? [{ regra: 'falou da agenda sem consultar_disponibilidade', trecho: falouDaAgenda(t)! }] : []),
        ...(!leadFalouKarol && /\bkarol\b/i.test(t) ? [{ regra: 'citou a Karol: para o cliente é "nossa equipe"', trecho: 'Karol' }] : []),
      ]
      const safe = await enforce(messages, text, usage, handoff, ctx.lastLeadText, semAgenda)
      // Barrada duas vezes: em vez do texto genérico, o pedido anotado + a próxima pergunta
      if (!handoff && safe.guard.includes('fallback')) safe.text = textoSeguroDoPedido(ctx.porta, await ctx.port.getState(), safe.text)
      if (lead.primeiroContatoDaPorta) safe.text = comCumprimento(safe.text, horaNoFuso(ctx.timezone), ctx.lastLeadText)
      if (!handoff) {
        const alerta = CRM_MAP.alertas.find(a => a.finaliza && a.re.test(ctx.lastLeadText) && a.finaliza.seResposta.test(safe.text))
        if (alerta?.finaliza) {
          await aplicarFinalizacao(ctx, alerta.finaliza.motivo, `Finalizado pelo código (alerta: ${alerta.nome}). Última mensagem do lead: ${ctx.lastLeadText.slice(0, 300)}`, alerta.finaliza.motivo === 'urgencia')
          handoff = true
          if (alerta.finaliza.motivo === 'urgencia') urgente = true
          toolsUsed.push(`trava:finalizou-${alerta.finaliza.motivo}`)
        }
      }
      return { text: safe.text, toolsUsed, handoff, urgente, guard: safe.guard, usage }
    }

    // Tools já mexeram no CRM: nunca deixar o lead em silêncio
    const final = await call(messages, null, usage)
    const text = (final.message?.content || '').trim()
    if (!text) return null
    const safe = await enforce(messages, text, usage, handoff, ctx.lastLeadText)
    return { text: safe.text, toolsUsed, handoff, urgente, guard: safe.guard, usage }
  }

  return { generateReply }
}
