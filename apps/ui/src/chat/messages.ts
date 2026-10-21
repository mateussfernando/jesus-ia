import type { ChatFailure } from '@jesus/core/chat';

/** Aviso da tela de conversa: `info` para o que o dono pediu (Parar) ou não é erro; `error` para o resto. */
export interface ChatNotice {
  readonly text: string;
  readonly tone: 'info' | 'error';
}

/** O que a tela diz para cada motivo de um turno não terminar (decisões 0023 e 0024). Nunca repete dado do pedido. */
const FAILURE_TEXT: Readonly<Record<ChatFailure, string>> = {
  refused: 'A conferência de segurança do Jesus recusou o pedido à API. Isso não devia acontecer; o motivo ficou no registro.',
  no_key: 'Falta a chave da API da Anthropic. Guarde a chave em Configurações.',
  vault: 'Não deu para ler a chave no cofre. Guarde a chave de novo em Configurações.',
  over_budget: 'O teto de gasto do dia não cobre esta pergunta. Aumente o teto em Configurações ou espere o dia virar.',
  busy: 'Pedidos demais à API ao mesmo tempo. Espere um instante e tente de novo.',
  audit: 'O registro de auditoria não está gravando, e sem ele nenhum pedido sai. Feche e abra o Jesus.',
  locked: 'O Jesus bloqueou, e a resposta parou.',
  network: 'Sem conexão com a API da Anthropic. Confira a internet e tente de novo.',
  timeout: 'A resposta demorou demais e foi interrompida. Tente de novo.',
  redirect: 'A API respondeu com um redirecionamento, e o Jesus não segue redirecionamentos.',
  too_large: 'A conversa ficou grande demais para um pedido. Comece uma conversa nova.',
  interrupted: 'A resposta foi interrompida no meio. Tente de novo.',
  internal: 'Erro inesperado no Jesus. Tente de novo.',
  api_auth: 'A Anthropic recusou a chave da API. Confira a chave em Configurações e no Console da Anthropic.',
  api_rate: 'A conta da Anthropic chegou ao limite de uso. Espere um pouco ou veja os limites no Console.',
  api_overloaded: 'A API da Anthropic está sobrecarregada ou com erro. Tente de novo daqui a pouco.',
  api_invalid: 'A API da Anthropic recusou o pedido.',
  refusal: 'O modelo preferiu não responder a essa pergunta.',
  empty_answer: 'O modelo não mandou nenhum texto. Tente perguntar de outro jeito.',
  cancelled: 'Resposta parada.',
  stale: 'A conversa mudou (o Cérebro reiniciou ou outra conversa começou). A tela foi atualizada; pergunte de novo.',
  turn_running: 'Ainda há uma resposta em andamento. Espere ou clique em Parar.',
  context_full: 'A conversa chegou ao limite de tamanho. Comece uma conversa nova para continuar.',
  empty: 'Escreva uma pergunta.',
  brain: 'O Cérebro do Jesus não respondeu (ele pode estar subindo de novo). Tente de novo.',
  unavailable: 'A conversa só funciona no app de desktop do Jesus.',
};

export function noticeFor(reason: ChatFailure): ChatNotice {
  return { text: FAILURE_TEXT[reason], tone: reason === 'cancelled' ? 'info' : 'error' };
}

/** A tela não conseguiu falar com o servidor da interface (nem chegou a um motivo). */
export const UNREACHABLE: ChatNotice = { text: 'Não deu para falar com o servidor do Jesus. Tente de novo.', tone: 'error' };

/** A resposta terminou, mas cortada na saída máxima. */
export const CUT_SHORT: ChatNotice = { text: 'A resposta foi cortada no tamanho máximo. Peça para continuar, se precisar.', tone: 'info' };

/** Quanto a conversa já ocupa do limite, em texto. */
export function contextUsage(contextTokens: number, limitTokens: number): string {
  if (limitTokens <= 0) return '';
  const percent = Math.min(100, Math.floor((contextTokens / limitTokens) * 100));
  if (percent === 0 && contextTokens > 0) return 'Conversa: menos de 1% do limite';
  return `Conversa: ${String(percent)}% do limite`;
}
