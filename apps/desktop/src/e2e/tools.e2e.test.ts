import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, reportFailures } from './harness';
import type { RunningApp } from './harness';

/**
 * As leituras de arquivo no app de verdade (etapa 13; decisão 0026): o principal confere a chamada e o Porteiro, grava
 * no registro e repassa ao utilityProcess `jesus-executor` (o bundle de verdade, com as travas de rede e de módulos),
 * que lê o disco. A pasta é liberada pelo gancho do build de teste (os testes não clicam no diálogo nativo); a
 * conferência do Porteiro vale igual.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainEntry = join(desktopDir, 'dist-test', 'main.mjs');
const executable = process.env['JESUS_E2E_EXECUTABLE'];

let app: RunningApp;
let userData: string;
let work: string;
let released: string;

function hooks<T>(expression: string): Promise<T> {
  return app.mainEval<T>(`(() => { const h = globalThis.__jesusTest; return ${expression}; })()`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condição não aconteceu a tempo');
    await sleep(100);
  }
}

interface Reply {
  readonly ok: boolean;
  readonly text: string;
  readonly code?: string;
}

const runTool = (name: string, input: Record<string, unknown>) => hooks<Reply>(`h.runTool(${JSON.stringify(name)}, ${JSON.stringify(input)})`);

reportFailures(() => app);

beforeAll(async () => {
  const entry = executable !== undefined && executable !== '' ? executable : mainEntry;
  if (!existsSync(entry)) throw new Error(`Falta ${entry}. Rode: npm run build:test -w @jesus/desktop`);
  userData = await mkdtemp(join(tmpdir(), 'jesus-e2e-tools-'));
  // Na pasta do usuário: no Windows, a pasta temporária fica dentro do AppData, que o Porteiro não deixa liberar.
  work = await realpath(await mkdtemp(join(homedir(), 'jesus-e2e-work-')));
  released = join(work, 'projeto');
  await mkdir(join(released, 'docs'), { recursive: true });
  await writeFile(join(released, 'docs', 'notas.txt'), 'primeira linha\na senha do banco é Abc123!xyz\n');
  await writeFile(join(work, 'fora.txt'), 'de fora');
  app = await launchApp({ mainEntry, executable, userData });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe('leitura de arquivos no app de verdade', () => {
  it('o Executor sobe e lê uma pasta liberada, com o segredo mascarado', async () => {
    await until(async () => (await hooks<{ type: string }[]>('h.executorEvents')).some((event) => event.type === 'ready'));
    expect(await hooks('h.releaseFolder(' + JSON.stringify(released) + ')')).toMatchObject({ ok: true, folder: { path: released } });
    const read = await runTool('file_read', { path: join(released, 'docs', 'notas.txt') });
    expect(read.ok).toBe(true);
    expect(read.text).toContain('1\tprimeira linha');
    expect(read.text).toContain('2\ta senha do banco é [segredo removido: senha]');
    expect(read.text).not.toContain('Abc123');
    const listed = await runTool('file_list', { path: released });
    expect(listed.text).toContain('[pasta] docs');
    const searched = await runTool('file_search', { path: released, query: 'PRIMEIRA' });
    expect(searched.text).toContain(`docs${process.platform === 'win32' ? '\\' : '/'}notas.txt:1: primeira linha`);
  });

  it('fora da pasta liberada, a pasta do usuário e a entrada errada são recusadas', async () => {
    expect(await runTool('file_read', { path: join(work, 'fora.txt') })).toMatchObject({ ok: false, code: 'denied:outside:requested' });
    expect(await runTool('file_read', { path: join(released, 'docs', 'notas.txt'), extra: true })).toMatchObject({ ok: false, code: 'input' });
    // A pasta do usuário inteira: ampla demais.
    expect(await hooks('h.releaseFolder(' + JSON.stringify(await realpath(join(work, '..'))) + ')')).toMatchObject({ ok: false, reason: 'refused', refusal: { reason: 'too_broad' } });
  });

  it('o Executor cai e sobe de novo; a leitura volta a funcionar', async () => {
    const before = await hooks<number>('h.executorPid()');
    await hooks('h.restartExecutor()');
    await until(async () => {
      const pid = await hooks<number | undefined>('h.executorPid()');
      return pid !== undefined && pid !== before && (await hooks<{ type: string }[]>('h.executorEvents')).filter((event) => event.type === 'ready').length >= 2;
    });
    expect((await runTool('file_read', { path: join(released, 'docs', 'notas.txt') })).ok).toBe(true);
  });
});
