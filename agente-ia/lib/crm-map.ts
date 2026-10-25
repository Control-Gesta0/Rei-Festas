/**
 * MAPA DO CRM · Rey Festas · GHL · funil "Locação: Vendas"
 *
 * IDs lidos da conta viva em 25/10/2026 (scripts/ghl_estrutura.py e
 * /api/discover). Mexeu no funil ou nos campos? Rode /api/validate.
 *
 * O que este arquivo carrega:
 *  1. Uma porta só ("locacao"), sem menu: todo contato novo cai nela. Buffet e
 *     outros serviços saem pela finalização "outro_servico" para o consultor.
 *  2. O pedido é o roteiro. Itens e total saem da tool calcular_tabela (código);
 *     endereço do evento e quem recebe só valem para entrega; RG, e-mail e
 *     endereço residencial só para quem ainda não tem cadastro.
 *  3. Alçada: Novo contato → Coletando pedido → Pedido completo. Daí para a
 *     frente (orçamento, pagamento, reserva) é da Karol.
 */

import { CATALOGO } from './catalogo-dados'
import type { Alerta, Campo, Etapa, ItemCatalogo, Porta } from './crm-map-types'
export type { Alerta, Campo, CampoTipo, Etapa, ItemCatalogo, Porta } from './crm-map-types'

const entrega = (r: Record<string, string>) => r.entregaRetirada === 'Entrega'
const semCadastro = (r: Record<string, string>) => r.cadastroErp === 'Não'
const pessoaFisicaSemCadastro = (r: Record<string, string>) => semCadastro(r) && r.perfil !== 'Empresa, escola ou igreja'

const CAMPOS = {
  // ---------- Pedido (oportunidade) ----------
  itens: {
    key: 'itens', id: 'hr7BVj2MLWiTEN7NGkD4', model: 'opportunity', ghlName: 'Itens solicitados', type: 'textarea',
    name: 'Itens e quantidades', soPorTool: 'calcular_tabela',
  },
  valorTabela: {
    key: 'valorTabela', id: '57SuLtUBYUGXs0A11kxU', model: 'opportunity', ghlName: 'Valor de tabela estimado', type: 'numeric',
    name: 'Valor de tabela estimado', soPorTool: 'calcular_tabela',
  },
  dataEvento: {
    key: 'dataEvento', id: 'i24isUy3ILG7v7RXMir5', model: 'opportunity', ghlName: 'Data do evento', type: 'date',
    name: 'Data do evento',
    sinal: /\d|hoje|amanh|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|semana|m[eê]s|feriado|natal|ano novo|r[eé]veillon|p[aá]scoa/i,
    pergunta: 'Pra qual data é o evento?',
  },
  entregaRetirada: {
    key: 'entregaRetirada', id: 'do2qOzlfkZZfvZauMNBv', model: 'opportunity', ghlName: 'Entrega ou retirada', type: 'select',
    name: 'Entrega ou retirada na loja', options: ['Entrega', 'Retirada na loja'],
    sinal: /entreg|retir|busc|pego|pegar|levar|leva|trazer|traz|loja|frete|motorista|vou a[ií]|passo a[ií]/i,
    pergunta: 'Vai ser com entrega no local ou você retira aqui na loja?',
  },
  enderecoEvento: {
    key: 'enderecoEvento', id: 'tqfeZ0sJCswFHCCISLZ5', model: 'opportunity', ghlName: 'Endereço do evento', type: 'textarea',
    name: 'Endereço do evento (rua, número, bairro, cidade)', aplicavel: entrega,
    pergunta: 'Qual o endereço completo do evento, com rua, número, bairro e cidade?',
  },
  horarioEvento: {
    key: 'horarioEvento', id: '', model: 'opportunity', type: 'text',
    name: 'Horário do evento', aplicavel: entrega,
    sinal: /\d|manh[aã]|tarde|noite|almo[cç]o|jantar|meio[- ]dia/i,
    pergunta: 'Que horas começa o evento?',
  },
  contatoLocal: {
    key: 'contatoLocal', id: '9S2EZt99RMHptQGmPMCw', model: 'opportunity', ghlName: 'Contato no local', type: 'text',
    name: 'Quem recebe o material no local', aplicavel: entrega,
    pergunta: 'Quem vai estar no local pra receber e conferir o material?',
  },
  tipoEvento: {
    key: 'tipoEvento', id: 'zAsQOC8o4L5FmvbBrU6L', model: 'opportunity', ghlName: 'Tipo de evento', type: 'select',
    name: 'Tipo de evento',
    options: ['Aniversário', 'Casamento', 'Chá ou festa familiar', 'Corporativo', 'Igreja', 'Escola', 'Condomínio', 'Outro'],
    pergunta: 'É que tipo de evento?',
  },
  convidados: {
    key: 'convidados', id: '7cXQk0DmSCybetCJ9MFt', model: 'opportunity', ghlName: 'Nº de convidados', type: 'numeric',
    name: 'Número de convidados', sinal: /\d|pessoa|convidad|gente|dezena|centena|cem|cinquenta|trinta|vinte|quarenta|sessenta|setenta|oitenta|noventa|duzent|trezent/i,
    pergunta: 'Mais ou menos quantos convidados?',
  },
  cidadeEvento: { key: 'cidadeEvento', id: '5Xxw94G3pH5eaTzuzj9s', model: 'opportunity', ghlName: 'Cidade do evento', type: 'text', name: 'Cidade do evento' },
  formaPagamento: {
    key: 'formaPagamento', id: 'sCrarRAiIVpKyPP0tIsY', model: 'opportunity', ghlName: 'Forma de pagamento', type: 'select',
    name: 'Forma de pagamento que a pessoa prefere', options: ['Pix', 'Cartão (link)', 'Boleto'],
  },
  motivoPerda: {
    key: 'motivoPerda', id: '9elsuic4QSOHtWz9BbLx', model: 'opportunity', ghlName: 'Motivo da perda', type: 'select',
    name: 'Motivo da perda',
    options: ['Não temos o item', 'Sem estoque na data', 'Preço', 'Frete', 'Fechou com concorrente', 'Evento cancelado', 'Prazo curto demais', 'Parou de responder'],
  },

  // ---------- Cadastro (contato) ----------
  cadastroErp: {
    key: 'cadastroErp', id: 'KnJ77dGC0IgL600kFMug', model: 'contact', ghlName: 'Cadastro no ERP', type: 'select',
    name: 'Já tem cadastro na Rey Festas', options: ['Sim', 'Não'],
    sinal: /cadastr|sim|n[aã]o|primeira vez|nunca|j[aá] (aluguei|loquei|peguei|fiz)|sou cliente|j[aá] tenho/i,
    pergunta: 'Você já tem cadastro aqui na Rey Festas?',
  },
  nomeCompleto: {
    key: 'nomeCompleto', id: 'native:name', model: 'contact', type: 'text',
    name: 'Nome completo (ou razão social)',
    pergunta: 'Me passa o nome completo pro cadastro?',
  },
  cpfCnpj: {
    key: 'cpfCnpj', id: 'mxHxoUwk3ML2vWErl7eX', model: 'contact', ghlName: 'CPF ou CNPJ', type: 'text',
    name: 'CPF ou CNPJ', sinal: /\d{3}/,
  },
  rg: {
    key: 'rg', id: 'zkoosg5sDHIZ6eEqfKVc', model: 'contact', ghlName: 'RG', type: 'text',
    name: 'RG', sinal: /\d/, aplicavel: pessoaFisicaSemCadastro,
  },
  email: {
    key: 'email', id: 'native:email', model: 'contact', type: 'text',
    name: 'E-mail', sinal: /@/, aplicavel: semCadastro,
  },
  enderecoResidencial: {
    key: 'enderecoResidencial', id: 'native:address1', model: 'contact', type: 'text',
    name: 'Endereço residencial ou da empresa (rua, número, bairro, cidade)', aplicavel: semCadastro,
  },
  perfil: {
    key: 'perfil', id: 'UH9amW5cGVm9S3mkt0Gs', model: 'contact', ghlName: 'Perfil do cliente', type: 'select',
    name: 'Perfil do cliente',
    options: ['Pessoa física', 'Decoradora ou assessora', 'Buffet ou espaço de eventos', 'Empresa, escola ou igreja'],
  },
} satisfies Record<string, Campo>

// Funil "Locação: Vendas" (5ZqhXairBGVSgpWC8PwA), na ordem real
const VENDAS = {
  novoContato: 'b2318607-8dc0-4929-b573-63527e6968be',
  coletando: 'dc5166ef-4691-4c6b-9e49-e9853f861691',
  pedidoCompleto: '11db15a4-0a58-4e67-8930-8dd8bee17fec',
  orcamentoEnviado: '5adfc03a-b939-43fd-899f-1442221e59bd',
  aguardandoPagamento: 'f2ef927d-4b4d-49a7-ac91-d7026c588c7b',
  reservado: '9c2b36d6-fd18-420b-822a-3ae44d5f0808',
}

export const CRM_MAP = {
  /** a IA NUNCA escreve nestes campos */
  camposProibidos: [] as string[],

  campos: CAMPOS as Record<string, Campo>,

  portas: [
    {
      id: 'locacao',
      label: 'Pedido de locação',
      menu: null,
      ativa: true,
      promptFile: 'locacao.md',
      sinais: /$^/,
      roteiro: [
        'itens', 'dataEvento', 'entregaRetirada', 'enderecoEvento', 'horarioEvento', 'contatoLocal',
        'tipoEvento', 'convidados',
        'cadastroErp', 'nomeCompleto', 'cpfCnpj', 'rg', 'email', 'enderecoResidencial',
      ],
      extras: ['cidadeEvento', 'formaPagamento', 'motivoPerda', 'perfil'],
      obrigatorios: [
        'itens', 'dataEvento', 'entregaRetirada', 'enderecoEvento',
        'cadastroErp', 'nomeCompleto', 'cpfCnpj', 'rg', 'email', 'enderecoResidencial',
      ],
    },
  ] as Porta[],

  menu: {
    /** sem menu: todo contato entra direto na locação */
    ativo: false,
    portaPadrao: 'locacao',
    outros: 9,
    portaPadraoOutros: 'locacao',
    classificarTextoLivre: false,
    texto: '',
    pedirResumo: '',
    naoEntendi: '',
  },

  oportunidade: {
    pipelineId: '5ZqhXairBGVSgpWC8PwA',
    etapaInicialId: VENDAS.novoContato,
    stageOrder: [
      VENDAS.novoContato, VENDAS.coletando, VENDAS.pedidoCompleto,
      VENDAS.orcamentoEnviado, VENDAS.aguardandoPagamento, VENDAS.reservado,
    ] as string[],
    /**
     * Cliente que volta com pedido novo: só reaproveita a oportunidade aberta
     * que ainda está na mão da IA. Pedido antigo (orçamento, pagamento,
     * reservado, ganho ou perdido) fica intacto e nasce uma oportunidade nova.
     */
    reusarSoNasEtapas: [VENDAS.novoContato, VENDAS.coletando] as string[],
  },

  etapas: [
    { id: VENDAS.novoContato, name: 'Novo contato', quando: 'a conversa começou (o código faz isso sozinho)', soCodigo: true },
    { id: VENDAS.coletando, name: 'Coletando pedido', quando: 'a pessoa passou o primeiro item ou a data do evento' },
    { id: VENDAS.pedidoCompleto, name: 'Pedido completo', quando: 'o pedido e o cadastro estão completos (o código move ao finalizar)', soCodigo: true },
  ] as Etapa[],
  /** movidas pelo CÓDIGO, não pelo modelo */
  etapaEmContatoId: VENDAS.novoContato,
  etapaQualificadoId: VENDAS.pedidoCompleto,
  etapaAgendadoId: '',

  /** Sem agenda por enquanto (o consultor de buffet ainda não tem calendário no GHL). */
  agenda: {
    calendarId: '',
    duracaoMin: 45,
    janelaDias: 7,
    maxOfertas: 3,
    tituloEvento: '',
  },

  /** Tabela de preços: a tool calcular_tabela soma em código e grava no card. */
  catalogo: {
    itens: CATALOGO as ItemCatalogo[],
    campoItens: 'itens',
    campoValor: 'valorTabela',
    /** a primeira soma já põe o card em "Coletando pedido" */
    etapaAoCalcular: VENDAS.coletando,
    /** pagamento integral à vista: 7% no material (D8) */
    descontoAVista: 0.07,
  },

  finalizar: {
    removerGate: true,
    tags: ['ia-finalizado'] as string[],
    /** prefixo ia- de propósito: não dispara workflow antigo da equipe */
    tagsPorMotivo: {
      qualificado: ['ia-pedido-completo'],
      urgente: ['ia-urgente'],
      ja_e_cliente: ['ia-pos-venda'],
      outro_servico: ['ia-buffet'],
      pediu_humano: ['ia-pediu-humano'],
      fora_do_escopo: ['ia-fora-do-escopo'],
      desistiu: ['ia-desistiu'],
      nao_qualificado: ['ia-sem-perfil'],
    } as Record<string, string[]>,
    tagUrgente: 'ia-urgente',
    nota: true,
    /** "Resumo da IA" (criado em 25/10/2026) */
    campoResumo: { id: '1sdgii5d6dfgXHpu0wQ9', model: 'contact' as const },
    /** o que comprova cada motivo numa locadora */
    sinalMotivo: {
      ja_e_cliente: /meu pedido|pedido (que|j[aá])|j[aá] (fechei|reservei|paguei|aluguei|loquei|fiz o pedido)|comprovante|pagamento|paguei|pago|boleto|saldo|estorno|reembolso|devolu|devolver|avaria|quebr|manchad|sujo|suja|rasg|faltou|faltando|faltava|veio errad|motorista|onde est[aá]|que horas (chega|vem|v[aã]o)|reclam|mudar|alterar|trocar|cancelar|nota fiscal|recibo/i,
      pediu_humano: /humano|pessoa|atendente|karol|noel|algu[eé]m|falar com|me liga|liga[cç][aã]o|ligar/i,
    } as Record<string, RegExp>,
  },

  alertas: [
    {
      nome: 'pedido para hoje ou amanhã',
      re: /\b(hoje|amanh[aã]|urgente|pra j[aá]|daqui a pouco|ainda hoje)\b/i,
      aviso: 'A pessoa pode estar pedindo para hoje ou amanhã. Se for, assim que tiver itens, data e entrega ou retirada, chame finalizar_atendimento(urgente) sem esperar o cadastro.',
    },
  ] as Alerta[],

  textoSeguro: 'Entendi! Essa parte a Karol confere certinho com você. Vamos seguir montando o pedido?',
  textoSeguroFinal: 'Obrigada! Já deixei tudo anotado e a Karol continua com você por aqui.',

  midia: {
    instrucaoVisao: 'Descreva em português, em no máximo 5 frases, o arquivo que um cliente de uma loja de aluguel de material para festas mandou pelo WhatsApp. Foto de item (louça, talher, copo, toalha, mesa, cadeira, rechaud, decoração): diga o tipo, cor, formato, material e a quantidade visível. Print de lista, catálogo ou conversa: transcreva os itens e as quantidades. Comprovante de pagamento: diga que é comprovante, o valor e a data. O que não estiver legível, diga "ilegível".',
  },
}

export const portaById = (id?: string) => CRM_MAP.portas.find(p => p.id === id)
export const campoByKey = (key: string) => CRM_MAP.campos[key]
