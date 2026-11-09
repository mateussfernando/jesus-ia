import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRequestedPath, checkResolvedPath, createReadPolicy } from './read-gate';
import type { ReadPolicy } from './read-gate';

/**
 * Só no Windows de verdade (no CI, `windows-latest`): o que o Porteiro espera do disco, que o Executor (etapa 13) vai
 * entregar. O `realpath` nativo resolve junções e nomes curtos 8.3 para o caminho longo de verdade, e o `nlink` conta
 * os hardlinks; com isso, o Porteiro nega a junção para fora, o nome curto e o hardlink.
 */

const isWindows = process.platform === 'win32';
const PLACES = { home: 'C:\\Users\\jesus-teste', localAppData: 'C:\\Users\\jesus-teste\\AppData\\Local', roamingAppData: 'C:\\Users\\jesus-teste\\AppData\\Roaming' };

describe.runIf(isWindows)('Porteiro no Windows de verdade: junções, nomes curtos e hardlinks', () => {
  let base: string;
  let released: string;
  let outside: string;
  let policy: ReadPolicy;

  beforeAll(() => {
    // A pasta temporária do runner costuma vir com nome curto (C:\Users\RUNNER~1\…): o caminho real vem longo.
    base = realpathSync.native(mkdtempSync(join(tmpdir(), 'jesus-gate-')));
    released = join(base, 'liberada');
    outside = join(base, 'fora');
    mkdirSync(released);
    mkdirSync(outside);
    writeFileSync(join(outside, 'a.txt'), 'de fora');
    policy = createReadPolicy({ released: [released], places: PLACES });
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('o caminho real da pasta temporária não tem nome curto', () => {
    expect(checkRequestedPath(base, createReadPolicy({ released: [base], places: PLACES })).decision).toBe('allow');
  });

  it('junção para fora da pasta liberada: o texto passa, o caminho real nega', () => {
    symlinkSync(outside, join(released, 'juncao'), 'junction');
    const requested = join(released, 'juncao', 'a.txt');
    const first = checkRequestedPath(requested, policy);
    if (first.decision !== 'allow') throw new Error('pelo texto, está dentro da pasta liberada');
    const real = realpathSync.native(requested);
    expect(real.toLowerCase()).toBe(join(outside, 'a.txt').toLowerCase());
    expect(checkResolvedPath(first.path, { real, kind: 'file', links: statSync(requested).nlink }, 'file', policy)).toEqual({
      decision: 'deny',
      denial: { reason: 'outside', which: 'real' },
    });
  });

  it('nome curto 8.3: negado pelo texto; o caminho real vem com o nome longo', () => {
    const long = join(released, 'Pasta Com Nome Bem Comprido');
    mkdirSync(long);
    writeFileSync(join(long, 'b.txt'), 'dentro');
    const short = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:JESUS_LONG_PATH).ShortPath'],
      { encoding: 'utf8', env: { ...process.env, JESUS_LONG_PATH: long } },
    ).trim();
    if (!basename(short).includes('~')) {
      // Volume sem nomes 8.3 (a criação deles pode estar desligada): não há o que testar aqui.
      console.warn(`[gate] sem nome curto em ${long}; teste de nome curto pulado`);
      return;
    }
    const requestedShort = join(short, 'b.txt');
    expect(checkRequestedPath(requestedShort, policy)).toEqual({ decision: 'deny', denial: { reason: 'path', which: 'requested', problem: 'short_name' } });
    const real = realpathSync.native(requestedShort);
    expect(real.toLowerCase()).toBe(join(long, 'b.txt').toLowerCase());
    const first = checkRequestedPath(join(long, 'b.txt'), policy);
    if (first.decision !== 'allow') throw new Error('o nome longo está dentro da pasta liberada');
    expect(checkResolvedPath(first.path, { real, kind: 'file', links: 1 }, 'file', policy).decision).toBe('allow');
  });

  it('hardlink: o caminho real é o do próprio link (dentro), e só o número de nomes mostra o problema', () => {
    const original = join(outside, 'original.txt');
    writeFileSync(original, 'conteúdo de fora');
    const linked = join(released, 'copia.txt');
    linkSync(original, linked);
    const first = checkRequestedPath(linked, policy);
    if (first.decision !== 'allow') throw new Error('pelo texto, está dentro da pasta liberada');
    const real = realpathSync.native(linked);
    expect(real.toLowerCase()).toBe(linked.toLowerCase());
    const links = statSync(linked).nlink;
    expect(links).toBe(2);
    expect(checkResolvedPath(first.path, { real, kind: 'file', links }, 'file', policy)).toEqual({
      decision: 'deny',
      denial: { reason: 'hardlink', links: 2 },
    });
  });
});
