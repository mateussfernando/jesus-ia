import { describe, expect, it } from 'vitest';
import { MAX_API_BODY_BYTES, parseFromBrain } from '../bridge/brain-protocol';
import { ApiFetchBridge, EgressError } from './api-fetch';

function setup() {
  const posted: Record<string, unknown>[] = [];
  const bridge = new ApiFetchBridge({ post: (message) => posted.push(structuredClone(message) as Record<string, unknown>) });
  return { bridge, posted };
}

const encode = (text: string) => new TextEncoder().encode(text);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ApiFetchBridge', () => {
  it('manda o pedido inteiro ao principal e monta a resposta com o que volta', async () => {
    const { bridge, posted } = setup();
    const pending = bridge.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'jesus-brain-sem-chave' },
      body: '{"a":1}',
    });
    expect(posted).toEqual([
      {
        type: 'api-request',
        id: 1,
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: [
          ['content-type', 'application/json'],
          ['x-api-key', 'jesus-brain-sem-chave'],
        ],
        body: '{"a":1}',
      },
    ]);
    expect(bridge.handle({ type: 'api-head', id: 1, status: 200, headers: [['content-type', 'text/event-stream']] })).toBe(true);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    bridge.handle({ type: 'api-chunk', id: 1, chunk: encode('data: 1\n\n') });
    bridge.handle({ type: 'api-chunk', id: 1, chunk: encode('data: 2\n\n') });
    bridge.handle({ type: 'api-end', id: 1 });
    expect(await response.text()).toBe('data: 1\n\ndata: 2\n\n');
    expect(bridge.pending).toBe(0);
  });

  it('corpo acima do limite da ponte é recusado aqui, sem virar mensagem fora do protocolo (que derrubaria o Cérebro)', async () => {
    const { bridge, posted } = setup();
    // No limite exato, em bytes (com acento, menos caracteres que bytes): sai, e a ponte aceita.
    const edge = `"${'á'.repeat((MAX_API_BODY_BYTES - 2) / 2)}"`;
    expect(Buffer.byteLength(edge)).toBe(MAX_API_BODY_BYTES);
    void bridge.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: edge });
    expect(posted).toHaveLength(1);
    expect(parseFromBrain(posted[0])).not.toBeNull();
    for (const body of [`${edge} `, 'a'.repeat(MAX_API_BODY_BYTES + 1)]) {
      const error = await bridge.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(EgressError);
      expect((error as EgressError).reason).toBe('too_large');
    }
    expect(posted).toHaveLength(1);
  });

  it('recusa antes do cabeçalho vira EgressError com o motivo', async () => {
    const { bridge } = setup();
    const pending = bridge.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
    bridge.handle({ type: 'api-error', id: 1, reason: 'over_budget' });
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EgressError);
    expect((error as EgressError).reason).toBe('over_budget');
  });

  it('falha no meio do corpo interrompe a leitura', async () => {
    const { bridge } = setup();
    const pending = bridge.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
    bridge.handle({ type: 'api-head', id: 1, status: 200, headers: [] });
    const response = await pending;
    bridge.handle({ type: 'api-chunk', id: 1, chunk: encode('data: 1\n\n') });
    bridge.handle({ type: 'api-error', id: 1, reason: 'locked' });
    const error = await response.text().catch((caught: unknown) => caught);
    expect((error as EgressError).reason).toBe('locked');
  });

  it('cancelamento antes e depois do cabeçalho avisa o principal', async () => {
    const { bridge, posted } = setup();
    const early = new AbortController();
    const first = bridge.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}', signal: early.signal });
    early.abort();
    expect(((await first.catch((caught: unknown) => caught)) as Error).name).toBe('AbortError');
    expect(posted.at(-1)).toEqual({ type: 'api-cancel', id: 1 });

    const late = new AbortController();
    const second = bridge.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}', signal: late.signal });
    bridge.handle({ type: 'api-head', id: 2, status: 200, headers: [] });
    const response = await second;
    late.abort();
    expect(((await response.text().catch((caught: unknown) => caught)) as Error).name).toBe('AbortError');
    expect(posted.at(-1)).toEqual({ type: 'api-cancel', id: 2 });
    expect(bridge.pending).toBe(0);
  });

  it('quem lê desiste do corpo: o principal para de mandar', async () => {
    const { bridge, posted } = setup();
    const pending = bridge.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
    bridge.handle({ type: 'api-head', id: 1, status: 200, headers: [] });
    const response = await pending;
    await response.body?.cancel();
    await tick();
    expect(posted.at(-1)).toEqual({ type: 'api-cancel', id: 1 });
    // O que ainda chega depois é ignorado.
    expect(bridge.handle({ type: 'api-chunk', id: 1, chunk: encode('x') })).toBe(true);
  });

  it('sinal já cancelado não manda nada', async () => {
    const { bridge, posted } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(bridge.fetch('https://x', { method: 'POST', body: '{}', signal: controller.signal })).rejects.toThrow();
    expect(posted).toHaveLength(0);
  });

  it('só aceita endereço e corpo em texto', async () => {
    const { bridge, posted } = setup();
    await expect(bridge.fetch(new Request('https://x', { method: 'POST', body: '{}' }))).rejects.toThrow(TypeError);
    await expect(bridge.fetch('https://x', { method: 'POST', body: new Uint8Array([1]) })).rejects.toThrow(TypeError);
    await expect(bridge.fetch('https://x')).rejects.toThrow(TypeError);
    expect(posted).toHaveLength(0);
  });

  it('mensagem fora de ordem é apontada', () => {
    const { bridge } = setup();
    void bridge.fetch('https://x', { method: 'POST', body: '{}' });
    expect(bridge.handle({ type: 'api-chunk', id: 1, chunk: encode('x') })).toBe(false);
    expect(bridge.handle({ type: 'api-end', id: 1 })).toBe(false);
    bridge.handle({ type: 'api-head', id: 1, status: 200, headers: [] });
    expect(bridge.handle({ type: 'api-head', id: 1, status: 200, headers: [] })).toBe(false);
  });

  it('failAll: todo pedido em aberto falha', async () => {
    const { bridge } = setup();
    const pending = bridge.fetch('https://x', { method: 'POST', body: '{}' });
    bridge.failAll('network');
    expect(((await pending.catch((caught: unknown) => caught)) as EgressError).reason).toBe('network');
    expect(bridge.pending).toBe(0);
  });
});
