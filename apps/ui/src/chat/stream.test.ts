import { describe, expect, it } from 'vitest';
import { encodeTurnEvent, MAX_EVENT_LINE_CHARS, parseTurnEvent, readTurnEvents } from './stream';
import type { TurnEvent } from './stream';

const CONVERSATION = '0b6e3c1e-5f1a-4f7e-9c7a-2d9b1f4e6a80';
const done: TurnEvent = { kind: 'done', done: { conversationId: CONVERSATION, finish: 'stop', contextTokens: 120, limitTokens: 88_500 } };

/** Corpo que entrega os bytes nos pedaços dados (e anota se a leitura foi cancelada). */
function body(parts: readonly Uint8Array[]) {
  let cancelled = false;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts[index++];
      if (part === undefined) controller.close();
      else controller.enqueue(part);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

/** Os bytes cortados em pedaços de `size` (cortando caracteres de mais de um byte ao meio). */
function split(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) parts.push(bytes.slice(offset, offset + size));
  return parts;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<(TurnEvent | null)[]> {
  const events: (TurnEvent | null)[] = [];
  for await (const event of readTurnEvents(stream)) events.push(event);
  return events;
}

describe('turno em linhas JSON', () => {
  it('ida e volta: pedaços com acentos e emoji, cortados em qualquer byte', async () => {
    const events: TurnEvent[] = [{ kind: 'delta', text: 'Olá, ' }, { kind: 'delta', text: 'ação 😀\n"aspas"' }, done];
    const text = events.map(encodeTurnEvent).join('');
    for (const size of [1, 2, 3, 7, 64, text.length]) {
      expect(await collect(body(split(text, size)).stream)).toEqual(events);
    }
  });

  it('para na primeira linha que não confere', async () => {
    for (const bad of [
      'não é json',
      JSON.stringify({ kind: 'delta', text: '' }),
      JSON.stringify({ kind: 'delta', text: 'x', extra: 1 }),
      JSON.stringify({ kind: 'error', reason: 'qualquer' }),
      JSON.stringify({ kind: 'done', done: { ...done.done, finish: 'tool-calls' } }),
      JSON.stringify({ kind: 'state' }),
    ]) {
      const text = `${encodeTurnEvent({ kind: 'delta', text: 'a' })}${bad}\n${encodeTurnEvent(done)}`;
      expect(await collect(body(split(text, 5)).stream), bad).toEqual([{ kind: 'delta', text: 'a' }, null]);
    }
  });

  it('linha longa demais ou corpo cortado no meio de uma linha: null', async () => {
    const long = 'x'.repeat(MAX_EVENT_LINE_CHARS + 10);
    expect(await collect(body(split(long, 4096)).stream)).toEqual([null]);
    const cut = encodeTurnEvent(done).slice(0, 20);
    expect(await collect(body(split(cut, 8)).stream)).toEqual([null]);
    expect(parseTurnEvent(JSON.stringify({ kind: 'delta', text: long }))).toBeNull();
  });

  it('linhas vazias são ignoradas; corpo vazio não dá evento nenhum', async () => {
    expect(await collect(body(split(`\n\n${encodeTurnEvent(done)}\n`, 3)).stream)).toEqual([done]);
    expect(await collect(body([]).stream)).toEqual([]);
  });

  it('parar de ler antes do fim cancela o corpo', async () => {
    const source = body(split(`${encodeTurnEvent({ kind: 'delta', text: 'a' })}${encodeTurnEvent({ kind: 'delta', text: 'b' })}`, 4));
    for await (const event of readTurnEvents(source.stream)) {
      expect(event).toEqual({ kind: 'delta', text: 'a' });
      break;
    }
    expect(source.cancelled()).toBe(true);
  });
});
