/**
 * Vocabulário da conversa (decisões 0023 e 0024), comum ao app de desktop, que leva as mensagens entre os processos,
 * e à interface, que mostra cada motivo de falha com a mensagem certa. Sem dependências: entra também no navegador
 * (`@jesus/core/chat`).
 */

/** Maior pergunta (caracteres). Uma conversa inteira cabe em uns 88 mil tokens. */
export const MAX_CHAT_TEXT_CHARS = 20_000;

/**
 * Por que o processo principal não atendeu (ou interrompeu) um pedido à API. O Cérebro só recebe o motivo; o detalhe
 * fica no registro de auditoria do principal.
 * - `refused`: o pedido saiu da lista (destino, cabeçalho, corpo, modelo, ferramenta, teto de `max_tokens`);
 * - `no_key`: não há chave da API guardada; `vault`: o cofre não abre;
 * - `over_budget`: o teto de gasto do dia não cobre o pior caso do pedido;
 * - `busy`: pedidos demais ao mesmo tempo; `audit`: o registro de auditoria não grava (sem registro, sem gasto);
 * - `locked`: o Jesus bloqueou no meio do pedido;
 * - `network`, `timeout`, `redirect`, `too_large`, `interrupted`: falhas da conexão ou da resposta;
 * - `internal`: erro inesperado no próprio principal.
 */
export const EGRESS_FAILURES = [
  'refused',
  'no_key',
  'vault',
  'over_budget',
  'busy',
  'audit',
  'locked',
  'network',
  'timeout',
  'redirect',
  'too_large',
  'interrupted',
  'internal',
] as const;
export type EgressFailure = (typeof EGRESS_FAILURES)[number];

/**
 * Por que um turno da conversa não terminou bem:
 * - as falhas da saída para a API (acima), como vieram;
 * - `api_auth`: a Anthropic recusou a chave; `api_rate`: limite de uso da conta; `api_overloaded`: a API está
 *   sobrecarregada ou com erro; `api_invalid`: a API recusou o pedido;
 * - `refusal`: o modelo recusou responder; `empty_answer`: veio resposta sem texto;
 * - `cancelled`: o dono parou; `stale`: a conversa da tela não é mais a do Cérebro (ele reiniciou, ou outra começou);
 * - `turn_running`: já há um turno em andamento; `context_full`: a conversa ficou longa e precisa de uma nova;
 * - `empty`: pergunta vazia; `brain`: o Cérebro caiu ou falhou; `unavailable`: sem Cérebro (fora do app de desktop).
 */
export const CHAT_FAILURES = [
  ...EGRESS_FAILURES,
  'api_auth',
  'api_rate',
  'api_overloaded',
  'api_invalid',
  'refusal',
  'empty_answer',
  'cancelled',
  'stale',
  'turn_running',
  'context_full',
  'empty',
  'brain',
  'unavailable',
] as const;
export type ChatFailure = (typeof CHAT_FAILURES)[number];

const CHAT_FAILURE_SET: ReadonlySet<string> = new Set(CHAT_FAILURES);

export function isChatFailure(value: unknown): value is ChatFailure {
  return typeof value === 'string' && CHAT_FAILURE_SET.has(value);
}
