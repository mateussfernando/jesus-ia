import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createReadPolicy } from '@jesus/gate';
import type { ReadPolicy } from '@jesus/gate';
import { nodeFs } from './fs';
import type { ExecutorFs } from './fs';

/**
 * Só para os testes: uma pasta de usuário de mentira numa pasta temporária, com uma pasta liberada, uma de fora e a do
 * Jesus, e a política POSIX montada com elas (no Windows de verdade, a política do Windows).
 */
export interface Sandbox {
  readonly base: string;
  readonly home: string;
  readonly released: string;
  readonly outside: string;
  readonly jesus: string;
  readonly policy: ReadPolicy;
  /** Cria um arquivo (e as pastas de cima) dentro da área de testes. */
  write(path: string, content: string | Uint8Array): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createSandbox(): Promise<Sandbox> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'jesus-executor-')));
  const home = join(base, 'home');
  const released = join(home, 'projetos', 'site');
  const outside = join(home, 'outros');
  const localAppData = process.platform === 'win32' ? join(home, 'AppData', 'Local') : join(home, '.config');
  const roamingAppData = process.platform === 'win32' ? join(home, 'AppData', 'Roaming') : join(home, '.config');
  const jesus = join(localAppData, 'Jesus');
  for (const folder of [released, outside, jesus]) await mkdir(folder, { recursive: true });
  const policy = createReadPolicy({
    platform: process.platform === 'win32' ? 'win32' : 'posix',
    released: [released],
    places: { home, localAppData, roamingAppData },
  });
  return {
    base,
    home,
    released,
    outside,
    jesus,
    policy,
    async write(path, content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      return path;
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

/** O disco de verdade, anotando cada caminho tocado (para conferir o que nunca foi aberto). */
export function recordingFs(inner: ExecutorFs = nodeFs): { readonly fs: ExecutorFs; readonly calls: string[] } {
  const calls: string[] = [];
  const fs: ExecutorFs = {
    lstat(path) {
      calls.push(`lstat ${path}`);
      return inner.lstat(path);
    },
    stat(path) {
      calls.push(`stat ${path}`);
      return inner.stat(path);
    },
    readlink(path) {
      calls.push(`readlink ${path}`);
      return inner.readlink(path);
    },
    realpath(path) {
      calls.push(`realpath ${path}`);
      return inner.realpath(path);
    },
    open(path) {
      calls.push(`open ${path}`);
      return inner.open(path);
    },
    opendir(path) {
      calls.push(`opendir ${path}`);
      return inner.opendir(path);
    },
  };
  return { fs, calls };
}
