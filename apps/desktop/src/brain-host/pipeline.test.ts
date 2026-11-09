import { getModelCard } from '@jesus/models';
import type { AuditEvent } from '@jesus/shared/audit';
import { streamText, tool } from 'ai';
import type { ModelMessage } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeUtilityChild } from '../bridge/fake-ipc';
import { startBrainProcess } from '../main/brain-process';
import { createEgress } from '../main/egress/egress';
import { DailySpend } from '../main/egress/spend';
import { UpstreamError } from '../main/egress/transport';
import type { Transport, UpstreamRequest } from '../main/egress/transport';
import type { Supervisor } from '../main/supervisor';
import { EgressError, egressFailureOf } from './api-fetch';
import { runBrainHost } from './brain';
import type { BrainContext } from './brain';
import { refuseDownload } from './model';

/**
 * O caminho inteiro de um pedido do Cérebro (decisão 0023), com o AI SDK de verdade: `streamText` no Cérebro → `fetch`
 * da ponte → mensagens conferidas com Zod → supervisor → saída no principal (política, cofre, teto, registro) →
 * transporte roteirizado → resposta de volta pelo mesmo caminho.
 */

const card = getModelCard('anthropic:claude-haiku-5-5');
if (card === null) throw new Error('cartão do Claude Haiku 5.5 sumiu do catálogo');
const HAIKU = card;
const KEY = `sk-ant-api03-${'k'.repeat(40)}`;
const NOON = Date.UTC(2026, 9, 19, 15, 0, 0);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function sse(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

const REPLY = [
  sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
    },
  }),
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Olá, ' } }),
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Mateus.' } }),
  sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 12 } }),
  sse('message_stop', { type: 'message_stop' }),
];

interface Harness {
  readonly context: BrainContext;
  readonly calls: UpstreamRequest[];
  readonly audit: AuditEvent[];
  readonly spend: DailySpend;
  readonly egress: ReturnType<typeof createEgress>;
}

const running: Supervisor[] = [];
afterEach(() => {
  for (const supervisor of running.splice(0)) supervisor.stop();
});

async function start(options: { hold?: boolean } = {}): Promise<Harness> {
  const calls: UpstreamRequest[] = [];
  const transport: Pick<Transport, 'send'> = {
    send(request, signal) {
      calls.push(request);
      async function* body(): AsyncGenerator<Buffer> {
        for (const chunk of REPLY.slice(0, options.hold === true ? 3 : REPLY.length)) {
          await tick();
          yield Buffer.from(chunk);
        }
        if (options.hold === true) {
          await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new UpstreamError('aborted', true, 'x'))));
        }
      }
      return Promise.resolve({ status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_9' }, body: body() });
    },
  };
  const audit: AuditEvent[] = [];
  const spend = new DailySpend({ limitPUsd: 1_000_000_000_000, timeZone: 'America/Sao_Paulo', now: () => NOON });
  const egress = createEgress({
    transport,
    readKey: () => ({ ok: true, key: KEY }),
    spend,
    card: HAIKU,
    audit: (event) => {
      audit.push(event);
      return Promise.resolve();
    },
    toolNames: ['file_read'],
    userAgent: 'Jesus/0.1.0',
  });
  let context: BrainContext | null = null;
  const supervisor = startBrainProcess({
    fork: () =>
      new FakeUtilityChild((parent) => {
        context = runBrainHost(parent, () => undefined);
      }),
    egress,
    timing: { pingIntervalMs: 60_000 },
  });
  running.push(supervisor);
  await supervisor.whenReady();
  if (context === null) throw new Error('o Cérebro não subiu');
  return { context, calls, audit, spend, egress };
}

/** Partes do fluxo do `streamText` que o teste lê. */
type Part = { readonly type: string; readonly text?: string; readonly error?: unknown };

async function collect(result: { readonly fullStream: AsyncIterable<unknown> }) {
  let text = '';
  const errors: unknown[] = [];
  try {
    for await (const raw of result.fullStream) {
      const part = raw as Part;
      if (part.type === 'text-delta') text += part.text ?? '';
      if (part.type === 'error') errors.push(part.error);
    }
  } catch (error) {
    // Falha no meio do corpo: o AI SDK lança, com o erro da saída como causa.
    errors.push(error);
  }
  return { text, errors };
}

const MESSAGES: ModelMessage[] = [
  { role: 'system', content: 'Você é o Jesus.', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
  { role: 'user', content: 'Oi' },
];

describe('pedido do Cérebro à API, de ponta a ponta', () => {
  it('o AI SDK conversa pela ponte: a chave só aparece na saída do principal', async () => {
    const h = await start();
    const { text, errors } = await collect(
      streamText({
        model: h.context.model,
        messages: MESSAGES,
        allowSystemInMessages: true,
        maxRetries: 0,
        maxOutputTokens: 2_000,
        experimental_download: refuseDownload,
        tools: { file_read: tool({ description: 'Lê um arquivo.', inputSchema: z.object({ path: z.string() }) }) },
        providerOptions: { anthropic: { effort: 'medium', thinking: { type: 'adaptive' } } },
      }),
    );
    expect(errors).toEqual([]);
    expect(text).toBe('Olá, Mateus.');

    expect(h.calls).toHaveLength(1);
    const sent = h.calls[0];
    expect(sent?.headers['x-api-key']).toBe(KEY);
    expect(sent?.headers['user-agent']).toBe('Jesus/0.1.0');
    expect(sent?.headers['anthropic-beta']).toBe('structured-outputs-2025-11-13');
    const body = JSON.parse(sent?.body.toString('utf8') ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 2_000, stream: true, output_config: { effort: 'medium' } });
    expect(JSON.stringify(body)).not.toContain('jesus-brain-sem-chave');

    await tick();
    expect(h.audit.map((event) => event.type)).toEqual(['api.reserved', 'api.call']);
    expect(h.spend.snapshot().settledPUsd).toBeGreaterThan(0);
    expect(h.context.api.pending).toBe(0);
  });

  it('pedido fora da lista (container, MCP) não sai: o AI SDK recebe a recusa', async () => {
    const h = await start();
    for (const anthropic of [{ container: { id: 'c_1' } }, { mcpServers: [{ type: 'url', name: 'x', url: 'https://atacante.example/mcp' }] }]) {
      const { errors } = await collect(streamText({ model: h.context.model, messages: MESSAGES, allowSystemInMessages: true, maxRetries: 0, maxOutputTokens: 100, providerOptions: { anthropic } }));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(EgressError);
      expect(egressFailureOf(errors[0])).toBe('refused');
    }
    expect(h.calls).toHaveLength(0);
    expect(h.audit[0]).toMatchObject({ type: 'api.refused', refusal: 'body' });
  });

  it('imagem por URL numa mensagem: nada é baixado nem mandado', async () => {
    const h = await start();
    const { errors } = await collect(
      streamText({
        model: h.context.model,
        maxRetries: 0,
        maxOutputTokens: 100,
        experimental_download: refuseDownload,
        messages: [{ role: 'user', content: [{ type: 'image', image: new URL('https://atacante.example/x.png?dados=segredo') }] }],
      }),
    );
    expect(errors).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
  });

  it('modelo pedido por nome em texto cai no gateway, que recusa na hora', async () => {
    const h = await start();
    expect(() => streamText({ model: 'anthropic/claude-haiku-5-5', prompt: 'oi', maxRetries: 0 })).toThrow('não usa o AI Gateway');
    expect(h.calls).toHaveLength(0);
  });

  it('o bloqueio do Jesus interrompe a resposta no meio', async () => {
    const h = await start({ hold: true });
    const result = streamText({ model: h.context.model, messages: MESSAGES, allowSystemInMessages: true, maxRetries: 0, maxOutputTokens: 100 });
    const reading = collect(result);
    for (let i = 0; i < 30 && h.egress.inflight === 0; i++) await tick();
    for (let i = 0; i < 10; i++) await tick();
    h.egress.cancelAll('locked');
    const { text, errors } = await reading;
    expect(text).toBe('Olá, ');
    expect(errors).toHaveLength(1);
    expect(egressFailureOf(errors[0])).toBe('locked');
  });
});
