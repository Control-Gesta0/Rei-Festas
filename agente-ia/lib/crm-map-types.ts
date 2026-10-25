/** Tipos do mapa do CRM (asset — o crm-map.ts do cliente importa daqui). Variante GHL. */

export type CampoTipo = 'text' | 'textarea' | 'numeric' | 'select' | 'multiselect' | 'date'

export interface Campo {
  key: string
  /**
   * id do custom field no GHL. '' = só guarda no estado (não grava no CRM).
   * 'native:<chave>' = campo nativo do contato (native:name, native:email, native:address1, native:companyName)
   */
  id: string
  /** GHL tem DOIS conjuntos de campos: do contato e da oportunidade */
  model: 'contact' | 'opportunity'
  /** nome que o MODELO vê */
  name: string
  /** nome real no GHL (o validate compara) */
  ghlName?: string
  type: CampoTipo
  /** select/multiselect: texto EXATO das opções no GHL (o GHL grava por texto) */
  options?: string[]
  /** palavras que a evidência do lead precisa conter */
  sinal?: RegExp
  /** a pergunta do roteiro (a regra da resposta curta "sim/não" usa) */
  pergunta?: string
  /** campo condicional: só entra no roteiro (e nos obrigatórios) quando devolve true para as respostas já dadas */
  aplicavel?: (respostas: Record<string, string>) => boolean
  /** preenchido só por esta tool (salvar_respostas recusa) */
  soPorTool?: string
}

export interface Porta {
  id: string
  label: string
  /** número no menu; null = só por classificação de texto */
  menu: number | null
  /** false = sem agente ainda: manda `mensagemSemAgente` e finaliza */
  ativa: boolean
  /** arquivo em prompts/portas/ */
  promptFile?: string
  /** texto do lead que identifica esta porta SEM ambiguidade */
  sinais: RegExp
  /** chaves de CAMPOS na ordem do roteiro */
  roteiro: string[]
  /** campos que a IA grava se o lead falar, mas NUNCA pergunta (não contam no roteiro) */
  extras?: string[]
  /** chaves que precisam estar respondidas (ou "não sei", se texto) para finalizar como qualificado */
  obrigatorios: string[]
  mensagemSemAgente?: string
  /** texto fixo aprovado: enviado pelo CÓDIGO quando o lead só escolheu o número do menu */
  abertura?: string
}

/** Detecção em CÓDIGO no turno do lead → aviso no contexto do modelo. */
export interface Alerta {
  nome: string
  re: RegExp
  aviso: string
  finaliza?: { motivo: string; seResposta: RegExp }
}

/** Etapa da ALÇADA da IA (a IA só move para estas). */
export interface Etapa {
  id: string
  name: string
  quando: string
  /** true = só o código move para cá (o modelo não vê esta etapa em mover_etapa) */
  soCodigo?: boolean
}

/** Tabela de preço que a tool calcular_tabela soma em código. */
export interface ItemCatalogo { codigo: string; nome: string; categoria: string; preco: number | null }
