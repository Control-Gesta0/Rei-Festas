/**
 * PAINEL DE GESTÃO da Rey Festas: atendimento da IA (diário no Redis), funil do
 * CRM (GHL) e locação (agenda de reservas do VHSYS) numa tela. Aqui só agregação
 * e HTML, funções puras (testadas em scripts/test-cliente.ts); quem busca os
 * dados é api/painel.ts.
 */
import type { ExecEntry } from './execlog'
import { reais } from './catalogo'

const DIA = 86400000

export const MOTIVOS: Record<string, string> = {
  qualificado: 'Pronto para orçamento',
  urgente: 'Urgente (hoje/amanhã)',
  ja_e_cliente: 'Pós-venda',
  outro_servico: 'Buffet / consultor',
  pediu_humano: 'Pediu a Karol',
  fora_do_escopo: 'Fora do escopo',
  desistiu: 'Desistiu',
  nao_qualificado: 'Sem perfil',
}

export interface ResumoIA {
  dias: number
  contatos: number
  mensagens: number
  encaminhados: number
  finalizacoes: Array<{ motivo: string; rotulo: string; qtd: number }>
  porDia: Array<{ data: string; mensagens: number; contatos: number }>
  custoUsd: number
  erros: number
  ultimosErros: Array<{ at: string; nome: string; detalhe: string }>
  erp: { ok: number; erro: number; ultimosErros: Array<{ at: string; detalhe: string }> }
}

const diaLocal = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

export function resumirIA(execs: ExecEntry[], agoraMs: number, dias: number): ResumoIA {
  const desde = agoraMs - dias * DIA
  const noPeriodo = execs.filter(e => Date.parse(e.at) >= desde)
  const atend = noPeriodo.filter(e => e.tipo === 'resposta' || e.tipo === 'finalizou' || e.tipo === 'menu')
  const fin = noPeriodo.filter(e => e.tipo === 'finalizou')
  const porMotivo = new Map<string, number>()
  for (const f of fin) { const m = f.motivo || 'sem_motivo'; porMotivo.set(m, (porMotivo.get(m) || 0) + 1) }
  const dias7: ResumoIA['porDia'] = []
  for (let i = dias - 1; i >= 0; i--) {
    const data = diaLocal(new Date(agoraMs - i * DIA).toISOString())
    const doDia = atend.filter(e => diaLocal(e.at) === data)
    dias7.push({ data, mensagens: doDia.length, contatos: new Set(doDia.map(e => e.leadId)).size })
  }
  const erros = noPeriodo.filter(e => e.tipo === 'erro')
  const erp = noPeriodo.filter(e => e.tipo === 'erp')
  const erpErros = erp.filter(e => /^ERRO/.test(e.detalhe || ''))
  return {
    dias,
    contatos: new Set(atend.map(e => e.leadId)).size,
    mensagens: atend.length,
    encaminhados: fin.filter(f => f.motivo === 'qualificado' || f.motivo === 'urgente').length,
    finalizacoes: [...porMotivo].map(([motivo, qtd]) => ({ motivo, rotulo: MOTIVOS[motivo] || motivo, qtd })).sort((a, b) => b.qtd - a.qtd),
    porDia: dias <= 31 ? dias7 : dias7.slice(-31),
    custoUsd: Math.round(noPeriodo.reduce((s, e) => s + (e.custoUsd || 0), 0) * 100) / 100,
    erros: erros.length,
    ultimosErros: erros.slice(0, 5).map(e => ({ at: e.at, nome: e.nome || e.leadId, detalhe: (e.detalhe || '').slice(0, 160) })),
    erp: { ok: erp.length - erpErros.length, erro: erpErros.length, ultimosErros: erpErros.slice(0, 5).map(e => ({ at: e.at, detalhe: (e.detalhe || '').slice(0, 160) })) },
  }
}

export interface OppPainel { status?: string; pipelineStageId: string; monetaryValue?: number; createdAt?: string; updatedAt?: string; lastStatusChangeAt?: string; motivoPerda?: string }

export interface ResumoFunil {
  etapas: Array<{ nome: string; qtd: number; valor: number }>
  abertos: { qtd: number; valor: number }
  novos: number
  ganhos: { qtd: number; valor: number }
  perdidos: { qtd: number; porMotivo: Array<{ motivo: string; qtd: number }> }
  conversao: number | null
}

export function resumirFunil(opps: OppPainel[], etapas: Array<{ id: string; nome: string }>, agoraMs: number, dias: number): ResumoFunil {
  const desde = agoraMs - dias * DIA
  const quando = (o: OppPainel) => Date.parse(o.lastStatusChangeAt || o.updatedAt || o.createdAt || '') || 0
  const abertos = opps.filter(o => (o.status || 'open') === 'open')
  const ganhos = opps.filter(o => o.status === 'won' && quando(o) >= desde)
  const perdidos = opps.filter(o => o.status === 'lost' && quando(o) >= desde)
  const motivos = new Map<string, number>()
  for (const p of perdidos) { const m = p.motivoPerda || 'Sem motivo'; motivos.set(m, (motivos.get(m) || 0) + 1) }
  const soma = (l: OppPainel[]) => Math.round(l.reduce((s, o) => s + (Number(o.monetaryValue) || 0), 0) * 100) / 100
  return {
    etapas: etapas.map(e => { const l = abertos.filter(o => o.pipelineStageId === e.id); return { nome: e.nome, qtd: l.length, valor: soma(l) } }),
    abertos: { qtd: abertos.length, valor: soma(abertos) },
    novos: opps.filter(o => (Date.parse(o.createdAt || '') || 0) >= desde).length,
    ganhos: { qtd: ganhos.length, valor: soma(ganhos) },
    perdidos: { qtd: perdidos.length, porMotivo: [...motivos].map(([motivo, qtd]) => ({ motivo, qtd })).sort((a, b) => b.qtd - a.qtd) },
    conversao: ganhos.length + perdidos.length ? Math.round((ganhos.length / (ganhos.length + perdidos.length)) * 100) : null,
  }
}

export interface LocacaoPainel {
  hoje: { data: string; saem: string[]; voltam: string[] }
  devolucoesPendentes: Array<{ pedido: string; cliente: string; devolucao: string; diasAtraso: number }>
  proximos: Array<{ pedido: string; cliente: string; inicio: string; fim: string; itens: number; pecas: number }>
  maisReservados: Array<{ nome: string; reservado: number; livre: number | null; total: number | null }>
  semPeriodo: string[]
}

export interface DadosPainel {
  geradoEm: string
  dias: number
  ia: ResumoIA | { erro: string }
  funil: ResumoFunil | { erro: string }
  locacao: LocacaoPainel | { erro: string }
}

// ---------- HTML ----------

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const br = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}` }
const temErro = (x: object): x is { erro: string } => 'erro' in x

function barras(linhas: Array<{ rotulo: string; valor: number; extra?: string }>): string {
  const max = Math.max(1, ...linhas.map(l => l.valor))
  if (!linhas.length) return '<p class="vazio">Nada no período.</p>'
  return `<div class="barras">${linhas.map(l => `<div class="barra"><span class="rot">${esc(l.rotulo)}</span><span class="trilho"><span class="enche" style="width:${Math.round((l.valor / max) * 100)}%"></span></span><span class="num">${l.valor}${l.extra ? ` <small>${esc(l.extra)}</small>` : ''}</span></div>`).join('')}</div>`
}

const kpi = (rot: string, val: string, sub = '', alerta = false) => `<div class="kpi${alerta ? ' alerta' : ''}"><div class="kr">${esc(rot)}</div><div class="kv">${esc(val)}</div>${sub ? `<div class="ks">${esc(sub)}</div>` : ''}</div>`
const falha = (sec: string, e: { erro: string }) => `<p class="erro">Não consegui ler ${esc(sec)}: ${esc(e.erro)}</p>`

export function renderPainel(d: DadosPainel): string {
  const ia = d.ia, fu = d.funil, lo = d.locacao
  const kpis = [
    temErro(ia) ? '' : kpi('Atendimentos da IA', String(ia.contatos), `${ia.mensagens} respostas`),
    temErro(ia) ? '' : kpi('Enviados à Karol', String(ia.encaminhados), 'pedido completo ou urgente'),
    temErro(fu) ? '' : kpi('Pedidos fechados', String(fu.ganhos.qtd), reais(fu.ganhos.valor)),
    temErro(fu) ? '' : kpi('Em negociação', String(fu.abertos.qtd), reais(fu.abertos.valor)),
    temErro(lo) ? '' : kpi('Devoluções pendentes', String(lo.devolucoesPendentes.length), 'período vencido', lo.devolucoesPendentes.length > 0),
    temErro(ia) ? '' : kpi('Custo da IA', `US$ ${ia.custoUsd.toFixed(2).replace('.', ',')}`, `${ia.erros} erro(s)`, ia.erros > 0),
  ].join('')

  const secIA = temErro(ia) ? falha('o diário da IA', ia) : `
    <div class="grid2">
      <div><h3>Como a IA encerrou</h3>${barras(ia.finalizacoes.map(f => ({ rotulo: f.rotulo, valor: f.qtd })))}</div>
      <div><h3>Contatos atendidos por dia</h3>${barras(ia.porDia.slice(-14).map(p => ({ rotulo: br(p.data), valor: p.contatos, extra: `${p.mensagens} resp.` })))}</div>
    </div>
    <h3>Integração com o ERP</h3>
    <p>${ia.erp.ok} pedido(s) enviados ao VHSYS · ${ia.erp.erro} com erro${ia.erp.ultimosErros.length ? '' : '.'}</p>
    ${ia.erp.ultimosErros.length ? `<ul class="lista">${ia.erp.ultimosErros.map(e => `<li><b>${esc(br(e.at))}</b> ${esc(e.detalhe)}</li>`).join('')}</ul>` : ''}
    ${ia.ultimosErros.length ? `<h3>Últimos erros da IA</h3><ul class="lista">${ia.ultimosErros.map(e => `<li><b>${esc(br(e.at))} · ${esc(e.nome)}</b> ${esc(e.detalhe)}</li>`).join('')}</ul>` : ''}`

  const secFunil = temErro(fu) ? falha('o funil do GHL', fu) : `
    <div class="grid2">
      <div><h3>Cards abertos por etapa</h3>${barras(fu.etapas.map(e => ({ rotulo: e.nome, valor: e.qtd, extra: e.valor ? reais(e.valor) : '' })))}</div>
      <div><h3>Resultado no período</h3>
        <p>${fu.novos} card(s) novos · ${fu.ganhos.qtd} fechado(s) (${esc(reais(fu.ganhos.valor))}) · ${fu.perdidos.qtd} perdido(s)${fu.conversao == null ? '' : ` · conversão ${fu.conversao}%`}</p>
        <h3>Por que perdemos</h3>${barras(fu.perdidos.porMotivo.map(m => ({ rotulo: m.motivo, valor: m.qtd })))}
      </div>
    </div>`

  const secLoc = temErro(lo) ? falha('a agenda do VHSYS', lo) : `
    <div class="grid2">
      <div><h3>Hoje (${esc(br(lo.hoje.data))})</h3>
        <p><b>Saem:</b> ${lo.hoje.saem.length ? lo.hoje.saem.map(esc).join(', ') : 'nenhum'}</p>
        <p><b>Voltam:</b> ${lo.hoje.voltam.length ? lo.hoje.voltam.map(esc).join(', ') : 'nenhum'}</p>
        <h3>Devoluções pendentes</h3>
        ${lo.devolucoesPendentes.length ? `<div class="table-wrap"><table><tr><th>Pedido</th><th>Cliente</th><th>Devolução</th><th>Atraso</th></tr>${lo.devolucoesPendentes.map(p => `<tr class="atraso"><td>${esc(p.pedido)}</td><td>${esc(p.cliente)}</td><td>${esc(br(p.devolucao))}</td><td>${p.diasAtraso} dia(s)</td></tr>`).join('')}</table></div>` : '<p class="vazio">Nenhuma. Tudo devolvido ou marcado como atendido.</p>'}
      </div>
      <div><h3>Itens mais reservados (próximos 7 dias)</h3>
        ${barras(lo.maisReservados.map(i => ({ rotulo: i.nome, valor: i.reservado, extra: i.livre == null ? 'sem estoque' : `${i.livre} livres` })))}
      </div>
    </div>
    <h3>Locações dos próximos 7 dias</h3>
    ${lo.proximos.length ? `<div class="table-wrap"><table><tr><th>Pedido</th><th>Cliente</th><th>Sai</th><th>Volta</th><th>Itens</th><th>Peças</th></tr>${lo.proximos.map(p => `<tr><td>${esc(p.pedido)}</td><td>${esc(p.cliente)}</td><td>${esc(br(p.inicio))}</td><td>${esc(br(p.fim))}</td><td>${p.itens}</td><td>${p.pecas}</td></tr>`).join('')}</table></div>` : '<p class="vazio">Nenhuma locação na agenda.</p>'}
    ${lo.semPeriodo.length ? `<p class="obs">Pedidos sem a linha <code>LOCAÇÃO:</code> (não entram na agenda): ${lo.semPeriodo.map(esc).join(', ')}</p>` : ''}`

  const periodos = [7, 30, 90].map(n => `<a href="?dias=${n}"${n === d.dias ? ' class="ativo"' : ''}>${n} dias</a>`).join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Painel · Rey Festas</title><style>${CSS}</style></head><body>
<header><div><h1>Painel Rey Festas</h1><p class="sub">Atualizado ${esc(new Date(d.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</p></div><nav>${periodos}</nav></header>
<main>
<section class="kpis">${kpis}</section>
<section><h2>Atendimento da IA <small>últimos ${d.dias} dias</small></h2>${secIA}</section>
<section><h2>Funil de vendas (GHL)</h2>${secFunil}</section>
<section><h2>Locação (VHSYS)</h2>${secLoc}</section>
</main></body></html>`
}

export function renderLogin(erro = false): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Painel · Rey Festas</title><style>${CSS}</style></head><body class="login">
<form method="post"><h1>Painel Rey Festas</h1>${erro ? '<p class="erro">Senha incorreta.</p>' : ''}<label>Senha<input type="password" name="senha" autofocus required></label><button>Entrar</button></form></body></html>`
}

const CSS = `
:root{--fundo:#f5f6f8;--card:#fff;--texto:#1f2430;--sub:#667085;--borda:#e4e7ec;--cor:#c2185b;--cor2:#f8bbd0;--alerta:#b42318;--alertaf:#fef3f2}
@media (prefers-color-scheme:dark){:root{--fundo:#12141a;--card:#1b1e26;--texto:#e6e8ee;--sub:#98a2b3;--borda:#2b303b;--cor:#f06292;--cor2:#5c2a3d;--alerta:#f97066;--alertaf:#3b1d1a}}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;padding:16px;max-width:1200px;margin:0 auto}
h1{font-size:22px;margin:0}h2{font-size:18px;margin:0 0 12px}h2 small{color:var(--sub);font-weight:400;font-size:13px}h3{font-size:14px;margin:14px 0 8px;color:var(--sub);text-transform:uppercase;letter-spacing:.03em}
.sub{margin:2px 0 0;color:var(--sub);font-size:13px}nav a{padding:6px 10px;border:1px solid var(--borda);border-radius:8px;margin-left:6px;color:var(--texto);text-decoration:none;font-size:13px}nav a.ativo{background:var(--cor);border-color:var(--cor);color:#fff}
main{max-width:1200px;margin:0 auto;padding:0 16px 32px}section{background:var(--card);border:1px solid var(--borda);border-radius:12px;padding:16px;margin-bottom:16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;background:none;border:0;padding:0}
.kpi{background:var(--card);border:1px solid var(--borda);border-radius:12px;padding:14px}.kpi.alerta{border-color:var(--alerta);background:var(--alertaf)}
.kr{color:var(--sub);font-size:13px}.kv{font-size:26px;font-weight:700;margin:4px 0}.ks{color:var(--sub);font-size:12px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.barras{display:flex;flex-direction:column;gap:6px}.barra{display:grid;grid-template-columns:minmax(90px,38%) 1fr auto;gap:8px;align-items:center;font-size:13px}
.rot{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trilho{background:var(--fundo);border-radius:6px;height:12px;overflow:hidden}.enche{display:block;height:100%;background:var(--cor);border-radius:6px}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}.num small{color:var(--sub)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--borda)}th{color:var(--sub);font-weight:600}tr.atraso td{color:var(--alerta)}
.lista{margin:0;padding-left:18px;font-size:13px}.vazio,.obs{color:var(--sub);font-size:13px}.erro{color:var(--alerta)}code{font-size:12px}
.login{display:grid;place-items:center;min-height:100vh;padding:16px}.login form{background:var(--card);border:1px solid var(--borda);border-radius:12px;padding:24px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px}
.login input{width:100%;margin-top:6px;padding:10px;border:1px solid var(--borda);border-radius:8px;background:var(--fundo);color:var(--texto);font-size:15px}.login button{padding:10px;border:0;border-radius:8px;background:var(--cor);color:#fff;font-size:15px;cursor:pointer}
.table-wrap{overflow-x:auto}@media (max-width:600px){td,th{padding:6px 4px}}
`
