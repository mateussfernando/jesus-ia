import { CHAT_FAILURES } from '@jesus/core/chat';
import { z } from 'zod';

/**
 * O turno da conversa entre a rota e a tela (decisão 0025): uma linha JSON por evento (NDJSON), na ordem em que
 * chegam do Cérebro. Pedaços da resposta (`delta`) e, no fim, sempre um `done` ou um `error`. A tela confere cada
 * linha com Zod estrito e para na primeira que não confere.
 */

/** Maior linha aceita (caracteres). Um pedaço tem até 8.192 caracteres; o escape do JSON pode multiplicar por seis. */
export const MAX_EVENT_LINE_CHARS = 64 * 1024;

const TurnEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('delta'), text: z.string().min(1).max(MAX_EVENT_LINE_CHARS) }),
  z.strictObject({
    kind: z.literal('done'),
    done: z.strictObject({
      conversationId: z.string().min(1).max(64),
      finish: z.enum(['stop', 'length']),
      contextTokens: z.number().int().nonnegative(),
      limitTokens: z.number().int().positive(),
    }),
  }),
  z.strictObject({ kind: z.literal('error'), reason: z.enum(CHAT_FAILURES) }),
]);
export type TurnEvent = z.infer<typeof TurnEventSchema>;

export function encodeTurnEvent(event: TurnEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseTurnEvent(line: string): TurnEvent | null {
  if (line.length > MAX_EVENT_LINE_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = TurnEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Lê os eventos do corpo da resposta. Devolve `null` (e para de ler) numa linha que não confere, numa linha longa
 * demais ou num fim no meio de uma linha. Parar de iterar antes do fim cancela a leitura.
 */
export async function* readTurnEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<TurnEvent | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() !== '') {
          const event = parseTurnEvent(line);
          yield event;
          if (event === null) return;
        }
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > MAX_EVENT_LINE_CHARS) {
        yield null;
        return;
      }
      if (done) {
        if (buffer.trim() !== '') yield null;
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
