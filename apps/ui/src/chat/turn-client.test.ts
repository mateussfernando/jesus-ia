import { describe, expect, it } from 'vitest';
import { encodeTurnEvent } from './stream';
import type { TurnEvent } from './stream';
import { runTurn, TURN_URL } from './turn-client';

const CONVERSATION = '0b6e3c1e-5f1a-4f7e-9c7a-2d9b1f4e6a80';
const DONE: TurnEvent = { kind: 'done', done: { conversationId: CONVERSATION, finish: 'stop', contextTokens: 10, limitTokens: 20 } };

function respond(text: string, status = 200): { fetcher: typeof fetch; sent: () => { url: string; init: RequestInit | undefined } } {
  let sent: { url: string; init: RequestInit | undefined } | null = null;
  const fetcher = ((url: string, init?: RequestInit) => {
    sent = { url, init };
    return Promise.resolve(new Response(text, { status }));
  }) as typeof fetch;
  return {
    fetcher,
    sent: () => {
      if (sent === null) throw new Error('nada foi mandado');
      return sent;
    },
  };
}

describe('turno visto pela tela', () => {
  it('manda a pergunta como JSON e junta os pedaços até o fim', async () => {
    const { fetcher, sent } = respond([{ kind: 'delta', text: 'Olá, ' }, { kind: 'delta', text: 'tudo bem?' }, DONE].map((event) => encodeTurnEvent(event as TurnEvent)).join(''));
    const seen: string[] = [];
    const result = await runTurn(CONVERSATION, 'Oi', (answer) => seen.push(answer), fetcher);
    expect(result).toEqual({ outcome: DONE, answer: 'Olá, tudo bem?' });
    expect(seen).toEqual(['Olá, ', 'Olá, tudo bem?']);
    const { url, init } = sent();
    expect(url).toBe(TURN_URL);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ conversationId: CONVERSATION, text: 'Oi' });
  });

  it('o motivo da falha vem como veio, mesmo com status de erro (sessão bloqueada)', async () => {
    expect((await runTurn(CONVERSATION, 'Oi', () => undefined, respond(encodeTurnEvent({ kind: 'error', reason: 'no_key' })).fetcher)).outcome).toEqual({
      kind: 'error',
      reason: 'no_key',
    });
    expect((await runTurn(CONVERSATION, 'Oi', () => undefined, respond(encodeTurnEvent({ kind: 'error', reason: 'locked' }), 401).fetcher)).outcome).toEqual({
      kind: 'error',
      reason: 'locked',
    });
  });

  it('cortado no meio: interrupted, com o que chegou até ali', async () => {
    const result = await runTurn(CONVERSATION, 'Oi', () => undefined, respond(encodeTurnEvent({ kind: 'delta', text: 'Era uma' })).fetcher);
    expect(result).toEqual({ outcome: { kind: 'error', reason: 'interrupted' }, answer: 'Era uma' });
  });

  it('resposta que não é turno, linha que não confere ou falha de rede: unreachable', async () => {
    expect((await runTurn(CONVERSATION, 'Oi', () => undefined, respond('', 403).fetcher)).outcome).toBe('unreachable');
    expect((await runTurn(CONVERSATION, 'Oi', () => undefined, respond('', 200).fetcher)).outcome).toBe('unreachable');
    expect((await runTurn(CONVERSATION, 'Oi', () => undefined, respond('<html>erro</html>\n', 500).fetcher)).outcome).toBe('unreachable');
    const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    expect((await runTurn(CONVERSATION, 'Oi', () => undefined, offline)).outcome).toBe('unreachable');
  });
});
