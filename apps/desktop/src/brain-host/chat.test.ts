import { getModelCard } from '@jesus/models';
import type { AuditEvent } from '@jesus/shared/audit';
import { APICallError } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_CHAT_DELTA_CHARS } from '../bridge/chat-protocol';
import type { ChatEvent, ChatState, UiChatRequest } from '../bridge/chat-protocol';
import { FakeUtilityChild } from '../bridge/fake-ipc';
import { startBrainProcess } from '../main/brain-process';
import { createChatRelay } from '../main/chat-relay';
import { createEgress } from '../main/egress/egress';
import { DailySpend } from '../main/egress/spend';
import { UpstreamError } from '../main/egress/transport';
import type { Transport, UpstreamRequest } from '../main/egress/transport';
import type { Supervisor } from '../main/supervisor';
import { EgressError } from './api-fetch';
import { runBrainHost } from './brain';
import type { BrainContext } from './brain';
import { chatFailureOf } from './chat';

/**
 * A conversa de ponta a ponta (decisão 0024), com o AI SDK de verdade: a "tela" pede pelo repassador do principal →
 * Cérebro (laço da conversa) → `fetch` da ponte → saída no principal (política, chave, teto, registro) → transporte
 * com respostas SSE gravadas → de volta, em pedaços, até a "tela".
 */

const card = getModelCard('anthropic:claude-haiku-5-5');
if (card === null) throw new Error('cartão do Claude Haiku 5.5 sumiu do catálogo');
const HAIKU = card;
const KEY = `sk-ant-api03-${'k'.repeat(40)}`;
const NOON = Date.UTC(2026, 9, 21, 15, 0, 0);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean, ms = 3_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condição não aconteceu a tempo');
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

// Respostas SSE da Messages API.
function sse(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
function start(input = 120): string {
  return sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
    },
  });
}
function thinking(index: number): string[] {
  return [
    sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }),
    sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'RXFRQkNnLi4u' } }),
    sse('content_block_stop', { type: 'content_block_stop', index }),
  ];
}
function text(index: number, pieces: readonly string[]): string[] {
  return [
    sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }),
    ...pieces.map((piece) => sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } })),
    sse('content_block_stop', { type: 'content_block_stop', index }),
  ];
}
function end(stopReason = 'end_turn', output = 50): string[] {
  return [
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: output } }),
    sse('message_stop', { type: 'message_stop' }),
  ];
}
function answer(pieces: readonly string[], options: { input?: number; output?: number } = {}): Reply {
  return { chunks: [start(options.input), ...thinking(0), ...text(1, pieces), ...end('end_turn', options.output)] };
}
function apiError(status: number, type: string): Reply {
  return { status, contentType: 'application/json', chunks: [JSON.stringify({ type: 'error', error: { type, message: 'x' } })] };
}

interface Reply {
  readonly status?: number;
  readonly contentType?: string;
  readonly chunks: readonly string[];
  /** Depois dos pedaços, espera o cancelamento. */
  readonly hold?: boolean;
}

const running: Supervisor[] = [];
afterEach(() => {
  for (const supervisor of running.splice(0)) supervisor.stop();
});

async function harness(replies: readonly Reply[], options: { limitPUsd?: number } = {}) {
  const calls: UpstreamRequest[] = [];
  const transport: Pick<Transport, 'send'> = {
    send(request, signal) {
      calls.push(request);
      const reply = replies[calls.length - 1] ?? replies[replies.length - 1];
      if (reply === undefined) return Promise.reject(new UpstreamError('network', false, 'sem resposta roteirizada'));
      async function* body(): AsyncGenerator<Buffer> {
        for (const chunk of reply?.chunks ?? []) {
          await tick();
          if (signal.aborted) throw new UpstreamError('aborted', true, 'cancelado');
          yield Buffer.from(chunk);
        }
        if (reply?.hold === true) {
          await new Promise<void>((_resolve, reject) => {
            const fail = () => reject(new UpstreamError('aborted', true, 'cancelado'));
            if (signal.aborted) fail();
            else signal.addEventListener('abort', fail, { once: true });
          });
        }
      }
      return Promise.resolve({
        status: reply.status ?? 200,
        headers: { 'content-type': reply.contentType ?? 'text/event-stream', 'request-id': 'req_1' },
        body: body(),
      });
    },
  };
  const audit: AuditEvent[] = [];
  const spend = new DailySpend({ limitPUsd: options.limitPUsd ?? 1_000_000_000_000, timeZone: 'America/Sao_Paulo', now: () => NOON });
  const egress = createEgress({
    transport,
    readKey: () => ({ ok: true, key: KEY }),
    spend,
    card: HAIKU,
    audit: (event) => {
      audit.push(event);
      return Promise.resolve();
    },
    toolNames: [],
    userAgent: 'Jesus/0.1.0',
  });
  let supervisor: Supervisor | null = null;
  const relay = createChatRelay({ postToBrain: (message) => supervisor?.post(message) ?? false });
  const violations: string[] = [];
  const contexts: BrainContext[] = [];
  let conversations = 0;
  supervisor = startBrainProcess({
    fork: () =>
      new FakeUtilityChild((parent) => {
        contexts.push(
          runBrainHost(parent, () => undefined, undefined, {
            flushMs: 0,
            now: () => new Date(NOON),
            newConversationId: () => `00000000-0000-4000-8000-${String((conversations += 1)).padStart(12, '0')}`,
          }),
        );
      }),
    egress,
    onChat: (message, violation) =>
      relay.fromBrain(message, (reason) => {
        violations.push(reason);
        violation(reason);
      }),
    onGone: () => relay.brainGone(),
    timing: { pingIntervalMs: 60_000, restartDelaysMs: [5] },
  });
  running.push(supervisor);
  await supervisor.whenReady();

  // A "tela": pede pelo repassador, como o servidor da interface.
  const owner = {};
  let uiId = 0;
  const ask = (op: 'get' | 'reset') =>
    new Promise<ChatState>((resolve, reject) => {
      relay.fromUi({ type: 'chat', id: (uiId += 1), op } as UiChatRequest, owner, (event) => {
        if (event.kind === 'state') resolve(event.state);
        else reject(new Error(`resposta inesperada: ${JSON.stringify(event)}`));
      });
    });
  const send = (conversationId: string, question: string) => {
    const id = (uiId += 1);
    const events: ChatEvent[] = [];
    const finished = new Promise<ChatEvent>((resolve) => {
      relay.fromUi({ type: 'chat', id, op: 'send', conversationId, text: question }, owner, (event) => {
        events.push(event);
        if (event.kind === 'done' || event.kind === 'error') resolve(event);
      });
    });
    const streamed = () => events.flatMap((event) => (event.kind === 'delta' ? [event.text] : [])).join('');
    return { id, events, finished, streamed, stop: () => relay.fromUi({ type: 'chat', id, op: 'stop' }, owner, () => undefined) };
  };
  const body = (call: number) => JSON.parse(calls[call]?.body.toString('utf8') ?? '{}') as Record<string, unknown>;
  return { calls, audit, spend, egress, relay, supervisor, violations, contexts, ask, send, body };
}

describe('conversa: um turno inteiro', () => {
  it('a resposta chega em pedaços, entra na conversa, e o pedido sai como a decisão 0024 manda', async () => {
    const h = await harness([answer(['Olá, ', 'tudo bem?'])]);
    const before = await h.ask('get');
    expect(before).toMatchObject({ turns: [], busy: false, conversationId: '00000000-0000-4000-8000-000000000001' });
    expect(before.limitTokens).toBeGreaterThan(80_000);
    expect(before.limitTokens).toBeLessThan(100_000);

    const turn = h.send(before.conversationId, 'Oi, tudo bem?');
    expect(await turn.finished).toEqual({
      kind: 'done',
      done: { conversationId: before.conversationId, finish: 'stop', contextTokens: 170, limitTokens: before.limitTokens },
    });
    expect(turn.streamed()).toBe('Olá, tudo bem?');
    expect((await h.ask('get')).turns).toEqual([{ user: 'Oi, tudo bem?', assistant: 'Olá, tudo bem?' }]);

    const body = h.body(0);
    expect(body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 32_000,
      stream: true,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Oi, tudo bem?', cache_control: { type: 'ephemeral' } }] }],
    });
    for (const field of ['temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(field);
    const system = body['system'] as { text: string; cache_control?: unknown }[];
    expect(system[0]?.text).toContain('Você é o Jesus');
    expect(system[0]?.text).toContain('2026');
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(h.calls[0]?.headers['x-api-key']).toBe(KEY);
    await until(() => h.audit.some((event) => event.type === 'api.call'));
    expect(h.audit.map((event) => event.type)).toEqual(['api.reserved', 'api.call']);
    expect(h.relay.pending).toBe(0);
  });

  it('o histórico volta como texto, sem os blocos de raciocínio, e só a última pergunta leva o ponto de cache', async () => {
    const h = await harness([answer(['Primeira resposta.']), answer(['Segunda resposta.'], { input: 300 })]);
    const { conversationId } = await h.ask('get');
    expect((await h.send(conversationId, 'Primeira pergunta').finished).kind).toBe('done');
    expect((await h.send(conversationId, 'Segunda pergunta').finished).kind).toBe('done');
    expect(h.body(1)['messages']).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Primeira pergunta' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Primeira resposta.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Segunda pergunta', cache_control: { type: 'ephemeral' } }] },
    ]);
    expect(JSON.stringify(h.body(1))).not.toContain('signature');
    await until(() => h.audit.filter((event) => event.type === 'api.reserved').length === 2);
    expect(h.audit.filter((event) => event.type === 'api.reserved').map((event) => event['thinking_blocks'])).toEqual([0, 0]);
    expect((await h.ask('get')).turns).toHaveLength(2);
  });

  it('segredo na pergunta sai mascarado para o modelo e para o histórico', async () => {
    const h = await harness([answer(['Não guarde chaves aqui.'])]);
    const secret = `sk-ant-api03-${'Ab1_'.repeat(23)}xAA`;
    const { conversationId } = await h.ask('get');
    expect((await h.send(conversationId, `minha chave é ${secret}`).finished).kind).toBe('done');
    expect(h.calls[0]?.body.toString('utf8')).not.toContain(secret);
    const [turn] = (await h.ask('get')).turns;
    expect(turn?.user).toContain('minha chave é');
    expect(turn?.user).not.toContain(secret);
  });

  it('pedaços grandes seguem em partes, sem partir um emoji ao meio', async () => {
    const big = `${'a'.repeat(MAX_CHAT_DELTA_CHARS - 1)}😀${'b'.repeat(10)}`;
    const h = await harness([answer([big])]);
    const { conversationId } = await h.ask('get');
    const turn = h.send(conversationId, 'manda um texto longo');
    expect((await turn.finished).kind).toBe('done');
    const deltas = turn.events.flatMap((event) => (event.kind === 'delta' ? [event.text] : []));
    expect(deltas.join('')).toBe(big);
    for (const delta of deltas) {
      expect(delta.length).toBeLessThanOrEqual(MAX_CHAT_DELTA_CHARS);
      // Nenhuma metade de par de surrogates solta (o emoji inteiro fica num pedaço só).
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(delta)).toBe(false);
    }
  });
});

describe('conversa: o que dá errado', () => {
  it.each([
    ['a Anthropic recusa a chave', apiError(401, 'authentication_error'), 'api_auth'],
    ['limite de uso da conta', apiError(429, 'rate_limit_error'), 'api_rate'],
    ['API sobrecarregada', apiError(529, 'overloaded_error'), 'api_overloaded'],
    ['pedido recusado pela API', apiError(400, 'invalid_request_error'), 'api_invalid'],
    ['o modelo recusa responder', { chunks: [start(), ...text(0, ['Não posso']), ...end('refusal')] }, 'refusal'],
    ['resposta só com raciocínio', { chunks: [start(), ...thinking(0), ...end()] }, 'empty_answer'],
  ] as const)('%s: o motivo certo, e o turno não entra na conversa', async (_name, reply, reason) => {
    const h = await harness([reply]);
    const { conversationId } = await h.ask('get');
    expect(await h.send(conversationId, 'Oi').finished).toEqual({ kind: 'error', reason });
    expect((await h.ask('get')).turns).toEqual([]);
  });

  it('teto do dia que não cobre o pedido: nada sai', async () => {
    const h = await harness([answer(['x'])], { limitPUsd: 1 });
    const { conversationId } = await h.ask('get');
    expect(await h.send(conversationId, 'Oi').finished).toEqual({ kind: 'error', reason: 'over_budget' });
    expect(h.calls).toHaveLength(0);
  });

  it('Parar no meio: o turno termina cancelado, e o pedido à API é interrompido', async () => {
    const h = await harness([{ chunks: [start(), ...text(0, ['Era uma vez'])].slice(0, 4), hold: true }]);
    const { conversationId } = await h.ask('get');
    const turn = h.send(conversationId, 'Conta uma história');
    await until(() => turn.streamed() === 'Era uma vez');
    turn.stop();
    expect(await turn.finished).toEqual({ kind: 'error', reason: 'cancelled' });
    await until(() => h.egress.inflight === 0 && h.audit.some((event) => event.type === 'api.call'));
    expect(h.audit.find((event) => event.type === 'api.call')).toMatchObject({ outcome: 'cancelled' });
    expect((await h.ask('get')).turns).toEqual([]);
  });

  it('conversa velha, turno em andamento e pergunta vazia são recusados', async () => {
    const h = await harness([{ chunks: [start(), ...text(0, ['...'])].slice(0, 4), hold: true }]);
    const { conversationId } = await h.ask('get');
    expect(await h.send('00000000-0000-4000-8000-000000000099', 'Oi').finished).toEqual({ kind: 'error', reason: 'stale' });
    expect(await h.send(conversationId, '   ').finished).toEqual({ kind: 'error', reason: 'empty' });
    const first = h.send(conversationId, 'Primeira');
    await until(() => first.streamed() === '...');
    expect(await h.send(conversationId, 'Segunda').finished).toEqual({ kind: 'error', reason: 'turn_running' });
    expect((await h.ask('get')).busy).toBe(true);
    first.stop();
    expect((await first.finished).kind).toBe('error');
  });

  it('conversa nova: zera o histórico e para o turno em andamento', async () => {
    const h = await harness([answer(['Primeira.']), { chunks: [start(), ...text(0, ['Seg'])].slice(0, 4), hold: true }]);
    const { conversationId } = await h.ask('get');
    expect((await h.send(conversationId, 'Primeira').finished).kind).toBe('done');
    const turn = h.send(conversationId, 'Segunda');
    await until(() => turn.streamed() === 'Seg');
    const fresh = await h.ask('reset');
    expect(fresh.conversationId).not.toBe(conversationId);
    expect(fresh.turns).toEqual([]);
    expect(await turn.finished).toEqual({ kind: 'error', reason: 'cancelled' });
    expect((await h.ask('get')).conversationId).toBe(fresh.conversationId);
  });

  it('conversa longa pede uma nova antes de mandar (limite de contexto)', async () => {
    const h = await harness([answer(['Resposta longa.'], { input: 95_000 })]);
    const { conversationId } = await h.ask('get');
    const done = await h.send(conversationId, 'Oi').finished;
    expect(done.kind === 'done' && done.done.contextTokens >= done.done.limitTokens).toBe(true);
    expect(await h.send(conversationId, 'E agora?').finished).toEqual({ kind: 'error', reason: 'context_full' });
    expect(h.calls).toHaveLength(1);
  });

  it('o Cérebro cai no meio: a tela recebe o motivo, e a conversa recomeça vazia', async () => {
    const h = await harness([answer(['Primeira.']), { chunks: [start(), ...text(0, ['Seg'])].slice(0, 4), hold: true }]);
    const { conversationId } = await h.ask('get');
    expect((await h.send(conversationId, 'Primeira').finished).kind).toBe('done');
    const turn = h.send(conversationId, 'Segunda');
    await until(() => turn.streamed() === 'Seg');
    h.supervisor.restart();
    expect(await turn.finished).toEqual({ kind: 'error', reason: 'brain' });
    await until(() => h.contexts.length === 2);
    // O Cérebro novo fica pronto logo depois de subir; até lá, a conversa responde `brain`.
    let after: ChatState | null = null;
    for (let attempt = 0; after === null && attempt < 100; attempt++) {
      after = await h.ask('get').catch(() => null);
      if (after === null) await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    if (after === null) throw new Error('o Cérebro novo não respondeu');
    expect(after.turns).toEqual([]);
    expect(after.conversationId).not.toBe(conversationId);
    expect(h.violations).toEqual([]);
  });
});

describe('chatFailureOf', () => {
  it('a recusa da saída vem como veio; o status da API vira o motivo; o resto é falha do Cérebro', () => {
    expect(chatFailureOf(new EgressError('no_key'))).toBe('no_key');
    expect(chatFailureOf(new Error('embrulho', { cause: new EgressError('locked') }))).toBe('locked');
    const api = (statusCode: number) =>
      new APICallError({ message: 'x', url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode, isRetryable: false });
    expect([401, 403, 429, 500, 529, 400, 413].map((status) => chatFailureOf(api(status)))).toEqual([
      'api_auth',
      'api_auth',
      'api_rate',
      'api_overloaded',
      'api_overloaded',
      'api_invalid',
      'api_invalid',
    ]);
    expect(chatFailureOf(new Error('qualquer'))).toBe('brain');
    expect(chatFailureOf('texto')).toBe('brain');
  });
});
