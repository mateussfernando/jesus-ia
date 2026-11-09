import { readTurnEvents } from './stream';
import type { TurnEvent } from './stream';

/** Como um turno terminou, visto pela tela: o fim que veio do Cérebro, ou `unreachable` (nem chegou a um motivo). */
export type TurnOutcome = Exclude<TurnEvent, { kind: 'delta' }> | 'unreachable';

export const TURN_URL = '/api/conversa/';

/**
 * Manda a pergunta pela rota do turno e lê a resposta em pedaços; `onText` recebe a resposta acumulada a cada pedaço.
 * Uma linha que não confere, ou um corpo sem nenhum evento, vira `unreachable`; um turno cortado no meio, `interrupted`.
 */
export async function runTurn(
  conversationId: string,
  question: string,
  onText: (answer: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly outcome: TurnOutcome; readonly answer: string }> {
  let answer = '';
  try {
    const response = await fetcher(TURN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, text: question }),
      cache: 'no-store',
    });
    if (response.body === null) return { outcome: 'unreachable', answer };
    let events = 0;
    for await (const event of readTurnEvents(response.body)) {
      if (event === null) return { outcome: 'unreachable', answer };
      events += 1;
      if (event.kind !== 'delta') return { outcome: event, answer };
      answer += event.text;
      onText(answer);
    }
    return { outcome: response.ok && events > 0 ? { kind: 'error', reason: 'interrupted' } : 'unreachable', answer };
  } catch {
    return { outcome: 'unreachable', answer };
  }
}
