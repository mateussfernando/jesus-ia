import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { runTool } from '@jesus/executor';
import { parseFromExecutor } from '../bridge/executor-protocol';
import type { FromExecutorMessage, ToolPolicy } from '../bridge/executor-protocol';
import type { ParentPortLike, PortMessageEvent } from '../bridge/ports';
import { MAX_CONCURRENT_TOOLS, runExecutorHost } from './executor';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condição não aconteceu a tempo');
    await sleep(2);
  }
}

/** Um `parentPort` de teste: guarda o que o Executor manda (conferido pelo protocolo) e entrega mensagens a ele. */
function fakeParent() {
  const emitter = new EventEmitter();
  const sent: FromExecutorMessage[] = [];
  const invalid: unknown[] = [];
  const parent: ParentPortLike = {
    postMessage(message) {
      const parsed = parseFromExecutor(structuredClone(message));
      if (parsed === null) invalid.push(message);
      else sent.push(parsed);
    },
    on: (event, listener) => emitter.on(event, listener),
  };
  const deliver = (data: unknown) => emitter.emit('message', { data, ports: [] } satisfies PortMessageEvent);
  return { parent, sent, invalid, deliver };
}

const isWindows = process.platform === 'win32';
let base: string;
let policy: ToolPolicy;

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'jesus-executor-host-')));
  const released = join(base, 'home', 'projetos');
  await mkdir(released, { recursive: true });
  await writeFile(join(released, 'notas.txt'), 'olá\n');
  const home = join(base, 'home');
  const appData = isWindows ? join(home, 'AppData', 'Local') : join(home, '.config');
  policy = { released: [released], places: { home, localAppData: appData, roamingAppData: appData } };
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('Executor na ponte (jesus-executor)', () => {
  it('avisa que está pronto, responde ao sinal de vida e executa a ferramenta com a política que veio', async () => {
    const { parent, sent, deliver } = fakeParent();
    runExecutorHost(parent, { log: () => undefined });
    expect(sent[0]).toMatchObject({ type: 'ready' });
    deliver({ type: 'ping', seq: 7 });
    expect(sent.at(-1)).toEqual({ type: 'pong', seq: 7 });
    deliver({ type: 'tool-run', id: 1, name: 'file_read', input: { path: join(policy.released[0] ?? '', 'notas.txt') }, policy });
    await until(() => sent.some((message) => message.type === 'tool-done'));
    expect(sent.at(-1)).toMatchObject({ type: 'tool-done', id: 1, secrets: {}, stats: { tool: 'file_read', totalLines: 1 } });
    deliver({ type: 'tool-run', id: 2, name: 'file_read', input: { path: join(base, 'fora.txt') }, policy });
    await until(() => sent.some((message) => message.type === 'tool-failed'));
    expect(sent.at(-1)).toMatchObject({ type: 'tool-failed', id: 2, code: 'denied:outside:requested' });
  });

  it('mensagem fora do protocolo é recusada (com aviso no log)', () => {
    const { parent, sent, deliver } = fakeParent();
    const logged: string[] = [];
    runExecutorHost(parent, { log: (message) => logged.push(message) });
    deliver({ type: 'tool-run', id: 1, name: 'file_write', input: {}, policy });
    deliver({ type: 'tool-run', id: 1, name: 'file_read', input: { path: 'x' }, policy, extra: true });
    expect(logged).toEqual(['mensagem inválida do processo principal recusada', 'mensagem inválida do processo principal recusada']);
    expect(sent).toHaveLength(1);
  });

  it('cancelamento e chamadas demais ao mesmo tempo', async () => {
    const { parent, sent, deliver } = fakeParent();
    const signals: AbortSignal[] = [];
    const run: typeof runTool = (name, _input, options) =>
      new Promise((resolve) => {
        signals.push(options.signal ?? new AbortController().signal);
        options.signal?.addEventListener('abort', () =>
          resolve({ ok: false, tool: 'file_read', text: 'A leitura foi interrompida.', failure: { reason: 'cancelled' } }),
        );
        void name;
      });
    runExecutorHost(parent, { log: () => undefined, run });
    for (let id = 1; id <= MAX_CONCURRENT_TOOLS + 1; id++) deliver({ type: 'tool-run', id, name: 'file_read', input: { path: '/x' }, policy });
    expect(sent.at(-1)).toMatchObject({ type: 'tool-failed', id: MAX_CONCURRENT_TOOLS + 1, code: 'busy' });
    deliver({ type: 'tool-cancel', id: 1 });
    await until(() => sent.some((message) => message.type === 'tool-failed' && message.id === 1));
    expect(sent.find((message) => message.type === 'tool-failed' && message.id === 1)).toMatchObject({ code: 'cancelled' });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('política com caminho que o Porteiro não aceita: falha sem rodar', () => {
    const { parent, sent, deliver } = fakeParent();
    runExecutorHost(parent, { log: () => undefined });
    deliver({ type: 'tool-run', id: 1, name: 'file_read', input: { path: '/x' }, policy: { ...policy, released: ['relativo/pasta'] } });
    expect(sent.at(-1)).toMatchObject({ type: 'tool-failed', id: 1, code: 'policy' });
  });
});
