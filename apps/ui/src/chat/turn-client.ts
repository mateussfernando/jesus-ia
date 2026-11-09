import { readTurnEvents } from './stream';
import type { TurnEvent } from './stream';

/** Como um turno terminou, visto pela tela: o fim que veio do Cérebro, ou `unreachable` (nem chegou a um motivo). */
export type TurnOutcome = Exclude<TurnEvent, { kind: 'delta' | 'tool' }> | 'unreachable';

/** Uma leitura de arquivo do turno, como o principal resumiu (decisão 0026). */
export interface ToolLine {
  readonly title: string;
  readonly detail: string;
}

export const TURN_URL = '/api/conversa/';

/**
 * Manda a pergunta pela rota do turno e lê a resposta em pedaços; `onText` recebe a resposta acumulada e as leituras do
 * turno a cada evento. Uma linha que não confere, ou um corpo sem nenhum evento, vira `unreachable`; um turno cortado
 * no meio, `interrupted`.
 */
export async function runTurn(
  conversationId: string,
  question: string,
  onText: (answer: string, tools: readonly ToolLine[]) => void,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly outcome: TurnOutcome; readonly answer: string; readonly tools: readonly ToolLine[] }> {
  let answer = '';
  let tools: readonly ToolLine[] = [];
  try {
    const response = await fetcher(TURN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, text: question }),
      cache: 'no-store',
    });
    if (response.body === null) return { outcome: 'unreachable', answer, tools };
    let events = 0;
    for await (const event of readTurnEvents(response.body)) {
      if (event === null) return { outcome: 'unreachable', answer, tools };
      events += 1;
      if (event.kind === 'tool') {
        tools = [...tools, { title: event.title, detail: event.detail }];
        onText(answer, tools);
        continue;
      }
      if (event.kind !== 'delta') return { outcome: event, answer, tools };
      answer += event.text;
      onText(answer, tools);
    }
    return { outcome: response.ok && events > 0 ? { kind: 'error', reason: 'interrupted' } : 'unreachable', answer, tools };
  } catch {
    return { outcome: 'unreachable', answer, tools };
  }
}
