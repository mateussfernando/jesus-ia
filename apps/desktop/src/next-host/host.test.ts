import { describe, expect, it } from 'vitest';
import { createFakeChannel, FakeUtilityChild } from '../bridge/fake-ipc';
import type { FakeMessagePort } from '../bridge/fake-ipc';
import { CREDIT_WINDOW, MAX_CHUNK_BYTES } from '../bridge/protocol';
import type { RequestMeta } from '../bridge/protocol';
import { wrapPort } from '../bridge/ports';
import { createHostBridge } from './desktop-bridge';
import { runNextHost, serveOverPort } from './host';
import type { LoadServer, Serve } from './host';

const CONFIG = { type: 'config', uiDir: '/app/ui', dataDir: '/dados' } as const;
const GET: RequestMeta = { url: 'https://jesus.invalid/', method: 'GET', headers: [], body: null };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await tick();
}

/** Lado "principal" de um pedido: guarda tudo o que o servidor manda e confirma só quando mandado. */
function mainSide(port: FakeMessagePort) {
  const received: { type: string; chunk?: Uint8Array; status?: number }[] = [];
  let closed = false;
  port.on('message', (event: { data: unknown }) => received.push(event.data as { type: string }));
  port.on('close', () => {
    closed = true;
  });
  port.start();
  return {
    received,
    get closed() {
      return closed;
    },
    ack: (times = 1) => {
      for (let i = 0; i < times; i++) port.postMessage({ type: 'ack' });
    },
    cancel: () => port.postMessage({ type: 'cancel' }),
    chunks: () => received.filter((m) => m.type === 'chunk').length,
  };
}

function hostWith(load: LoadServer) {
  const logs: string[] = [];
  const child = new FakeUtilityChild((parent) => runNextHost(parent, load, (line) => logs.push(line)));
  const messages: unknown[] = [];
  child.on('message', (message: unknown) => messages.push(message));
  return { child, messages, logs };
}

const okServe: Serve = () => Promise.resolve(new Response('ok', { headers: { 'content-type': 'text/plain' } }));

describe('servidor da interface: configuração e pedidos pelo parentPort', () => {
  it('carrega com a configuração recebida e avisa que está pronto', async () => {
    const seen: unknown[] = [];
    const { child, messages } = hostWith((config) => {
      seen.push(config);
      return Promise.resolve({ serve: okServe, prepareMs: 123 });
    });
    child.postMessage(CONFIG);
    await settle();
    expect(seen).toEqual([CONFIG]);
    expect(messages).toEqual([{ type: 'ready', prepareMs: 123 }]);
  });

  it('configuração repetida é recusada (a pasta de dados não muda com o servidor rodando)', async () => {
    let loads = 0;
    const { child, messages, logs } = hostWith(() => {
      loads++;
      return Promise.resolve({ serve: okServe, prepareMs: 1 });
    });
    child.postMessage(CONFIG);
    child.postMessage({ ...CONFIG, dataDir: '/outra' });
    await settle();
    expect(loads).toBe(1);
    expect(messages).toHaveLength(1);
    expect(logs).toContain('configuração repetida recusada');
  });

  it('responde ao sinal de vida em qualquer fase, com o mesmo número', async () => {
    const { child, messages } = hostWith(() => new Promise(() => undefined));
    child.postMessage({ type: 'ping', seq: 1 });
    await settle();
    child.postMessage(CONFIG);
    child.postMessage({ type: 'ping', seq: 2 });
    await settle();
    expect(messages).toEqual([
      { type: 'pong', seq: 1 },
      { type: 'pong', seq: 2 },
    ]);
  });

  it('bloqueio do principal: aplica pela ponte e só então confirma; sem quem aplique, confirma também', async () => {
    const host = createHostBridge();
    const logs: string[] = [];
    const child = new FakeUtilityChild((parent) => runNextHost(parent, () => new Promise(() => undefined), (line) => logs.push(line), host));
    const messages: unknown[] = [];
    child.on('message', (message: unknown) => messages.push(message));
    child.postMessage({ type: 'lock', reason: 'os_locked', seq: 1 });
    await settle();
    const applied: string[] = [];
    host.bridge.onLock((reason) => applied.push(reason));
    child.postMessage({ type: 'lock', reason: 'suspend', seq: 2 });
    await settle();
    expect(applied).toEqual(['suspend']);
    expect(messages).toEqual([
      { type: 'lock-ack', seq: 1 },
      { type: 'lock-ack', seq: 2 },
    ]);
  });

  it('bloqueio que falha ao aplicar não é confirmado (o principal reinicia o servidor)', async () => {
    const host = createHostBridge();
    host.bridge.onLock(() => {
      throw new Error('estado quebrado');
    });
    const child = new FakeUtilityChild((parent) => runNextHost(parent, () => new Promise(() => undefined), () => undefined, host));
    const messages: unknown[] = [];
    child.on('message', (message: unknown) => messages.push(message));
    child.postMessage({ type: 'lock', reason: 'os_locked', seq: 1 });
    await settle();
    expect(messages).toEqual([]);
  });

  it('uso de verdade chega pela ponte; a configuração entrega o tempo sem uso antes de carregar', async () => {
    const host = createHostBridge();
    let activity = 0;
    host.bridge.onActivity(() => activity++);
    let idleAtLoad: number | undefined = -1;
    const child = new FakeUtilityChild((parent) =>
      runNextHost(
        parent,
        () => {
          idleAtLoad = host.bridge.idleMs;
          return new Promise(() => undefined);
        },
        () => undefined,
        host,
      ),
    );
    child.postMessage({ type: 'activity' });
    child.postMessage({ ...CONFIG, idleMs: 3_000 });
    await settle();
    expect(activity).toBe(1);
    expect(idleAtLoad).toBe(3_000);
  });

  it('cofre: o pedido vai ao principal e a resposta volta para quem pediu; sem resposta a tempo, falha', async () => {
    const host = createHostBridge({ vaultTimeoutMs: 50 });
    const child = new FakeUtilityChild((parent) => runNextHost(parent, () => new Promise(() => undefined), () => undefined, host));
    const requests: { type: string; id: number; op: string; key?: string }[] = [];
    child.on('message', (message: { type: string; id: number; op: string; key?: string }) => {
      if (message.type !== 'vault') return;
      requests.push(message);
      if (message.op === 'status') child.postMessage({ type: 'vault-reply', id: message.id, ok: true, anthropicKey: 'absent' });
    });
    await settle();
    expect(await host.bridge.vault.status()).toEqual({ ok: true, anthropicKey: 'absent' });
    // O principal não responde a este: o pedido falha pelo prazo.
    expect(await host.bridge.vault.setAnthropicKey('chave')).toEqual({ ok: false, anthropicKey: 'unknown', problem: 'failed' });
    expect(requests.map((request) => [request.op, request.key])).toEqual([
      ['status', undefined],
      ['set-anthropic-key', 'chave'],
    ]);
    // Resposta atrasada, de um pedido que já falhou, não faz nada.
    child.postMessage({ type: 'vault-reply', id: requests[1]?.id ?? 0, ok: true, anthropicKey: 'present' });
    await settle();
  });

  it('teto do dia: o pedido vai ao principal e só a resposta do mesmo tipo vale', async () => {
    const host = createHostBridge({ vaultTimeoutMs: 50 });
    const child = new FakeUtilityChild((parent) => runNextHost(parent, () => new Promise(() => undefined), () => undefined, host));
    const day = { dayKey: '2026-10-19', spentPUsd: 5, reservedPUsd: 0, limitPUsd: 2_000_000_000_000 };
    const requests: { type: string; id: number; op: string; limitPUsd?: number }[] = [];
    child.on('message', (message: { type: string; id: number; op: string; limitPUsd?: number }) => {
      if (message.type !== 'spend') return;
      requests.push(message);
      if (message.op === 'set-limit') child.postMessage({ type: 'spend-reply', id: message.id, ok: true, day });
      // Resposta de outro tipo com o mesmo id: ignorada (o pedido falha pelo prazo).
      else child.postMessage({ type: 'vault-reply', id: message.id, ok: true, anthropicKey: 'present' });
    });
    await settle();
    expect(await host.bridge.spend.setDailyLimit(2_000_000_000_000)).toEqual({ ok: true, day });
    expect(await host.bridge.spend.status()).toEqual({ ok: false, problem: 'failed' });
    expect(requests.map((request) => [request.op, request.limitPUsd])).toEqual([
      ['set-limit', 2_000_000_000_000],
      ['status', undefined],
    ]);
  });

  it('cofre sem ligação com o principal: falha na hora', async () => {
    const host = createHostBridge();
    expect(await host.bridge.vault.clearAnthropicKey()).toEqual({ ok: false, anthropicKey: 'unknown', problem: 'failed' });
  });

  it('a ponte é congelada e aceita um só ouvinte de cada', () => {
    const { bridge } = createHostBridge();
    expect(Object.isFrozen(bridge)).toBe(true);
    bridge.onLock(() => undefined);
    expect(() => bridge.onLock(() => undefined)).toThrow();
    bridge.onActivity(() => undefined);
    expect(() => bridge.onActivity(() => undefined)).toThrow();
  });

  it('falha ao carregar vira mensagem `failed` com o motivo', async () => {
    const { child, messages } = hostWith(() => Promise.reject(new Error('falta o build')));
    child.postMessage(CONFIG);
    await settle();
    expect(messages).toEqual([{ type: 'failed', message: expect.stringContaining('falta o build') as string }]);
  });

  it('pedido antes de pronto, ou inválido, recebe erro pelo próprio port', async () => {
    const { child } = hostWith(() => new Promise(() => undefined));
    const early = createFakeChannel();
    const early2 = mainSide(early.port1);
    child.postMessage({ type: 'request', meta: GET }, [early.port2]);
    const invalid = createFakeChannel();
    const invalid2 = mainSide(invalid.port1);
    child.postMessage({ type: 'request', meta: { ...GET, url: 'https://atacante.example/' } }, [invalid.port2]);
    await settle();
    expect(early2.received).toEqual([{ type: 'error' }]);
    expect(invalid2.received).toEqual([{ type: 'error' }]);
  });

  it('atende o pedido depois de pronto', async () => {
    const { child } = hostWith(() => Promise.resolve({ serve: okServe, prepareMs: 1 }));
    child.postMessage(CONFIG);
    await settle();
    const { port1, port2 } = createFakeChannel();
    const main = mainSide(port1);
    child.postMessage({ type: 'request', meta: GET }, [port2]);
    await settle();
    expect(main.received[0]).toMatchObject({ type: 'head', status: 200 });
    expect(new TextDecoder().decode(main.received[1]?.chunk)).toBe('ok');
    expect(main.received[2]).toEqual({ type: 'end' });
  });
});

describe('servidor da interface: resposta em pedaços com crédito', () => {
  /** Resposta com `count` pedaços de `size` bytes, contando quantos o Next "produziu". */
  function counting(count: number, size: number) {
    let produced = 0;
    let cancelled = false;
    const serve: Serve = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (produced === count) controller.close();
              else {
                produced++;
                controller.enqueue(new Uint8Array(size).fill(produced));
              }
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      );
    return {
      serve,
      get produced() {
        return produced;
      },
      get cancelled() {
        return cancelled;
      },
    };
  }

  it('manda no máximo a janela de crédito sem confirmação e continua a cada ack', async () => {
    const source = counting(20, 10);
    const { port1, port2 } = createFakeChannel();
    const main = mainSide(port1);
    void serveOverPort(source.serve, GET, wrapPort(port2));
    await settle(30);
    expect(main.chunks()).toBe(CREDIT_WINDOW);
    main.ack(3);
    await settle(30);
    expect(main.chunks()).toBe(CREDIT_WINDOW + 3);
    main.ack(20);
    await settle(60);
    expect(main.chunks()).toBe(20);
    expect(main.received.at(-1)).toEqual({ type: 'end' });
  });

  it('ack a mais, chegando com a janela cheia, não acumula crédito', async () => {
    const source = counting(30, 10);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    // Os acks chegam enquanto o Next ainda prepara a resposta (crédito cheio).
    const serve: Serve = async (request) => {
      await gate;
      return source.serve(request);
    };
    const { port1, port2 } = createFakeChannel();
    const main = mainSide(port1);
    void serveOverPort(serve, GET, wrapPort(port2));
    main.ack(100);
    await settle(120);
    open();
    await settle(40);
    expect(main.chunks()).toBe(CREDIT_WINDOW);
  });

  it('fatia pedaços grandes em partes de no máximo 64 KiB', async () => {
    const serve: Serve = () => Promise.resolve(new Response(new Uint8Array(MAX_CHUNK_BYTES * 2 + 5).fill(7)));
    const { port1, port2 } = createFakeChannel();
    const main = mainSide(port1);
    main.ack(10);
    void serveOverPort(serve, GET, wrapPort(port2));
    await settle(30);
    const sizes = main.received.filter((m) => m.type === 'chunk').map((m) => m.chunk?.byteLength);
    expect(sizes).toEqual([MAX_CHUNK_BYTES, MAX_CHUNK_BYTES, 5]);
  });

  it('cancelar aborta o pedido e para de ler o corpo', async () => {
    const source = counting(1000, 10);
    let signal: AbortSignal | null = null;
    const serve: Serve = (request) => {
      signal = request.signal;
      return source.serve(request);
    };
    const { port1, port2 } = createFakeChannel();
    const main = mainSide(port1);
    void serveOverPort(serve, GET, wrapPort(port2));
    await settle(20);
    main.cancel();
    await settle(20);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(source.cancelled).toBe(true);
    expect(source.produced).toBeLessThan(20);
    expect(main.received.some((m) => m.type === 'end')).toBe(false);
  });

  it('o principal fechar o port também cancela', async () => {
    const source = counting(1000, 10);
    const { port1, port2 } = createFakeChannel();
    mainSide(port1);
    void serveOverPort(source.serve, GET, wrapPort(port2));
    await settle(20);
    port1.close();
    await settle(20);
    expect(source.cancelled).toBe(true);
  });

  it('mensagem desconhecida no port do pedido também encerra (falha fechada)', async () => {
    const source = counting(1000, 10);
    const { port1, port2 } = createFakeChannel();
    mainSide(port1);
    void serveOverPort(source.serve, GET, wrapPort(port2));
    await settle(20);
    port1.postMessage({ type: 'ack', credits: 1_000 });
    await settle(20);
    expect(source.cancelled).toBe(true);
  });

  it('erro do servidor antes ou durante o corpo vira `error`, sem detalhe', async () => {
    const throwing: Serve = () => Promise.reject(new Error('segredo do servidor'));
    const first = createFakeChannel();
    const main1 = mainSide(first.port1);
    void serveOverPort(throwing, GET, wrapPort(first.port2));

    const midway: Serve = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              controller.error(new Error('caiu no meio'));
            },
          }),
        ),
      );
    const second = createFakeChannel();
    const main2 = mainSide(second.port1);
    main2.ack(5);
    void serveOverPort(midway, GET, wrapPort(second.port2));
    await settle(20);
    expect(main1.received).toEqual([{ type: 'error' }]);
    expect(main2.received.at(-1)).toEqual({ type: 'error' });
    expect(JSON.stringify(main1.received)).not.toContain('segredo');
  });

  it('o corpo de um POST chega ao servidor', async () => {
    let seen = '';
    const serve: Serve = async (request) => {
      seen = await request.text();
      return new Response(null, { status: 204 });
    };
    const { port1, port2 } = createFakeChannel();
    const main = mainSide(port1);
    const body = new TextEncoder().encode('["senha"]');
    void serveOverPort(serve, { ...GET, method: 'POST', body }, wrapPort(port2));
    await settle(20);
    expect(seen).toBe('["senha"]');
    expect(main.received).toEqual([{ type: 'head', status: 204, statusText: '', headers: [] }, { type: 'end' }]);
  });
});
