import { afterEach, describe, expect, it } from 'vitest';
import { BRAIN_KEY_PLACEHOLDER, parseToBrain } from '../bridge/brain-protocol';
import type { EgressFailure, ToBrainMessage } from '../bridge/brain-protocol';
import { FakeUtilityChild } from '../bridge/fake-ipc';
import type { ParentPortLike } from '../bridge/ports';
import { startBrainProcess } from './brain-process';
import type { EgressSink } from './egress/egress';
import type { ApiRequestInput } from './egress/api-policy';
import type { Supervisor, SupervisorEvent, SupervisorTiming } from './supervisor';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condição não aconteceu a tempo');
    await sleep(2);
  }
}

const FAST: Partial<SupervisorTiming> = {
  readyTimeoutMs: 300,
  restartDelaysMs: [5, 10],
  maxConsecutiveFailures: 3,
  pingIntervalMs: 20,
  pingTimeoutMs: 100,
};

const running: Supervisor[] = [];
afterEach(() => {
  for (const supervisor of running.splice(0)) supervisor.stop();
});

/** Um "Cérebro" de teste: responde ao ping, avisa que está pronto e guarda o que recebe. */
function fakeBrain(options: { ready?: boolean; pong?: boolean } = {}) {
  const received: ToBrainMessage[] = [];
  let parent: ParentPortLike | null = null;
  const run = (port: ParentPortLike) => {
    parent = port;
    port.on('message', (event) => {
      const message = parseToBrain(event.data);
      if (message === null) return;
      if (message.type === 'ping') {
        if (options.pong !== false) port.postMessage({ type: 'pong', seq: message.seq });
        return;
      }
      received.push(message);
    });
    if (options.ready !== false) port.postMessage({ type: 'ready', prepareMs: 3 });
  };
  return {
    run,
    received,
    send: (message: unknown) => parent?.postMessage(message),
  };
}

function apiRequest(id: number): Record<string, unknown> {
  return {
    type: 'api-request',
    id,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: [['x-api-key', BRAIN_KEY_PLACEHOLDER]],
    body: '{}',
  };
}

function setup(brainOptions: { ready?: boolean; pong?: boolean } = {}) {
  const brains: ReturnType<typeof fakeBrain>[] = [];
  const children: FakeUtilityChild[] = [];
  const sent: { input: ApiRequestInput; sink: EgressSink; cancelled: boolean }[] = [];
  const cancelAll: string[] = [];
  const events: SupervisorEvent[] = [];
  const supervisor = startBrainProcess({
    fork: () => {
      const brain = fakeBrain(brainOptions);
      brains.push(brain);
      const child = new FakeUtilityChild(brain.run);
      children.push(child);
      return child;
    },
    egress: {
      send(input, sink) {
        const entry = { input, sink, cancelled: false };
        sent.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
      cancelAll(reason) {
        cancelAll.push(reason);
      },
    },
    onEvent: (event) => events.push(event),
    timing: FAST,
  });
  running.push(supervisor);
  return { supervisor, brains, children, sent, cancelAll, events };
}

describe('startBrainProcess', () => {
  it('sobe o Cérebro, vigia a vida e entrega cada pedido à saída', async () => {
    const { supervisor, brains, sent, events } = setup();
    await supervisor.whenReady();
    expect(events.map((event) => event.type)).toEqual(['starting', 'ready']);
    brains[0]?.send(apiRequest(1));
    await until(() => sent.length === 1);
    expect(sent[0]?.input).toMatchObject({ url: 'https://api.anthropic.com/v1/messages', method: 'POST', body: '{}' });

    // A resposta da saída volta ao Cérebro pelas mensagens api-* com o mesmo id.
    const sink = sent[0]?.sink;
    sink?.head(200, [['content-type', 'text/event-stream']]);
    sink?.chunk(new TextEncoder().encode('data: 1\n\n'));
    sink?.end();
    await until(() => (brains[0]?.received.length ?? 0) === 3);
    expect(brains[0]?.received.map((message) => message.type)).toEqual(['api-head', 'api-chunk', 'api-end']);
    // O vigia mandou ping e recebeu pong: o processo segue o mesmo.
    await sleep(150);
    expect(events.filter((event) => event.type === 'failed')).toEqual([]);
  });

  it('recusa da saída volta como api-error', async () => {
    const { supervisor, brains, sent } = setup();
    await supervisor.whenReady();
    brains[0]?.send(apiRequest(1));
    await until(() => sent.length === 1);
    const reason: EgressFailure = 'over_budget';
    sent[0]?.sink.fail(reason);
    await until(() => (brains[0]?.received.length ?? 0) === 1);
    expect(brains[0]?.received[0]).toEqual({ type: 'api-error', id: 1, reason: 'over_budget' });
  });

  it('o Cérebro desiste: a saída cancela', async () => {
    const { supervisor, brains, sent } = setup();
    await supervisor.whenReady();
    brains[0]?.send(apiRequest(1));
    await until(() => sent.length === 1);
    brains[0]?.send({ type: 'api-cancel', id: 1 });
    await until(() => sent[0]?.cancelled === true);
  });

  it('id repetido ou mensagem fora do protocolo derrubam o Cérebro, que sobe de novo', async () => {
    const { supervisor, brains, children, events, cancelAll } = setup();
    await supervisor.whenReady();
    brains[0]?.send(apiRequest(1));
    brains[0]?.send(apiRequest(1));
    await until(() => children.length === 2 && events.filter((event) => event.type === 'ready').length === 2);
    expect(events).toContainEqual({ type: 'failed', reason: 'protocol', message: 'pedido à API com id repetido' });
    expect(cancelAll).toContain('brain_gone');

    brains[1]?.send({ ...apiRequest(2), headers: [['x-api-key', 'a'.repeat(20_000)]] });
    await until(() => children.length === 3);
    expect(events).toContainEqual({ type: 'failed', reason: 'invalid-message', message: 'mensagem fora do protocolo' });
  });

  it('erro do principal ao atender derruba só o Cérebro, nunca o principal', async () => {
    const events: SupervisorEvent[] = [];
    const children: FakeUtilityChild[] = [];
    const brains: ReturnType<typeof fakeBrain>[] = [];
    const supervisor = startBrainProcess({
      fork: () => {
        const brain = fakeBrain();
        brains.push(brain);
        const child = new FakeUtilityChild(brain.run);
        children.push(child);
        return child;
      },
      egress: {
        send() {
          throw new Error('defeito na saída');
        },
        cancelAll: () => undefined,
      },
      onEvent: (event) => events.push(event),
      timing: FAST,
    });
    running.push(supervisor);
    await supervisor.whenReady();
    brains[0]?.send(apiRequest(1));
    await until(() => children.length === 2);
    expect(events).toContainEqual({ type: 'failed', reason: 'protocol', message: 'erro ao atender a mensagem: defeito na saída' });
  });

  it('Cérebro preso (sem pong) é derrubado e sobe de novo', async () => {
    const { supervisor, children, events } = setup({ pong: false });
    await supervisor.whenReady();
    await until(() => children.length >= 2, 3_000);
    expect(events).toContainEqual({ type: 'failed', reason: 'unresponsive', message: 'o processo parou de responder' });
  });

  it('pedido antes de ficar pronto é fuga do protocolo', async () => {
    const { brains, children, events } = setup({ ready: false });
    await until(() => brains.length === 1);
    await sleep(5);
    brains[0]?.send(apiRequest(1));
    await until(() => children.length === 2);
    expect(events).toContainEqual({ type: 'failed', reason: 'invalid-message', message: 'mensagem antes de ficar pronto' });
  });

  it('desiste depois de quedas seguidas', async () => {
    const { supervisor, events } = setup({ ready: false });
    await expect(supervisor.whenReady()).rejects.toThrow();
    expect(events.at(-1)).toEqual({ type: 'gave-up', failures: 3 });
  });

  it('parar derruba o processo e cancela o que estava com ele', async () => {
    const { supervisor, children, cancelAll } = setup();
    await supervisor.whenReady();
    supervisor.stop();
    await until(() => children[0]?.exited === true);
    expect(cancelAll).toEqual(['brain_gone']);
    expect(supervisor.post({ type: 'ping', seq: 1 })).toBe(false);
  });
});
