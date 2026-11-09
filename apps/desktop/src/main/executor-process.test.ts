import { afterEach, describe, expect, it } from 'vitest';
import type { runTool, ToolOutcome } from '@jesus/executor';
import type { ToolPolicy } from '../bridge/executor-protocol';
import { FakeUtilityChild } from '../bridge/fake-ipc';
import type { ParentPortLike } from '../bridge/ports';
import { runExecutorHost } from '../executor-host/executor';
import { CANCELLED, startExecutorProcess, TIMED_OUT, UNAVAILABLE } from './executor-process';
import type { ExecutorProcess, ExecutorTiming } from './executor-process';
import type { SupervisorEvent, SupervisorTiming } from './supervisor';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condição não aconteceu a tempo');
    await sleep(2);
  }
}

const FAST: Partial<SupervisorTiming> = { readyTimeoutMs: 300, restartDelaysMs: [5, 10], maxConsecutiveFailures: 3, pingIntervalMs: 20, pingTimeoutMs: 200 };
const policy: ToolPolicy = { released: ['/home/teste/projetos'], places: { home: '/home/teste', localAppData: '/home/teste/.config', roamingAppData: '/home/teste/.config' } };
const DONE: ToolOutcome = { ok: true, tool: 'file_read', text: 'Linhas 1 a 1 de 1.', secrets: ['password', 'password'], stats: { tool: 'file_read', firstLine: 1, lastLine: 1, totalLines: 1, partial: false } };

const running: ExecutorProcess[] = [];
afterEach(() => {
  for (const executor of running.splice(0)) executor.supervisor.stop();
});

/** O Executor de verdade (`runExecutorHost`) num processo falso, com a ferramenta trocada por uma de teste. */
function setup(run: typeof runTool, calls: Partial<ExecutorTiming> = {}) {
  const children: FakeUtilityChild[] = [];
  const events: SupervisorEvent[] = [];
  const executor = startExecutorProcess({
    fork: () => {
      const child = new FakeUtilityChild((parent: ParentPortLike) => runExecutorHost(parent, { log: () => undefined, run, platform: 'linux' }));
      children.push(child);
      return child;
    },
    onEvent: (event) => events.push(event),
    timing: FAST,
    calls,
  });
  running.push(executor);
  return { executor, children, events };
}

const request = { name: 'file_read' as const, input: { path: '/home/teste/projetos/a.txt' }, policy };

describe('principal ↔ Executor', () => {
  it('a chamada vai com a política e volta com o texto, o resumo e os segredos contados', async () => {
    const seen: unknown[] = [];
    const { executor } = setup(async (name, input, options) => {
      seen.push({ name, input, released: options.policy.released.map((path) => path.text) });
      return DONE;
    });
    await executor.supervisor.whenReady();
    expect(await executor.run(request)).toEqual({ ok: true, text: DONE.text, secrets: { password: 2 }, stats: DONE.ok ? DONE.stats : null });
    expect(seen).toEqual([{ name: 'file_read', input: request.input, released: ['/home/teste/projetos'] }]);
  });

  it('falha volta com o código curto', async () => {
    const { executor } = setup(async () => ({ ok: false, tool: 'file_read', text: 'Não achei esse caminho.', failure: { reason: 'not_found' } }));
    await executor.supervisor.whenReady();
    expect(await executor.run(request)).toEqual({ ok: false, text: 'Não achei esse caminho.', code: 'not_found' });
  });

  it('turno parado: cancela no Executor e responde na hora', async () => {
    let aborted = false;
    const { executor, children } = setup(
      (_name, _input, options) =>
        new Promise((resolve) =>
          options.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ ok: false, tool: 'file_read', text: 'A leitura foi interrompida.', failure: { reason: 'cancelled' } });
          }),
        ),
      { cancelGraceMs: 40 },
    );
    await executor.supervisor.whenReady();
    const controller = new AbortController();
    const reply = executor.run(request, controller.signal);
    await sleep(10);
    controller.abort();
    expect(await reply).toEqual(CANCELLED);
    await until(() => aborted);
    // A resposta tardia da chamada cancelada não derruba o Executor (nem depois do prazo do cancelamento).
    await sleep(80);
    expect(children).toHaveLength(1);
    expect(await executor.run(request, AbortSignal.abort())).toEqual(CANCELLED);
  });

  it('tempo esgotado: cancela; se o Executor nem assim responde, ele está preso e sobe de novo', async () => {
    const { executor, children } = setup(() => new Promise(() => undefined), { callTimeoutMs: 30, cancelGraceMs: 30 });
    await executor.supervisor.whenReady();
    expect(await executor.run(request)).toEqual(TIMED_OUT);
    await until(() => children.length === 2);
    expect(children[0]?.exited).toBe(true);
  });

  it('o Executor cai no meio: a chamada termina como indisponível', async () => {
    const { executor, children } = setup(() => new Promise(() => undefined));
    await executor.supervisor.whenReady();
    const reply = executor.run(request);
    await sleep(10);
    children[0]?.crash(1);
    expect(await reply).toEqual(UNAVAILABLE);
  });

  it('bloqueio: cancelAll encerra todas as chamadas em andamento', async () => {
    const { executor } = setup(
      (_name, _input, options) =>
        new Promise((resolve) =>
          options.signal?.addEventListener('abort', () => resolve({ ok: false, tool: 'file_read', text: 'x', failure: { reason: 'cancelled' } })),
        ),
    );
    await executor.supervisor.whenReady();
    const replies = [executor.run(request), executor.run(request)];
    await sleep(10);
    executor.cancelAll();
    expect(await Promise.all(replies)).toEqual([CANCELLED, CANCELLED]);
  });

  it('resposta para chamada que não existe é fuga do protocolo', async () => {
    let parent: ParentPortLike | null = null;
    const children: FakeUtilityChild[] = [];
    const executor = startExecutorProcess({
      fork: () => {
        const child = new FakeUtilityChild((port) => {
          parent = port;
          port.postMessage({ type: 'ready', prepareMs: 1 });
        });
        children.push(child);
        return child;
      },
      timing: FAST,
    });
    running.push(executor);
    await executor.supervisor.whenReady();
    (parent as ParentPortLike | null)?.postMessage({ type: 'tool-failed', id: 99, code: 'io', text: 'x' });
    await until(() => children.length === 2);
  });

  it('sem Executor pronto: indisponível', async () => {
    const executor = startExecutorProcess({ fork: () => new FakeUtilityChild(() => undefined), timing: { ...FAST, readyTimeoutMs: 10_000 } });
    running.push(executor);
    expect(await executor.run(request)).toEqual(UNAVAILABLE);
  });
});
