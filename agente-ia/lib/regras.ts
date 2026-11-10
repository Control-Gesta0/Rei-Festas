/**
 * TRAVAS DO CLIENTE · Rey Festas. O que é regra de negócio ou de tom vira
 * CÓDIGO: a resposta que casar com uma destas não sai, o modelo reescreve
 * uma vez e, se insistir, sai o texto seguro.
 *
 * Toda regra nova precisa de um caso em scripts/test-cliente.ts (deve bloquear)
 * e um caso de texto aprovado (deve passar).
 */
export const REGRAS_CLIENTE: Array<{ regra: string; re: RegExp }> = [
  // A IA não vê o estoque por data: quem confirma é a Karol (D3/D5)
  { regra: 'afirmou disponibilidade', re: /(?<!\bse )(?<!\bse a gente )\b(?:temos|tem|t[aá]|est[aá]|fica|ficam|est[aã]o)\s+(?:sim,?\s+)?dispon[ií]ve(?:l|is)\b|\b(?:est[aá]|ficou|fica)\s+reservad[oa]s?\b|\bdata\s+(?:j[aá]\s+)?(?:est[aá]\s+)?garantida\b|\breserva\s+(?:est[aá]\s+)?confirmada\b|\bj[aá]\s+reservei\b|\bseparei\b/i },
  // Chave Pix, conta e link de pagamento só a Karol manda
  { regra: 'mandou dado de pagamento', re: /chave(?:\s+pix)?\s*(?:[:é]|e\s)\s*\S+@\S+|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\bag[eê]ncia\s*:?\s*\d|\bconta\s*(?:corrente)?\s*:?\s*\d{3,}|https?:\/\/\S*(?:pag|pay|link|checkout|stone)\S*/i },
  // Percentual: só os 50% de sinal (D7). Desconto quem aplica é a equipe (Karol, 10/11/2026); multa e taxa também
  { regra: 'percentual fora da regra', re: /(?<![\d,.])(?!50\s?%)\d{1,3}(?:[.,]\d+)?\s?%/ },
  // A loja não tem cadeira de madeira: Tiffany e Chanel são de resina (Karol, 10/11/2026). Negar ("não temos") passa
  { regra: 'cadeira de madeira (a loja não tem)', re: /(?:^|[.!?]\s*)(?![^.!?]*\bn[aã]o\b)[^.!?]*\b(cadeiras?|tiffany|chanel)\b[^.!?]*\bmadeira\b/i },
  // Agenda de entrega e recolha é da equipe (Karol, 10/11/2026): a IA não marca dia nem horário
  { regra: 'agendou entrega', re: /\b(entreg\w*|recolh\w*|levamos|buscamos)\b[^.!?\n]{0,60}(hor[aá]rio comercial|na v[eé]spera|at[eé] (o )?meio[- ]dia|[àa]s \d{1,2}(h|:\d{2})|entre \d{1,2}h?)/i },
  { regra: 'valor de multa', re: /\bmulta\s+(?:de\s+)?(?:R\$|\d)/i },
  // Falou valor: a Karol confirma disponibilidade e valor final (regra de preço do prompt)
  { regra: 'valor sem dizer que a equipe confirma', re: /^(?![\s\S]*\b(?:karol|equipe)\b)[\s\S]*?R\$\s?\d[\d.,]*/i },
  // Tom humano: travessão denuncia texto de IA no WhatsApp
  { regra: 'travessão', re: /[—–]/ },
  // Abertura de chatbot: a loja não começa mensagem com "Perfeito" (nucleo.md, Como você escreve)
  { regra: 'abertura "Perfeito"', re: /^\W*perfeit[oa]\b/i },
  // Resíduo de chatbot
  { regra: 'resíduo de chatbot', re: /espero ter ajudado|posso ajudar (?:com|em) mais alguma coisa|fico (?:à|a) disposi[çc][ãa]o|estou (?:à|a) disposi[çc][ãa]o|[óo]tima pergunta/i },
]
