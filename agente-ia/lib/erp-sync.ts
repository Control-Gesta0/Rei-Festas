import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'
import { documento, lerItens, obsOrcamento, payloadCliente, resumoNota, totalItens, type DadosPedido, type ItemPedido } from './erp'
import { logExec } from './execlog'
import {
  addContactNote, addContactTags, contactName, customValue, findOpportunity, getContact, getOpportunity,
  listCustomFields, removeContactTags, updateContactFields, updateOpportunity,
} from './ghl'
import { k, redis } from './redis'
import {
  adicionarProdutoOrcamento, buscarClientePorDocumento, buscarProdutoPorCodigo, criarCliente, criarOrcamento,
  orcamentosDoCliente, produtosDoOrcamento, type VhsysOrcamento,
} from './vhsys'

/** Campos do GHL que guardam o vínculo com o VHSYS (casados pelo NOME; criados por scripts/ghl_estrutura.py). */
const CAMPO_ORCAMENTO = 'Nº do pedido no ERP'
const CAMPO_CLIENTE = 'ID no ERP'
const TAG_OK = 'erp-sincronizado'
const TAG_ERRO = 'erp-erro'

export interface ResultadoErp {
  ok: boolean
  ensaio: boolean
  jaSincronizado?: string
  contactId: string
  opportunityId?: string
  cliente?: { id?: string; novo: boolean; payload?: Record<string, unknown> }
  orcamento?: { id?: string; numero?: string; total: number; payload: Record<string, unknown>; produtos: Record<string, unknown>[] }
  avisos: string[]
  erro?: string
}

const texto = (v: unknown) => (v == null ? '' : String(v)).trim()
const hojeBR = () => new Date().toLocaleDateString('pt-BR', { timeZone: CONFIG.timezone })
const hojeIso = () => new Date().toLocaleDateString('en-CA', { timeZone: CONFIG.timezone })

async function idCampo(model: 'contact' | 'opportunity', nome: string): Promise<string | null> {
  const f = (await listCustomFields(model)).find(x => x.name.trim().toLowerCase() === nome.toLowerCase())
  return f?.id || null
}

export async function sincronizarPedido(contactId: string, opportunityId: string | undefined, gravar = CONFIG.erpGravar): Promise<ResultadoErp> {
  const r: ResultadoErp = { ok: false, ensaio: !gravar, contactId, avisos: [] }
  let travou = false
  const lockKey = k('erp', opportunityId || contactId)
  try {
    const contato = await getContact(contactId)
    const opp = opportunityId ? await getOpportunity(opportunityId) : await findOpportunity(contactId, CRM_MAP.oportunidade.pipelineId, [CRM_MAP.oportunidade.etapaPedidoFechadoId])
    if (!opp) throw new Error('nenhuma oportunidade aberta do contato em "Pedido fechado"')
    r.opportunityId = opp.id

    const [campoOrc, campoCli] = await Promise.all([idCampo('opportunity', CAMPO_ORCAMENTO), idCampo('contact', CAMPO_CLIENTE)])
    if (!campoOrc) r.avisos.push(`campo "${CAMPO_ORCAMENTO}" não existe no GHL: o nº do orçamento vai só na nota`)
    if (!campoCli) r.avisos.push(`campo "${CAMPO_CLIENTE}" não existe no GHL: o id do cliente vai só na nota`)

    // Idempotência: card que já tem orçamento não gera outro (retry do webhook, card movido duas vezes)
    const jaTem = campoOrc ? texto(customValue(opp.customFields, campoOrc)) : ''
    if (jaTem) { r.ok = true; r.jaSincronizado = jaTem; return r }
    if (gravar) {
      travou = (await redis.set(lockKey, '1', { nx: true, ex: 300 })) === 'OK'
      if (!travou) { r.ok = true; r.avisos.push('outra sincronização deste pedido está em andamento'); return r }
    }

    const C = CRM_MAP.campos
    const daOpp = (key: string) => customValue(opp.customFields, C[key].id)
    const doContato = (key: string) => customValue(contato.customFields, C[key].id)
    const d: DadosPedido = {
      nome: contactName(contato),
      documento: texto(doContato('cpfCnpj')),
      rg: texto(doContato('rg')),
      email: texto(contato.email),
      telefone: texto(contato.phone),
      endereco: texto(contato.address1),
      cidade: texto(contato.city),
      itensTexto: texto(daOpp('itens')),
      dataEvento: daOpp('dataEvento'),
      entregaRetirada: texto(daOpp('entregaRetirada')),
      enderecoEvento: texto(daOpp('enderecoEvento')),
      contatoLocal: texto(daOpp('contatoLocal')),
      tipoEvento: texto(daOpp('tipoEvento')),
      convidados: daOpp('convidados'),
      formaPagamento: texto(daOpp('formaPagamento')),
      opportunityId: opp.id,
    }

    const doc = documento(d.documento)
    if (!doc) throw new Error(`CPF/CNPJ ausente ou inválido no contato ("${d.documento}")`)
    if (!d.nome) throw new Error('contato sem nome')
    const { itens, semCodigo } = lerItens(d.itensTexto, CRM_MAP.catalogo?.itens || [])
    if (!itens.length) {
      throw new Error(d.itensTexto
        ? `nenhum item com código do catálogo no campo "Itens solicitados" (o campo tem: "${d.itensTexto.slice(0, 160)}")`
        : `o campo "Itens solicitados" está vazio na oportunidade ${opp.id} (${(opp.customFields || []).length} campos lidos)`)
    }

    // Produtos no VHSYS (cod_produto = código do catálogo)
    const produtos: Record<string, unknown>[] = []
    const faltando: string[] = []
    for (const it of itens) {
      const cache = k('vhsys-produto', it.codigo)
      let idProduto = await redis.get<string>(cache)
      if (!idProduto) {
        const p = await buscarProdutoPorCodigo(it.codigo)
        if (p) { idProduto = String(p.id_produto); await redis.set(cache, idProduto, { ex: 7 * 86400 }) }
      }
      if (!idProduto) { faltando.push(`${it.codigo} · ${it.quantidade} × ${it.descricao}`); continue }
      produtos.push(payloadProduto(idProduto, it))
    }
    if (faltando.length) r.avisos.push(`produtos não encontrados no VHSYS (vão na observação): ${faltando.join('; ')}`)
    if (!produtos.length) throw new Error('nenhum item do pedido foi encontrado no cadastro de produtos do VHSYS')

    // Cliente
    const existente = await buscarClientePorDocumento(doc.formatado)
    r.cliente = existente
      ? { id: String(existente.id_cliente), novo: false }
      : { novo: true, payload: payloadCliente(d, doc, hojeBR()) }

    const usados = itens.filter(i => !faltando.some(f => f.startsWith(`${i.codigo} `)))
    const orcPayload: Record<string, unknown> = {
      nome_cliente: d.nome,
      data_pedido: hojeIso(),
      // SEM valor_total_*: o VHSYS soma sozinho cada produto adicionado. Mandar o total na
      // criação dobrou o orçamento no teste real (R$ 350 num pedido de R$ 175, 25/10/2026)
      obs_pedido: obsOrcamento(d, [...semCodigo, ...faltando]),
      obs_interno_pedido: `Origem: CRM (GHL), oportunidade ${opp.id}`,
    }
    r.orcamento = { total: totalItens(usados), payload: orcPayload, produtos }

    if (!gravar) {
      if (r.cliente.id) {
        try {
          const lista = await orcamentosDoCliente(r.cliente.id)
          const desta = lista.find(o => o.obsInterna.includes(opp.id))
          r.avisos.push(desta
            ? `já existe o orçamento nº ${desta.numero} desta oportunidade: a gravação vai completá-lo, não criar outro`
            : `o cliente tem ${lista.length} orçamento(s) no VHSYS, nenhum marcado com esta oportunidade: a gravação cria um novo`)
        } catch (e) {
          r.avisos.push(`não consegui listar os orçamentos do cliente: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      r.ok = true
      return r
    }

    // ---------- Gravação ----------
    if (!r.cliente.id) r.cliente.id = String((await criarCliente(r.cliente.payload!)).id_cliente)
    orcPayload.id_cliente = r.cliente.id
    const orc = await garantirOrcamento(r.cliente.id, opp.id, orcPayload)
    r.orcamento.id = orc.id
    r.orcamento.numero = orc.numero
    // Retentativa completa o que faltou: produto que já está no orçamento não entra de novo
    const jaNoOrcamento = new Set(await produtosDoOrcamento(orc.id))
    for (const p of produtos) if (!jaNoOrcamento.has(String(p.id_produto))) await adicionarProdutoOrcamento(orc.id, p)

    if (campoOrc) await updateOpportunity(opp.id, { customFields: [{ id: campoOrc, value: orc.numero }], status: 'won' })
    else await updateOpportunity(opp.id, { status: 'won' })
    if (campoCli) await updateContactFields(contactId, [{ id: campoCli, value: r.cliente.id }])
    await addContactNote(contactId, resumoNota({ clienteId: r.cliente.id, clienteNovo: r.cliente.novo, orcamento: orc.numero, itens: usados, semCodigo: [...semCodigo, ...faltando] }))
    await addContactTags(contactId, [TAG_OK])
    try { await removeContactTags(contactId, [TAG_ERRO]) } catch { /* não tinha */ }
    r.ok = true
    await logExec({ tipo: 'erp', leadId: contactId, nome: d.nome, detalhe: `orçamento ${orc.numero} · cliente ${r.cliente.id}${r.cliente.novo ? ' (novo)' : ''}` })
    return r
  } catch (e) {
    r.erro = e instanceof Error ? e.message : String(e)
    if (gravar) {
      // A Karol vê no contato: tag + nota com o motivo. O card fica em "Pedido fechado"; mover de novo tenta outra vez.
      try {
        await addContactTags(contactId, [TAG_ERRO])
        await addContactNote(contactId, `[ERP] Pedido NÃO foi enviado ao VHSYS: ${r.erro}\nCorrija no GHL e mova o card para "Pedido fechado" de novo, ou lance à mão no VHSYS.`)
      } catch { /* o erro principal é o que importa */ }
      await logExec({ tipo: 'erp', leadId: contactId, detalhe: `ERRO: ${r.erro}` })
    }
    return r
  } finally {
    if (travou) await redis.del(lockKey)
  }
}

/**
 * O orçamento desta oportunidade, criando só se ainda não existir. Três chaves contra duplicar:
 * o id guardado no Redis, a marca da oportunidade na observação interna e, se o VHSYS responder
 * erro ao criar (ele cria mesmo assim; visto em 25/10/2026), o orçamento que surgiu na lista do cliente.
 */
/** Esperas antes de cada nova leitura da lista (ms). Exportado para o teste trocar por zeros. */
export const ESPERAS_ORCAMENTO_MS = [0, 2000, 4000, 8000, 15000]

async function garantirOrcamento(idCliente: string, oppId: string, payload: Record<string, unknown>): Promise<VhsysOrcamento> {
  const chave = k('erp-orc', oppId)
  const antes = await orcamentosDoCliente(idCliente)
  const salvo = await redis.get<string>(chave)
  const conhecido = antes.find(o => o.id === String(salvo ?? '')) || antes.find(o => o.obsInterna.includes(oppId))
  if (conhecido) return conhecido
  let orc: VhsysOrcamento
  try {
    orc = await criarOrcamento(payload)
  } catch (e) {
    // O orçamento pode demorar a aparecer na lista (2º teste real, 25/10/2026: erro e nada na lista na hora).
    // Procura algumas vezes pela marca da oportunidade; sem marca, aceita um único orçamento novo.
    const idsAntes = new Set(antes.map(o => o.id))
    let achado: VhsysOrcamento | undefined
    for (const espera of ESPERAS_ORCAMENTO_MS) {
      if (espera) await new Promise(res => setTimeout(res, espera))
      const novos = (await orcamentosDoCliente(idCliente)).filter(o => !idsAntes.has(o.id))
      achado = novos.find(o => o.obsInterna.includes(oppId)) || (novos.length === 1 ? novos[0] : undefined)
      if (achado) break
    }
    if (!achado) throw e
    orc = achado
  }
  await redis.set(chave, orc.id, { ex: 180 * 86400 })
  return orc
}

function payloadProduto(idProduto: string, it: ItemPedido): Record<string, unknown> {
  const unit = it.valorUnit ?? 0
  return {
    id_produto: idProduto,
    desc_produto: it.descricao,
    qtde_produto: it.quantidade,
    valor_unit_produto: unit.toFixed(2),
    valor_total_produto: (unit * it.quantidade).toFixed(2),
  }
}
