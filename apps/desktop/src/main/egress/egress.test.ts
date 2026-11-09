import { computeCost, getModelCard } from '@jesus/models';
import type { AuditEvent } from '@jesus/shared/audit';
import { describe, expect, it } from 'vitest';
import { BRAIN_KEY_PLACEHOLDER } from '../../bridge/brain-protocol';
import type { EgressFailure } from '../../bridge/brain-protocol';
import { API_URL } from './api-policy';
import type { ApiRequestInput } from './api-policy';
import { createEgress } from './egress';
import type { EgressOptions, EgressSink, KeyRead } from './egress';
import { DailySpend, worstCaseCostPUsd } from './spend';
import { UpstreamError } from './transport';
import type { Transport, UpstreamRequest, UpstreamResponse } from './transport';

const card = getModelCard('anthropic:claude-haiku-5-5');
if (card === null) throw new Error('cartão do Claude Haiku 5.5 sumiu do catálogo');
const HAIKU = card;
const KEY = `sk-ant-api03-${'k'.repeat(40)}`;
const NOON = Date.UTC(2026, 9, 19, 15, 0, 0);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function sse(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
const START = sse('message_start', {
  type: 'message_start',
  message: { id: 'msg_1', usage: { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: 1 } },
});
const TEXT = sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Olá' } });
const DELTA = sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } });
const STOP = sse('message_stop', { type: 'message_stop' });

function body(maxTokens = 1000): string {
  return JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content: 'oi' }] });
}

function apiRequest(overrides: Partial<ApiRequestInput> = {}): ApiRequestInput {
  return {
    url: API_URL,
    method: 'POST',
    headers: [
      ['content-type', 'application/json'],
      ['anthropic-version', '2023-06-01'],
      ['anthropic-beta', 'structured-outputs-2025-11-13'],
      ['x-api-key', BRAIN_KEY_PLACEHOLDER],
      ['user-agent', 'ai-sdk'],
    ],
    body: body(),
    ...overrides,
  };
}

interface Script {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly chunks?: readonly (string | Uint8Array)[];
  /** Depois dos pedaços, espera o cancelamento (ou falha com isto). */
  readonly then?: 'hold' | UpstreamError;
  readonly reject?: UpstreamError;
}

function scripted(script: Script) {
  const calls: UpstreamRequest[] = [];
  const transport: Pick<Transport, 'send'> = {
    send(request, signal) {
      calls.push(request);
      if (signal.aborted) return Promise.reject(new UpstreamError('aborted', false, 'cancelado'));
      if (script.reject !== undefined) return Promise.reject(script.reject);
      async function* iterate(): AsyncGenerator<Buffer> {
        for (const chunk of script.chunks ?? []) {
          await tick();
          if (signal.aborted) throw new UpstreamError('aborted', true, 'cancelado');
          yield typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        }
        if (script.then === 'hold') {
          await new Promise<void>((_resolve, reject) => {
            const fail = () => reject(new UpstreamError('aborted', true, 'cancelado'));
            if (signal.aborted) fail();
            else signal.addEventListener('abort', fail, { once: true });
          });
        } else if (script.then !== undefined) {
          throw script.then;
        }
      }
      const response: UpstreamResponse = {
        status: script.status ?? 200,
        headers: { 'content-type': 'text/event-stream', 'request-id': 'req_123', 'set-cookie': ['x=1'], ...script.headers },
        body: iterate(),
      };
      return Promise.resolve(response);
    },
  };
  return { transport, calls };
}

type SinkEvent = { type: 'head'; status: number; headers: [string, string][] } | { type: 'chunk'; chunk: Uint8Array } | { type: 'end' } | { type: 'fail'; reason: EgressFailure };

function recorder() {
  const events: SinkEvent[] = [];
  let resolveDone: (event: SinkEvent) => void = () => undefined;
  const done = new Promise<SinkEvent>((resolve) => {
    resolveDone = resolve;
  });
  const sink: EgressSink = {
    head: (status, headers) => events.push({ type: 'head', status, headers }),
    chunk: (chunk) => events.push({ type: 'chunk', chunk }),
    end: () => {
      events.push({ type: 'end' });
      resolveDone({ type: 'end' });
    },
    fail: (reason) => {
      events.push({ type: 'fail', reason });
      resolveDone({ type: 'fail', reason });
    },
  };
  const text = () =>
    Buffer.concat(events.flatMap((event) => (event.type === 'chunk' ? [Buffer.from(event.chunk)] : []))).toString('utf8');
  return { sink, events, done, text };
}

interface Setup {
  readonly script?: Script;
  readonly key?: KeyRead;
  readonly limitPUsd?: number;
  readonly auditFails?: boolean;
  readonly options?: Partial<EgressOptions>;
}

function setup(options: Setup = {}) {
  const { transport, calls } = scripted(options.script ?? { chunks: [START, TEXT, DELTA, STOP] });
  const audit: AuditEvent[] = [];
  let clock = 0;
  const spend = new DailySpend({ limitPUsd: options.limitPUsd ?? 1_000_000_000_000, timeZone: 'America/Sao_Paulo', now: () => NOON });
  let ids = 0;
  const egress = createEgress({
    transport,
    readKey: () => options.key ?? { ok: true, key: KEY },
    spend,
    card: HAIKU,
    audit: (event) => {
      audit.push(event);
      return options.auditFails === true ? Promise.reject(new Error('disco cheio')) : Promise.resolve();
    },
    toolNames: [],
    userAgent: 'Jesus/0.1.0',
    newRequestId: () => `req-${String((ids += 1))}`,
    now: () => clock,
    ...options.options,
  });
  return { egress, calls, audit, spend, advance: (ms: number) => (clock += ms) };
}

describe('createEgress: pedido que passa', () => {
  it('põe a chave, manda o corpo conferido, devolve a resposta e liquida pelo uso real', async () => {
    const { egress, calls, audit, spend } = setup();
    const out = recorder();
    egress.send(apiRequest({ body: JSON.stringify(JSON.parse(body()), null, 2) }), out.sink);
    expect(await out.done).toEqual({ type: 'end' });

    expect(calls).toHaveLength(1);
    const sent = calls[0];
    expect(sent?.path).toBe('/v1/messages');
    expect(sent?.headers).toEqual({
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': KEY,
      'user-agent': 'Jesus/0.1.0',
      'anthropic-beta': 'structured-outputs-2025-11-13',
    });
    expect(sent?.body.toString('utf8')).toBe(body());

    expect(out.events[0]).toEqual({
      type: 'head',
      status: 200,
      headers: [
        ['content-type', 'text/event-stream'],
        ['request-id', 'req_123'],
      ],
    });
    expect(out.text()).toBe(START + TEXT + DELTA + STOP);

    const cost = computeCost(
      { inputTokens: 600, cacheReadTokens: 300, cacheWrite5mTokens: 200, cacheWrite1hTokens: 0, outputTokens: 40 },
      HAIKU,
    ).totalPUsd;
    await tick();
    expect(spend.snapshot()).toMatchObject({ settledPUsd: cost, reservedPUsd: 0 });
    expect(audit.map((event) => event.type)).toEqual(['api.reserved', 'api.call']);
    expect(audit[0]).toMatchObject({ request: 'req-1', reserved_pusd: worstCaseCostPUsd(HAIKU, Buffer.byteLength(body()), 1000) });
    expect(audit[1]).toMatchObject({
      request: 'req-1',
      outcome: 'ok',
      status: 200,
      api_request: 'req_123',
      cost_pusd: cost,
      estimated: false,
      usage: { input: 600, cacheRead: 300, cacheWrite: 200, output: 40 },
    });
    // A chave não vai para o registro.
    expect(JSON.stringify(audit)).not.toContain(KEY);
  });

  it('raciocínio devolvido no histórico: a reserva conta cada bloco pela saída máxima', async () => {
    const { egress, audit } = setup();
    const withThinking = JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 1000,
      stream: true,
      messages: [
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'c2lnbmF0dXJh' }, { type: 'text', text: 'olá' }] },
        { role: 'user', content: 'e aí?' },
      ],
    });
    const out = recorder();
    egress.send(apiRequest({ body: withThinking }), out.sink);
    await out.done;
    expect(audit[0]).toMatchObject({
      type: 'api.reserved',
      thinking_blocks: 1,
      reserved_pusd: worstCaseCostPUsd(HAIKU, Buffer.byteLength(withThinking), 1000, 1),
    });
  });

  it('cada pedaço vai copiado: nada do resto do buffer do Node segue para o Cérebro', async () => {
    const pool = Buffer.from(`x-api-key: ${KEY}|${START}${DELTA}|outros dados`);
    const start = pool.indexOf(START);
    const slice = pool.subarray(start, start + Buffer.byteLength(START + DELTA));
    const { egress } = setup({ script: { chunks: [slice] } });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    await out.done;
    const chunks = out.events.flatMap((event) => (event.type === 'chunk' ? [event.chunk] : []));
    for (const chunk of chunks) expect(chunk.buffer.byteLength).toBe(chunk.byteLength);
    expect(Buffer.from(structuredClone(chunks[0] ?? new Uint8Array()).buffer).toString()).not.toContain(KEY);
  });

  it('erro da API (429) segue para o Cérebro como veio e não é cobrado', async () => {
    const error = JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'devagar' } });
    const { egress, spend, audit } = setup({ script: { status: 429, headers: { 'content-type': 'application/json' }, chunks: [error] } });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    expect(await out.done).toEqual({ type: 'end' });
    expect(out.events[0]).toMatchObject({ type: 'head', status: 429 });
    expect(out.text()).toBe(error);
    await tick();
    expect(spend.snapshot().settledPUsd).toBe(0);
    expect(audit[1]).toMatchObject({ outcome: 'ok', status: 429, cost_pusd: 0 });
  });
});

describe('createEgress: recusas antes de sair', () => {
  it('pedido fora da lista: não sai, e o motivo vai ao registro (no máximo uma vez por minuto)', async () => {
    const { egress, calls, audit, advance } = setup();
    const bad = apiRequest({ body: body().replace('claude-haiku-5-5', 'claude-opus-5-5') });
    for (let i = 0; i < 3; i++) {
      const out = recorder();
      egress.send(bad, out.sink);
      expect(await out.done).toEqual({ type: 'fail', reason: 'refused' });
    }
    advance(61_000);
    egress.send(bad, recorder().sink);
    await tick();
    expect(calls).toHaveLength(0);
    expect(audit).toEqual([
      { type: 'api.refused', refusal: 'body', detail: 'model: invalid_value' },
      { type: 'api.refused', refusal: 'body', detail: 'model: invalid_value', suppressed: 2 },
    ]);
  });

  it('sem chave ou com o cofre fechado: não sai nem reserva', async () => {
    for (const [key, reason] of [
      [{ ok: false, problem: 'no_key' }, 'no_key'],
      [{ ok: false, problem: 'vault' }, 'vault'],
    ] as const) {
      const { egress, calls, audit, spend } = setup({ key });
      const out = recorder();
      egress.send(apiRequest(), out.sink);
      expect(await out.done).toEqual({ type: 'fail', reason });
      expect(calls).toHaveLength(0);
      expect(audit).toHaveLength(0);
      expect(spend.snapshot().reservedPUsd).toBe(0);
    }
  });

  it('o pior caso não cabe no teto do dia: não sai', async () => {
    const { egress, calls, audit } = setup({ limitPUsd: 1_000_000 });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    expect(await out.done).toEqual({ type: 'fail', reason: 'over_budget' });
    expect(calls).toHaveLength(0);
    expect(audit[0]).toMatchObject({ type: 'api.over_budget', limit_pusd: 1_000_000, spent_pusd: 0 });
  });

  it('o registro não grava a reserva: não sai, e a reserva volta', async () => {
    const { egress, calls, spend } = setup({ auditFails: true });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    expect(await out.done).toEqual({ type: 'fail', reason: 'audit' });
    expect(calls).toHaveLength(0);
    expect(spend.snapshot()).toMatchObject({ settledPUsd: 0, reservedPUsd: 0 });
  });

  it('pedidos demais ao mesmo tempo: o excedente é recusado', async () => {
    const { egress } = setup({ script: { chunks: [START], then: 'hold' }, options: { maxInflight: 1 } });
    const first = recorder();
    egress.send(apiRequest(), first.sink);
    await tick();
    const second = recorder();
    egress.send(apiRequest(), second.sink);
    expect(await second.done).toEqual({ type: 'fail', reason: 'busy' });
    egress.cancelAll('locked');
    expect(await first.done).toEqual({ type: 'fail', reason: 'locked' });
  });
});

describe('createEgress: interrupções', () => {
  it('o bloqueio interrompe o pedido, avisa o Cérebro e cobra o pior caso da saída', async () => {
    const { egress, audit, spend } = setup({ script: { chunks: [START, TEXT], then: 'hold' } });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    for (let i = 0; i < 10; i++) await tick();
    expect(egress.inflight).toBe(1);
    egress.cancelAll('locked');
    expect(await out.done).toEqual({ type: 'fail', reason: 'locked' });
    expect(egress.inflight).toBe(0);
    await tick();
    // Sem a saída final, ela conta inteira (max_tokens).
    const expected = computeCost(
      { inputTokens: 600, cacheReadTokens: 300, cacheWrite5mTokens: 200, cacheWrite1hTokens: 0, outputTokens: 1000 },
      HAIKU,
    ).totalPUsd;
    expect(spend.snapshot().settledPUsd).toBe(expected);
    expect(audit[1]).toMatchObject({ outcome: 'locked', estimated: true, cost_pusd: expected });
  });

  it('cancelado enquanto a reserva grava: o pedido nem sai, e nada é cobrado', async () => {
    for (const how of ['cancel', 'locked', 'brain_gone'] as const) {
      let release: () => void = () => undefined;
      const events: AuditEvent[] = [];
      const { egress, calls, spend } = setup({
        options: {
          audit: (event) => {
            events.push(event);
            // A reserva demora a gravar (disco lento); o resto grava na hora.
            return event.type === 'api.reserved' ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
          },
        },
      });
      const out = recorder();
      const cancel = egress.send(apiRequest(), out.sink);
      await tick();
      if (how === 'cancel') cancel();
      else egress.cancelAll(how);
      release();
      for (let i = 0; i < 10; i++) await tick();
      expect(calls, how).toHaveLength(0);
      expect(egress.inflight).toBe(0);
      expect(spend.snapshot()).toMatchObject({ settledPUsd: 0, reservedPUsd: 0 });
      expect(events[1], how).toMatchObject({ type: 'api.call', outcome: how === 'locked' ? 'locked' : 'cancelled', cost_pusd: 0 });
      expect(out.events, how).toEqual(how === 'locked' ? [{ type: 'fail', reason: 'locked' }] : []);
    }
  });

  it('o Cérebro desiste: nada mais vai para ele', async () => {
    const { egress, audit } = setup({ script: { chunks: [START], then: 'hold' } });
    const out = recorder();
    const cancel = egress.send(apiRequest(), out.sink);
    for (let i = 0; i < 10; i++) await tick();
    const before = out.events.length;
    cancel();
    for (let i = 0; i < 10; i++) await tick();
    expect(out.events.length).toBe(before);
    expect(egress.inflight).toBe(0);
    expect(audit[1]).toMatchObject({ outcome: 'cancelled' });
  });

  it('o Cérebro caiu: tudo para, sem aviso', async () => {
    const { egress } = setup({ script: { chunks: [START], then: 'hold' } });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    for (let i = 0; i < 10; i++) await tick();
    egress.cancelAll('brain_gone');
    for (let i = 0; i < 10; i++) await tick();
    expect(out.events.some((event) => event.type === 'fail' || event.type === 'end')).toBe(false);
    expect(egress.inflight).toBe(0);
  });

  it('resposta cortada no meio: falha, com a entrada que veio e a saída inteira cobradas', async () => {
    const { egress, spend } = setup({ script: { chunks: [START, TEXT], then: new UpstreamError('network', true, 'cortada') } });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    expect(await out.done).toEqual({ type: 'fail', reason: 'interrupted' });
    await tick();
    expect(spend.snapshot().settledPUsd).toBeGreaterThan(0);
  });

  it('resposta grande demais: falha e para de ler', async () => {
    const { egress } = setup({ script: { chunks: [START, TEXT, TEXT, TEXT], then: 'hold' }, options: { maxResponseBytes: 400 } });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    expect(await out.done).toEqual({ type: 'fail', reason: 'too_large' });
  });

  it('preço inválido no catálogo: o pior caso não se calcula e nada sai (falha fechada)', async () => {
    const { egress, calls } = setup({ options: { card: { ...HAIKU, price: { ...HAIKU.price, outputPerMTok: -1 } } } });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    expect(await out.done).toEqual({ type: 'fail', reason: 'over_budget' });
    expect(calls).toHaveLength(0);
  });

  it('erro inesperado no caminho: o pedido termina mesmo assim, e o send nunca lança', async () => {
    const { egress } = setup({
      options: {
        audit: (event) => {
          if (event.type === 'api.call') throw new Error('falha inesperada');
          return Promise.resolve();
        },
      },
    });
    const out = recorder();
    egress.send(apiRequest(), out.sink);
    expect(await out.done).toEqual({ type: 'fail', reason: 'internal' });
    expect(egress.inflight).toBe(0);

    const broken = createEgress({
      transport: scripted({}).transport,
      readKey: () => {
        throw new Error('cofre explodiu');
      },
      spend: new DailySpend({ limitPUsd: 1, timeZone: 'America/Sao_Paulo', now: () => NOON }),
      card: HAIKU,
      audit: () => Promise.resolve(),
      toolNames: [],
      userAgent: 'x',
    });
    const second = recorder();
    expect(() => broken.send(apiRequest(), second.sink)).not.toThrow();
    expect(await second.done).toEqual({ type: 'fail', reason: 'internal' });
  });

  it('falhas do transporte antes da resposta', async () => {
    const cases: [UpstreamError, EgressFailure, boolean][] = [
      [new UpstreamError('network', false, 'ECONNREFUSED'), 'network', false],
      [new UpstreamError('timeout', true, 'demorou'), 'timeout', true],
      [new UpstreamError('redirect', true, '302'), 'redirect', false],
    ];
    for (const [error, reason, charged] of cases) {
      const { egress, spend } = setup({ script: { reject: error } });
      const out = recorder();
      egress.send(apiRequest(), out.sink);
      expect(await out.done).toEqual({ type: 'fail', reason });
      await tick();
      expect(spend.snapshot().settledPUsd > 0).toBe(charged);
    }
  });
});
