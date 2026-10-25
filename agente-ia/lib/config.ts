function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Env var obrigatória ausente: ${name}`)
  return v
}

const list = (v: string | undefined) => (v || '').split(',').map(x => x.trim()).filter(Boolean)

/**
 * Variante GHL (GoHighLevel / white-label Vertisell).
 * O GHL devolve o transcript: o histórico vem do CRM (fonte da verdade).
 * O Redis guarda só coordenação: buffer, lock, estado do roteiro, cache de
 * mídia transcrita, slots oferecidos e o diário de execuções.
 */
export const CONFIG = {
  clientName: process.env.CLIENT_NAME || 'Cliente · Agente',

  ghlToken: required('GHL_TOKEN'),
  ghlLocationId: required('GHL_LOCATION_ID'),
  ghlBaseUrl: (process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com').replace(/\/+$/, ''),
  /** tipo de canal no POST /conversations/messages */
  ghlChannel: process.env.GHL_CHANNEL || 'WhatsApp',
  timezone: process.env.TIMEZONE || 'America/Sao_Paulo',

  openaiApiKey: required('OPENAI_API_KEY'),
  llmModel: process.env.LLM_MODEL || 'gpt-5.4-mini-2026-03-17',
  visionModel: process.env.VISION_MODEL || 'gpt-5.4-mini-2026-03-17',
  sttModel: process.env.STT_MODEL || 'gpt-4o-mini-transcribe',

  // Aceita os dois nomes: o do Upstash e o que a integração da Vercel (Storage) cria sozinha
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL || required('KV_REST_API_URL'),
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN || required('KV_REST_API_TOKEN'),
  redisPrefix: process.env.REDIS_PREFIX || 'agente-cliente:',

  webhookSecret: required('WEBHOOK_SECRET'),
  debounceSeconds: Number(process.env.DEBOUNCE_SECONDS || 10),

  // Gate: só atende quem tem a tag. Vazio = atende todos (só no fim da rampagem).
  gateTag: (process.env.GATE_TAG || '').toLowerCase(),
  humanTag: (process.env.HUMAN_TAG || 'atendimento-humano').toLowerCase(),
  // ERP (VHSYS): opcionais para o agente; só a sincronização de pedido fechado usa
  vhsysAccessToken: process.env.VHSYS_ACCESS_TOKEN || '',
  vhsysSecretToken: process.env.VHSYS_SECRET_ACCESS_TOKEN || '',
  vhsysBaseUrl: (process.env.VHSYS_BASE_URL || 'https://api.vhsys.com/v2').replace(/\/+$/, ''),
  /** "gravar" cria cliente e orçamento no VHSYS; qualquer outro valor é ensaio (só lê e mostra) */
  erpGravar: (process.env.ERP_MODO || '').toLowerCase() === 'gravar',

  /** contatos que podem mandar "reset" (contact ids do GHL) */
  testContactIds: list(process.env.TEST_CONTACT_IDS),
}
