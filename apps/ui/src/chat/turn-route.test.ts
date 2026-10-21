import { describe, expect, it } from 'vitest';
import type { ChatTurnEvent, DesktopChat } from '../server/desktop-bridge';
import { readTurnEvents } from './stream';
import type { TurnEvent } from './stream';
import { handleTurnRequest, MAX_TURN_BODY_CHARS } from './turn-route';

const CONVERSATION = '0b6e3c1e-5f1a-4f7e-9c7a-2d9b1f4e6a80';
const DONE: ChatTurnEvent = { kind: 'done', done: { conversationId: CONVERSATION, finish: 'stop', contextTokens: 170, limitTokens: 88_500 } };

/** Conversa falsa: guarda os turnos pedidos; o teste manda os eventos de cada um. */
function fakeChat() {
  const turns: { conversationId: string; text: string; emit: (event: ChatTurnEvent) => void; stops: number }[] = [];
  const chat: DesktopChat = {
    state: () => Promise.reject(new Error('não usado')),
    reset: () => Promise.reject(new Error('não usado')),
    send(conversationId, text, listener) {
      const turn = { conversationId, text, emit: listener, stops: 0 };
      turns.push(turn);
      return () => {
        turn.stops += 1;
      };
    },
    stop: () => undefined,
  };
  return { chat, turns };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://jesus.invalid/api/conversa/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'jesus.invalid', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function events(response: Response): Promise<(TurnEvent | null)[]> {
  const out: (TurnEvent | null)[] = [];
  if (response.body === null) return out;
  for await (const event of readTurnEvents(response.body)) out.push(event);
  return out;
}

describe('rota de um turno da conversa', () => {
  it('a resposta sai em pedaços, uma linha por evento, e fecha no fim', async () => {
    const { chat, turns } = fakeChat();
    const response = await handleTurnRequest(post({ conversationId: CONVERSATION, text: 'Oi' }), { unlocked: () => true, chat });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('no-transform');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ conversationId: CONVERSATION, text: 'Oi' });
    const reading = events(response);
    turns[0]?.emit({ kind: 'delta', text: 'Olá, ' });
    turns[0]?.emit({ kind: 'delta', text: 'tudo bem?' });
    turns[0]?.emit(DONE);
    // Depois do fim, nada mais entra.
    turns[0]?.emit({ kind: 'delta', text: 'atrasado' });
    expect(await reading).toEqual([{ kind: 'delta', text: 'Olá, ' }, { kind: 'delta', text: 'tudo bem?' }, DONE]);
    expect(turns[0]?.stops).toBe(0);
  });

  it('erro do turno chega como evento e fecha', async () => {
    const { chat, turns } = fakeChat();
    const response = await handleTurnRequest(post({ conversationId: CONVERSATION, text: 'Oi' }), { unlocked: () => true, chat });
    const reading = events(response);
    turns[0]?.emit({ kind: 'error', reason: 'no_key' });
    expect(await reading).toEqual([{ kind: 'error', reason: 'no_key' }]);
  });

  it('outra origem, corpo que não é JSON, sessão bloqueada ou pedido inválido: nada vai para a conversa', async () => {
    const { chat, turns } = fakeChat();
    const ok = { conversationId: CONVERSATION, text: 'Oi' };
    const deps = { unlocked: () => true, chat };
    expect((await handleTurnRequest(post(ok, { origin: 'http://127.0.0.1:8080' }), deps)).status).toBe(403);
    expect((await handleTurnRequest(post(ok, { 'sec-fetch-site': 'cross-site' }), deps)).status).toBe(403);
    expect((await handleTurnRequest(post(ok, { 'content-type': 'text/plain' }), deps)).status).toBe(415);
    const locked = await handleTurnRequest(post(ok), { unlocked: () => false, chat });
    expect(locked.status).toBe(401);
    expect(await events(locked)).toEqual([{ kind: 'error', reason: 'locked' }]);
    for (const body of [
      'não é json',
      { conversationId: CONVERSATION },
      { conversationId: CONVERSATION, text: '' },
      { conversationId: 'não-é-uuid', text: 'Oi' },
      { conversationId: CONVERSATION, text: 'Oi', extra: true },
      { conversationId: CONVERSATION, text: 'x'.repeat(20_001) },
      { conversationId: CONVERSATION, text: 'x'.repeat(MAX_TURN_BODY_CHARS) },
    ]) {
      expect((await handleTurnRequest(post(body), deps)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(turns).toEqual([]);
  });

  it('a sessão conta como uso ao mandar, e só é conferida (sem contar) durante o turno', async () => {
    const { chat, turns } = fakeChat();
    const calls: boolean[] = [];
    const response = await handleTurnRequest(post({ conversationId: CONVERSATION, text: 'Oi' }), {
      unlocked: (activity) => {
        calls.push(activity);
        return true;
      },
      chat,
    });
    const reading = events(response);
    turns[0]?.emit({ kind: 'delta', text: 'a' });
    turns[0]?.emit(DONE);
    await reading;
    expect(calls[0]).toBe(true);
    expect(calls.slice(1).every((activity) => !activity)).toBe(true);
  });

  it('fora do app de desktop: indisponível', async () => {
    const response = await handleTurnRequest(post({ conversationId: CONVERSATION, text: 'Oi' }), { unlocked: () => true, chat: null });
    expect(await events(response)).toEqual([{ kind: 'error', reason: 'unavailable' }]);
  });

  it('bloqueou no meio: o turno para, a tela recebe locked, e o resto é ignorado', async () => {
    const { chat, turns } = fakeChat();
    let unlocked = true;
    const response = await handleTurnRequest(post({ conversationId: CONVERSATION, text: 'Oi' }), { unlocked: () => unlocked, chat, lockCheckMs: 60_000 });
    const reading = events(response);
    turns[0]?.emit({ kind: 'delta', text: 'Era uma vez' });
    unlocked = false;
    turns[0]?.emit({ kind: 'delta', text: ' um segredo' });
    turns[0]?.emit({ kind: 'error', reason: 'cancelled' });
    expect(await reading).toEqual([{ kind: 'delta', text: 'Era uma vez' }, { kind: 'error', reason: 'locked' }]);
    expect(turns[0]?.stops).toBe(1);
  });

  it('bloqueou enquanto o modelo pensa (sem nenhum pedaço): a conferência periódica para o turno', async () => {
    const { chat, turns } = fakeChat();
    let unlocked = true;
    const response = await handleTurnRequest(post({ conversationId: CONVERSATION, text: 'Oi' }), { unlocked: () => unlocked, chat, lockCheckMs: 5 });
    const reading = events(response);
    unlocked = false;
    expect(await reading).toEqual([{ kind: 'error', reason: 'locked' }]);
    expect(turns[0]?.stops).toBe(1);
  });

  it('a tela foi embora (cancelou a leitura): o turno para', async () => {
    const { chat, turns } = fakeChat();
    const response = await handleTurnRequest(post({ conversationId: CONVERSATION, text: 'Oi' }), { unlocked: () => true, chat });
    const reader = response.body?.getReader();
    turns[0]?.emit({ kind: 'delta', text: 'a' });
    await reader?.read();
    await reader?.cancel();
    await tick();
    expect(turns[0]?.stops).toBe(1);
    // O fim que chega depois não quebra nada.
    expect(() => turns[0]?.emit(DONE)).not.toThrow();
  });
});
