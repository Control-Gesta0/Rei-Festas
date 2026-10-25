/**
 * Integração de WhatsApp por INSTÂNCIAS (Vertisell): funções PURAS.
 *
 * O que foi visto na conversa real (23/09/2026):
 *  - inbound chega com uma linha "Instance Source: Operacional@" no fim
 *  - o bot do menu responde com "#switch:Operacional@" na 1ª linha (escolhe o número de saída)
 *  - comandos soltos da integração: "#attpic", "#contact_instance:Operacional@"
 *  - respostas de sistema: "[System]: Contact photo updated successfully."
 * A IA precisa: ler só o texto humano, ignorar comando/sistema e responder
 * pela MESMA instância em que o lead escreveu.
 */

const INSTANCE_SOURCE = /^\s*Instance Source:\s*(.+?)\s*$/im

/** Instância de onde o lead escreveu ("Operacional@"), ou null. */
export function instanciaDaMensagem(body: string): string | null {
  const m = (body || '').match(INSTANCE_SOURCE)
  return m ? m[1].trim() : null
}

/** Mensagem que é só comando da integração ou aviso de sistema (não é conversa). */
export function ehComandoOuSistema(body: string): boolean {
  const t = (body || '').trim()
  if (!t) return false
  if (/^\[System\]:/i.test(t)) return true
  // comando solto: uma linha só começando com # (ex.: #attpic, #contact_instance:X)
  if (/^#[\w:@.\-]+$/i.test(t)) return true
  return false
}

/** Texto limpo: sem "Instance Source", sem a linha "#switch:...". */
export function limparTexto(body: string): string {
  return (body || '')
    .split(/\r?\n/)
    .filter(l => !/^\s*Instance Source:/i.test(l) && !/^\s*#switch:\S+\s*$/i.test(l))
    .join('\n')
    .trim()
}

/** Prefixo de saída pela instância (igual ao bot do menu). */
export function comInstancia(texto: string, instancia: string | null): string {
  return instancia ? `#switch:${instancia}\n${texto}` : texto
}
