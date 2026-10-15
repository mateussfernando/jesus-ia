import { formatTokenCount } from './describe';
import type { Thresholds } from './thresholds';
import { usageBp } from './thresholds';

/**
 * Notas do harness (seção 5.4): pressão de memória e consciência de contexto. O texto sai só de números, em
 * pt-BR; nenhum conteúdo de ferramenta entra nele. Nunca vai no papel do usuário nem na lista de pedidos.
 */

/** 'system_message': mensagem de sistema acrescentada. 'tagged_text': bloco marcado com o nonce da sessão. */
export type HarnessNoteChannel = 'system_message' | 'tagged_text';
export type HarnessNoteKind = 'memory_pressure' | 'context_status';
export type HarnessNote = { role: 'system'; text: string } | { role: 'tagged_text'; text: string };

/** O nonce é gerado por código (aleatório por sessão); este formato impede que ele feche ou forje a marcação. */
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function percent(bp: number): string {
  return `${Math.floor(bp / 100)}%`;
}

export function renderHarnessNote(input: {
  kind: HarnessNoteKind;
  usedTokens: number;
  limit: number;
  thresholds: Thresholds;
  channel: HarnessNoteChannel;
  nonce: string;
}): HarnessNote {
  const used = percent(usageBp(input.usedTokens, input.limit));
  const compact = percent(input.thresholds.compactBp);
  const text =
    input.kind === 'memory_pressure'
      ? `Contexto em ${used} do limite; compacta em ${compact}. Se houver algo que valha lembrar a longo prazo, você pode propor com memory.save.`
      : `contexto: ${used} de ${formatTokenCount(input.limit)}; compacta em ${compact}`;
  if (input.channel === 'system_message') return { role: 'system', text };
  if (!NONCE_PATTERN.test(input.nonce)) throw new Error('nonce inválido para a nota do harness');
  return { role: 'tagged_text', text: `<nota_do_jesus n="${input.nonce}">${text}</nota_do_jesus>` };
}
