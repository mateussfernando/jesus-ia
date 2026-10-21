import { afterEach, describe, expect, it } from 'vitest';
import { createFakeChannel, FakeMessagePort, FakeUtilityChild } from '../bridge/fake-ipc';
import { CREDIT_WINDOW, MAX_REQUEST_BODY_BYTES } from '../bridge/protocol';
import type { ParentPortLike } from '../bridge/ports';
import { runNextHost } from '../next-host/host';
import type { LoadServer, Serve } from '../next-host/host';
import { pageHeaders, readBodyLimited, startUiServer, statusPage } from './ui-server';
import type { UiServer, UiServerEvent, UiServerTiming } from './ui-server';

const APP = 'https://jesus.invalid';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await tick();
}
async function until(check: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condição não aconteceu a tempo');
    await sleep(2);
  }
}

const FAST: Partial<UiServerTiming> = {
  readyTimeoutMs: 1_000,
  waitReadyMs: 500,
  headTimeoutMs: 500,
  restartDelaysMs: [5, 10],
  maxConsecutiveFailures: 3,
};

const running: UiServer[] = [];
afterEach(() => {
  for (const server of running.splice(0)) server.stop();
});

interface Setup {
  readonly serve?: Serve;
  readonly load?: LoadServer;
  readonly run?: (parent: ParentPortLike) => void;
  readonly fork?: () => FakeUtilityChild;
  readonly timing?: Partial<UiServerTiming>;
}

function setup(options: Setup = {}) {
  const events: UiServerEvent[] = [];
  const children: FakeUtilityChild[] = [];
  const serve = options.serve ?? (() => Promise.resolve(new Response('ok')));
  const load = options.load ?? (() => Promise.resolve({ serve, prepareMs: 5 }));
  const run = options.run ?? ((parent: ParentPortLike) => runNextHost(parent, load, () => undefined));
  const server = startUiServer({
    fork:
      options.fork ??
      (() => {
        const child = new FakeUtilityChild(run);
        children.push(child);
        return child;
      }),
    createChannel: createFakeChannel,
    config: { uiDir: '/app/ui', dataDir: '/dados' },
    onEvent: (event) => events.push(event),
    timing: { ...FAST, ...options.timing },
  });
  running.push(server);
  return { server, events, children };
}

/** Corpo que o "Next" produz sob demanda, contando quanto já produziu. */
function producer(count: number, size: number) {
  const state = { produced: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.produced === count) controller.close();
      else {
        state.produced++;
        controller.enqueue(new Uint8Array(size).fill(state.produced % 256));
      }
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { state, body };
}

describe('ponte do principal com o servidor da interface', () => {
  it('atende GET com status, vários Set-Cookie e corpo', async () => {
    const { server } = setup({
      serve: () =>
        Promise.resolve(
          new Response('olá, Jesus', {
            status: 200,
            headers: [
              ['content-type', 'text/html; charset=utf-8'],
              ['set-cookie', 'a=1; Path=/; HttpOnly'],
              ['set-cookie', 'b=2; Path=/; Secure'],
            ],
          }),
        ),
    });
    await server.whenReady();
    const response = await server.serve(new Request(`${APP}/entrar/`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; Secure']);
    expect(await response.text()).toBe('olá, Jesus');
  });

  it('POST leva o corpo; acima de 2 MB é 413 e nem chega ao servidor', async () => {
    const bodies: string[] = [];
    const { server } = setup({
      serve: async (request) => {
        bodies.push(await request.text());
        return new Response(null, { status: 204 });
      },
    });
    await server.whenReady();
    const ok = await server.serve(new Request(`${APP}/entrar/`, { method: 'POST', body: '["senha"]' }));
    expect(ok.status).toBe(204);
    expect(ok.body).toBeNull();
    const big = await server.serve(
      new Request(`${APP}/entrar/`, { method: 'POST', body: new Uint8Array(MAX_REQUEST_BODY_BYTES + 1) }),
    );
    expect(big.status).toBe(413);
    const declared = await server.serve(
      new Request(`${APP}/entrar/`, {
        method: 'POST',
        body: 'x',
        headers: { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) },
      }),
    );
    expect(declared.status).toBe(413);
    expect(bodies).toEqual(['["senha"]']);
  });

  it('método fora da lista é 405 e endereço fora do app é 403', async () => {
    let calls = 0;
    const { server } = setup({
      serve: () => {
        calls++;
        return Promise.resolve(new Response('ok'));
      },
    });
    await server.whenReady();
    expect((await server.serve(new Request(`${APP}/`, { method: 'PUT', body: 'x' }))).status).toBe(405);
    expect((await server.serve(new Request(`${APP}/`, { method: 'OPTIONS' }))).status).toBe(405);
    expect((await server.serve(new Request('https://atacante.example/'))).status).toBe(403);
    expect((await server.serve(new Request('https://jesus.invalid:444/'))).status).toBe(403);
    expect(calls).toBe(0);
  });

  it('a página não manda x-action-forwarded (só o repasse interno do servidor)', async () => {
    let seen: Headers | null = null;
    const { server } = setup({
      serve: (request) => {
        seen = request.headers;
        return Promise.resolve(new Response('ok'));
      },
    });
    await server.whenReady();
    await server.serve(
      new Request(`${APP}/`, { method: 'POST', body: '[]', headers: { 'x-action-forwarded': '1', 'next-action': 'abc' } }),
    );
    const headers = seen as Headers | null;
    expect(headers?.get('x-action-forwarded')).toBeNull();
    expect(headers?.get('next-action')).toBe('abc');
  });

  it('HEAD sai sem corpo', async () => {
    const { server } = setup({ serve: () => Promise.resolve(new Response(null, { headers: { etag: '"1"' } })) });
    await server.whenReady();
    const response = await server.serve(new Request(`${APP}/`, { method: 'HEAD' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"1"');
    expect(response.body).toBeNull();
  });

  it('contrapressão de ponta a ponta: a janela parada segura o servidor', async () => {
    const source = producer(200, 1024);
    const { server } = setup({ serve: () => Promise.resolve(new Response(source.body)) });
    await server.whenReady();
    const response = await server.serve(new Request(`${APP}/`));
    const reader = response.body?.getReader();
    await reader?.read();
    await settle(60);
    // Em trânsito: a janela de crédito, a fila do principal e as filas dos streams; nunca o corpo inteiro.
    expect(source.state.produced).toBeLessThan(CREDIT_WINDOW + 8);
    let total = 1024;
    for (;;) {
      const next = await reader?.read();
      if (next === undefined || next.done) break;
      total += next.value.byteLength;
    }
    expect(total).toBe(200 * 1024);
  });

  it('a janela desistir do corpo cancela no servidor', async () => {
    const source = producer(10_000, 1024);
    const { server } = setup({ serve: () => Promise.resolve(new Response(source.body)) });
    await server.whenReady();
    const response = await server.serve(new Request(`${APP}/`));
    await response.body?.cancel();
    await until(() => source.state.cancelled);
    expect(source.state.produced).toBeLessThan(100);
  });

  it('servidor preso (vivo, sem responder): o vigia derruba, o pedido em andamento recebe 503 e o servidor volta', async () => {
    // O primeiro "processo" fica pronto e depois não responde a mais nada: nem ao sinal de vida, nem ao pedido.
    const stuck = (parent: ParentPortLike) => {
      parent.on('message', (event) => {
        if ((event.data as { type?: string }).type === 'config') parent.postMessage({ type: 'ready', prepareMs: 1 });
      });
    };
    const healthy = (parent: ParentPortLike) =>
      runNextHost(parent, () => Promise.resolve({ serve: () => Promise.resolve(new Response('de volta')), prepareMs: 1 }), () => undefined);
    const children: FakeUtilityChild[] = [];
    const { server, events } = setup({
      fork: () => {
        const child = new FakeUtilityChild(children.length === 0 ? stuck : healthy);
        children.push(child);
        return child;
      },
      timing: { pingIntervalMs: 10, pingTimeoutMs: 40, headTimeoutMs: 10_000 },
    });
    await server.whenReady();
    const pending = server.serve(new Request(`${APP}/`));
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(events).toContainEqual({ type: 'failed', reason: 'unresponsive', message: 'o servidor da interface parou de responder' });
    expect(children[0]?.exited).toBe(true);
    await until(() => events.some((event) => event.type === 'ready' && event.attempt === 2));
    expect(await (await server.serve(new Request(`${APP}/`))).text()).toBe('de volta');
  });

  it('servidor que responde ao sinal de vida não é derrubado, mesmo com um pedido demorado', async () => {
    const { server, events, children } = setup({
      serve: async () => {
        await sleep(200);
        return new Response('demorou');
      },
      timing: { pingIntervalMs: 10, pingTimeoutMs: 40 },
    });
    await server.whenReady();
    expect(await (await server.serve(new Request(`${APP}/`))).text()).toBe('demorou');
    expect(events.filter((event) => event.type === 'failed')).toEqual([]);
    expect(children[0]?.exited).toBe(false);
  });

  it('pedido ao cofre: o principal responde ao mesmo processo; sem quem atenda, falha', async () => {
    const replies: unknown[] = [];
    const answering = (parent: ParentPortLike) => {
      parent.on('message', (event) => {
        const data = event.data as { type?: string };
        if (data.type === 'config') {
          parent.postMessage({ type: 'ready', prepareMs: 1 });
          parent.postMessage({ type: 'vault', id: 7, op: 'status' });
        }
        if (data.type === 'vault-reply') replies.push(data);
      });
    };
    const children: FakeUtilityChild[] = [];
    const server = startUiServer({
      fork: () => {
        const child = new FakeUtilityChild(answering);
        children.push(child);
        return child;
      },
      createChannel: createFakeChannel,
      config: { uiDir: '/app/ui', dataDir: '/dados' },
      timing: FAST,
      onVaultRequest: (request) => Promise.resolve({ ok: true, anthropicKey: request.op === 'status' ? 'present' : 'absent' }),
    });
    running.push(server);
    await until(() => replies.length === 1);
    expect(replies).toEqual([{ type: 'vault-reply', id: 7, ok: true, anthropicKey: 'present' }]);
    const { server: plain } = setup({
      run: (parent) => {
        parent.on('message', (event) => {
          const data = event.data as { type?: string };
          if (data.type === 'config') {
            parent.postMessage({ type: 'ready', prepareMs: 1 });
            parent.postMessage({ type: 'vault', id: 1, op: 'status' });
          }
          if (data.type === 'vault-reply') replies.push(data);
        });
      },
    });
    await plain.whenReady();
    await until(() => replies.length === 2);
    expect(replies[1]).toEqual({ type: 'vault-reply', id: 1, ok: false, anthropicKey: 'unknown', problem: 'failed' });
  });

  it('pedido sobre o teto do dia: o principal responde ao mesmo processo; sem quem atenda, falha', async () => {
    const replies: unknown[] = [];
    const day = { dayKey: '2026-10-19', spentPUsd: 0, reservedPUsd: 0, limitPUsd: 1_000_000_000_000 };
    const asking = (parent: ParentPortLike) => {
      parent.on('message', (event) => {
        const data = event.data as { type?: string };
        if (data.type === 'config') {
          parent.postMessage({ type: 'ready', prepareMs: 1 });
          parent.postMessage({ type: 'spend', id: 4, op: 'status' });
        }
        if (data.type === 'spend-reply') replies.push(data);
      });
    };
    const server = startUiServer({
      fork: () => new FakeUtilityChild(asking),
      createChannel: createFakeChannel,
      config: { uiDir: '/app/ui', dataDir: '/dados' },
      timing: FAST,
      onSpendRequest: () => Promise.resolve({ ok: true, day }),
    });
    running.push(server);
    await until(() => replies.length === 1);
    expect(replies).toEqual([{ type: 'spend-reply', id: 4, ok: true, day }]);
    const { server: plain } = setup({ run: asking });
    await plain.whenReady();
    await until(() => replies.length === 2);
    expect(replies[1]).toEqual({ type: 'spend-reply', id: 4, ok: false, problem: 'failed' });
  });

  it('pedido de conversa: vai a quem atende com o processo que pediu, e a resposta volta só para ele', async () => {
    const replies: unknown[] = [];
    const conversationId = '0b6e3c1e-5f1a-4f7e-9c7a-2d9b1f4e6a80';
    const asking = (parent: ParentPortLike) => {
      parent.on('message', (event) => {
        const data = event.data as { type?: string };
        if (data.type === 'config') {
          parent.postMessage({ type: 'ready', prepareMs: 1 });
          parent.postMessage({ type: 'chat', id: 5, op: 'send', conversationId, text: 'Oi' });
        }
        if (data.type === 'chat-event') replies.push(data);
      });
    };
    const owners: object[] = [];
    const gone: object[] = [];
    const children: FakeUtilityChild[] = [];
    const server = startUiServer({
      fork: () => {
        const child = new FakeUtilityChild(asking);
        children.push(child);
        return child;
      },
      createChannel: createFakeChannel,
      config: { uiDir: '/app/ui', dataDir: '/dados' },
      timing: FAST,
      onChatRequest: (request, owner, reply) => {
        owners.push(owner);
        expect(request).toEqual({ type: 'chat', id: 5, op: 'send', conversationId, text: 'Oi' });
        reply({ kind: 'delta', text: 'Olá' });
      },
      onServerGone: (owner) => gone.push(owner),
    });
    running.push(server);
    await until(() => replies.length === 1);
    expect(replies).toEqual([{ type: 'chat-event', id: 5, event: { kind: 'delta', text: 'Olá' } }]);
    // O processo cai: quem atende a conversa fica sabendo qual processo foi.
    children[0]?.kill();
    await until(() => gone.length === 1);
    expect(gone[0]).toBe(owners[0]);
    server.stop();

    // Sem quem atenda: a conversa fica indisponível.
    const plainReplies: unknown[] = [];
    const { server: plain } = setup({
      run: (parent) => {
        parent.on('message', (event) => {
          const data = event.data as { type?: string };
          if (data.type === 'config') {
            parent.postMessage({ type: 'ready', prepareMs: 1 });
            parent.postMessage({ type: 'chat', id: 6, op: 'get' });
            parent.postMessage({ type: 'chat', id: 6, op: 'stop' });
          }
          if (data.type === 'chat-event') plainReplies.push(data);
        });
      },
    });
    await plain.whenReady();
    await until(() => plainReplies.length === 1);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    // O `stop` não tem resposta.
    expect(plainReplies).toEqual([{ type: 'chat-event', id: 6, event: { kind: 'error', reason: 'unavailable' } }]);
  });

  it('pong fora de ordem é fuga do protocolo: o processo cai e sobe de novo', async () => {
    const children: FakeUtilityChild[] = [];
    const { server, events } = setup({
      fork: () => {
        const child = new FakeUtilityChild((parent) => {
          parent.on('message', (event) => {
            if ((event.data as { type?: string }).type !== 'config') return;
            parent.postMessage({ type: 'ready', prepareMs: 1 });
            if (children.length === 1) parent.postMessage({ type: 'pong', seq: 999 });
          });
        });
        children.push(child);
        return child;
      },
    });
    await server.whenReady();
    await until(() => events.some((event) => event.type === 'failed' && event.reason === 'invalid-message'));
    expect(children[0]?.exited).toBe(true);
  });

  it('processo que sai logo depois de mandar a resposta: ela nunca chega inteira (o exit vem antes das mensagens)', async () => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pulls = 0;
    const { server, events, children } = setup({
      serve: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                pulls++;
                if (pulls === 1) controller.enqueue(new TextEncoder().encode('parte'));
                else {
                  await released;
                  controller.close();
                }
              },
            }),
          ),
        ),
    });
    await server.whenReady();
    // Derruba o processo assim que ele manda o cabeçalho ou o fim pelo port, antes de a mensagem chegar ao principal.
    let crashOn = 'head';
    const post = Object.getOwnPropertyDescriptor(FakeMessagePort.prototype, 'postMessage')?.value as FakeMessagePort['postMessage'];
    FakeMessagePort.prototype.postMessage = function (this: FakeMessagePort, message: unknown) {
      post.call(this, message);
      if ((message as { type?: string }).type === crashOn) children.at(-1)?.crash(1);
    };
    try {
      // Sem cabeçalho ainda: 503 que se recarrega sozinho.
      const early = await server.serve(new Request(`${APP}/`));
      expect(early.status).toBe(503);
      await until(() => events.filter((event) => event.type === 'ready').length === 2);
      // Com o corpo começado: o fim nunca chega antes do exit, e o corpo falha.
      crashOn = 'end';
      pulls = 0;
      const response = await server.serve(new Request(`${APP}/`));
      expect(response.status).toBe(200);
      release();
      await expect(response.text()).rejects.toThrow();
    } finally {
      FakeMessagePort.prototype.postMessage = post;
    }
  });

  it('parar logo depois de subir: o processo morre quando sobe (no Electron, kill antes do spawn não faz nada)', async () => {
    const { server, events, children } = setup();
    server.stop();
    expect(children[0]?.spawned).toBe(false);
    await until(() => children[0]?.exited === true);
    expect(events.some((event) => event.type === 'ready')).toBe(false);
  });

  it('se o sinal da janela abortar antes do cabeçalho, o servidor cancela (no Electron 44 o protocol.handle não aborta)', async () => {
    let signal: AbortSignal | null = null;
    const { server } = setup({
      serve: (request) => {
        signal = request.signal;
        return new Promise(() => undefined);
      },
    });
    await server.whenReady();
    const controller = new AbortController();
    const pending = server.serve(new Request(`${APP}/`, { signal: controller.signal }));
    await until(() => signal !== null);
    controller.abort();
    await pending;
    await until(() => (signal as AbortSignal | null)?.aborted === true);
  });

  it('pedido espera o servidor ficar pronto', async () => {
    const { server } = setup({
      load: async () => {
        await sleep(30);
        return { serve: () => Promise.resolve(new Response('pronto')), prepareMs: 30 };
      },
    });
    const response = await server.serve(new Request(`${APP}/`));
    expect(await response.text()).toBe('pronto');
  });

  it('servidor que não fica pronto a tempo: 503 que se recarrega sozinho, sem script', async () => {
    const { server } = setup({ load: () => new Promise(() => undefined), timing: { waitReadyMs: 30 } });
    const response = await server.serve(new Request(`${APP}/`));
    expect(response.status).toBe(503);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('http-equiv="refresh"');
    expect(html).not.toContain('<script');
  });

  it('demora no cabeçalho dá 504 e cancela no servidor', async () => {
    let signal: AbortSignal | null = null;
    const { server } = setup({
      serve: (request) => {
        signal = request.signal;
        return new Promise(() => undefined);
      },
      timing: { headTimeoutMs: 40 },
    });
    await server.whenReady();
    const response = await server.serve(new Request(`${APP}/`));
    expect(response.status).toBe(504);
    await until(() => (signal as AbortSignal | null)?.aborted === true);
  });

  it('processo caiu: pedido sem cabeçalho dá 503, corpo no meio falha, e o servidor volta sozinho', async () => {
    let release: () => void = () => undefined;
    const { server, events, children } = setup({
      serve: (request) => {
        const path = new URL(request.url).pathname;
        if (path === '/trava/') return new Promise(() => undefined);
        if (path === '/meio/') {
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                async start(controller) {
                  controller.enqueue(new TextEncoder().encode('começo'));
                  await new Promise<void>((resolve) => {
                    release = resolve;
                  });
                },
              }),
            ),
          );
        }
        return Promise.resolve(new Response('de volta'));
      },
    });
    await server.whenReady();
    const stuck = server.serve(new Request(`${APP}/trava/`));
    const midway = await server.serve(new Request(`${APP}/meio/`));
    const reader = midway.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe('começo');
    await settle();
    children[0]?.crash(1);
    expect((await stuck).status).toBe(503);
    await expect(reader?.read()).rejects.toThrow();
    release();
    await until(() => events.filter((e) => e.type === 'ready').length === 2);
    expect(events).toContainEqual({ type: 'exited', code: 1, inflight: 2 });
    expect(events).toContainEqual({ type: 'restarting', delayMs: 5, failures: 1 });
    expect(await (await server.serve(new Request(`${APP}/`))).text()).toBe('de volta');
  });

  it('falha ao carregar: reinicia com espera e desiste depois de quedas seguidas', async () => {
    const { server, events } = setup({ load: () => Promise.reject(new Error('falta o build')) });
    await expect(server.whenReady()).rejects.toThrow('não conseguiu iniciar');
    expect(events.filter((e) => e.type === 'failed')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'restarting').map((e) => (e.type === 'restarting' ? e.delayMs : 0))).toEqual([5, 10]);
    expect(events.at(-1)).toEqual({ type: 'gave-up', failures: 3 });
    const response = await server.serve(new Request(`${APP}/`));
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toContain('não conseguiu iniciar');
    expect(html).not.toContain('refresh');
  });

  it('processo que não fica pronto a tempo é derrubado e conta como queda', async () => {
    const { events, children } = setup({ load: () => new Promise(() => undefined), timing: { readyTimeoutMs: 20 } });
    await until(() => events.some((e) => e.type === 'gave-up'));
    expect(events.filter((e) => e.type === 'failed' && e.reason === 'ready-timeout')).toHaveLength(3);
    expect(children.every((child) => child.exited)).toBe(true);
  });

  it('fork que lança conta como queda', async () => {
    const { server, events } = setup({
      fork: () => {
        throw new Error('sem memória');
      },
    });
    await expect(server.whenReady()).rejects.toThrow();
    expect(events.filter((e) => e.type === 'failed' && e.reason === 'fork-error')).toHaveLength(3);
  });

  it('mensagem fora do protocolo no parentPort derruba o processo', async () => {
    const { events, children } = setup({
      run: (parent) => parent.postMessage({ type: 'ready', prepareMs: 1, extra: 'campo a mais' }),
    });
    await until(() => events.some((e) => e.type === 'failed' && e.reason === 'invalid-message'));
    await until(() => children[0]?.exited === true);
  });

  it('stop derruba o processo e passa a responder 503 sem recarregar', async () => {
    const { server, children } = setup();
    await server.whenReady();
    server.stop();
    await until(() => children[0]?.exited === true);
    const response = await server.serve(new Request(`${APP}/`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('refresh');
  });
});

describe('ponte do principal: servidor que foge do protocolo', () => {
  /** Servidor "invasor": responde cada pedido com as mensagens dadas, sem respeitar nada. */
  function rogue(reply: (port: FakeMessagePort) => void) {
    return (parent: ParentPortLike) => {
      parent.on('message', (event) => {
        const data = event.data as { type?: string };
        if (data.type === 'config') parent.postMessage({ type: 'ready', prepareMs: 1 });
        const port = event.ports[0] as FakeMessagePort | undefined;
        if (data.type === 'request' && port !== undefined) {
          port.start();
          reply(port);
        }
      });
    };
  }

  it('pedaço antes do cabeçalho, ou mensagem desconhecida: 502', async () => {
    const first = setup({ run: rogue((port) => port.postMessage({ type: 'chunk', chunk: new Uint8Array([1]) })) });
    await first.server.whenReady();
    expect((await first.server.serve(new Request(`${APP}/`))).status).toBe(502);
    expect(first.events).toContainEqual({ type: 'invalid-response' });

    const second = setup({ run: rogue((port) => port.postMessage({ type: 'head', status: 200, headers: {} })) });
    await second.server.whenReady();
    expect((await second.server.serve(new Request(`${APP}/`))).status).toBe(502);
  });

  it('mais pedaços do que os créditos permitem: o corpo falha', async () => {
    const { server, events } = setup({
      run: rogue((port) => {
        port.postMessage({ type: 'head', status: 200, statusText: 'OK', headers: [] });
        for (let i = 0; i < CREDIT_WINDOW * 4; i++) port.postMessage({ type: 'chunk', chunk: new Uint8Array(10) });
      }),
    });
    await server.whenReady();
    const response = await server.serve(new Request(`${APP}/`));
    expect(response.status).toBe(200);
    // Ninguém lê: o principal não confirma, e o servidor manda além da janela.
    await until(() => events.some((e) => e.type === 'invalid-response'));
    await expect(response.text()).rejects.toThrow();
  });

  it('port fechado antes do fim: o corpo falha (resposta truncada nunca passa por inteira)', async () => {
    const { server } = setup({
      run: rogue((port) => {
        port.postMessage({ type: 'head', status: 200, statusText: 'OK', headers: [] });
        port.postMessage({ type: 'chunk', chunk: new Uint8Array([65]) });
        port.close();
      }),
    });
    await server.whenReady();
    const response = await server.serve(new Request(`${APP}/`));
    await expect(response.text()).rejects.toThrow();
  });

  it('erro no servidor antes do cabeçalho dá 500 sem detalhe', async () => {
    const { server } = setup({ run: rogue((port) => port.postMessage({ type: 'error' })) });
    await server.whenReady();
    const response = await server.serve(new Request(`${APP}/`));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Erro interno');
  });
});

describe('ponte do principal: peças soltas', () => {
  it('statusPage sem script e com cabeçalhos de segurança', async () => {
    const page = statusPage(404, { text: 'Não achei.' });
    expect(page.status).toBe(404);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(await page.text()).toContain('<p>Não achei.</p>');
  });

  it('pageHeaders respeita os limites', () => {
    const many = new Headers();
    for (let i = 0; i < 200; i++) many.set(`x-${String(i)}`, 'v');
    expect(pageHeaders(many)).toBeNull();
    expect(pageHeaders(new Headers({ accept: 'text/html' }))).toEqual([['accept', 'text/html']]);
  });

  it('readBodyLimited para no limite e junta os pedaços', async () => {
    const stream = (parts: number[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const size of parts) controller.enqueue(new Uint8Array(size).fill(1));
          controller.close();
        },
      });
    expect(await readBodyLimited(stream([3, 4]), 10)).toEqual(new Uint8Array(7).fill(1));
    expect(await readBodyLimited(stream([6, 6]), 10)).toBe('too-large');
    expect(await readBodyLimited(null, 10)).toEqual(new Uint8Array(0));
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('quebrou'));
      },
    });
    expect(await readBodyLimited(broken, 10)).toBe('unreadable');
  });
});
