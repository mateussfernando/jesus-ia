import { execFileSync } from 'node:child_process';
import { link, mkdir, symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runTool } from './run';
import { createSandbox, recordingFs } from './test-helpers';
import type { Sandbox } from './test-helpers';

/**
 * Só no Windows de verdade (no CI, `windows-latest`): junções, links para a rede, nomes curtos, maiúsculas e
 * hardlinks, com o disco e o `realpath` nativo do Windows.
 */

const isWindows = process.platform === 'win32';
let box: Sandbox;

beforeEach(async () => {
  if (isWindows) box = await createSandbox();
});

afterEach(async () => {
  if (isWindows) await box.cleanup();
});

/** Link simbólico precisa de privilégio (administrador ou modo de desenvolvedor); o runner do CI é administrador. */
async function trySymlink(target: string, path: string, type: 'file' | 'dir'): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch {
    return false;
  }
}

describe.runIf(isWindows)('Executor no Windows de verdade', () => {
  it('junção para fora: negada pelo alvo, sem tocar no lugar de fora', async () => {
    await box.write(join(box.outside, 'segredo.txt'), 'de fora');
    await symlink(box.outside, join(box.released, 'juncao'), 'junction');
    const { fs, calls } = recordingFs();
    const outcome = await runTool('file_read', { path: join(box.released, 'juncao', 'segredo.txt') }, { policy: box.policy, fs });
    expect(outcome).toMatchObject({ ok: false, failure: { reason: 'denied', denial: { reason: 'outside', which: 'real' } } });
    expect(calls.filter((call) => call.toLowerCase().includes(box.outside.toLowerCase()))).toEqual([]);
  });

  it('junção para dentro: lê pelo caminho real; a listagem mostra a junção como link e a busca não entra nela', async () => {
    await box.write(join(box.released, 'docs', 'a.txt'), 'dentro');
    await symlink(join(box.released, 'docs'), join(box.released, 'atalho'), 'junction');
    const read = await runTool('file_read', { path: join(box.released, 'atalho', 'a.txt') }, { policy: box.policy });
    expect(read.ok && read.text).toContain('1\tdentro');
    const listed = await runTool('file_list', { path: box.released }, { policy: box.policy });
    expect(listed.ok && listed.text).toContain('[link] atalho');
    const searched = await runTool('file_search', { path: box.released, query: 'dentro' }, { policy: box.policy });
    expect(searched).toMatchObject({ ok: true, stats: { results: 1 } });
  });

  it('link para um caminho de rede (SMB ou WebDAV): negado sem ser aberto', async (context) => {
    const targets = ['\\\\127.0.0.1\\c$\\Windows\\win.ini', '\\\\jesus-teste.invalid@SSL\\DavWWWRoot\\x.txt'];
    for (const [index, target] of targets.entries()) {
      if (!(await trySymlink(target, join(box.released, `rede${index}.txt`), 'file'))) context.skip();
    }
    if (!(await trySymlink('\\\\127.0.0.1\\c$', join(box.released, 'pasta-rede'), 'dir'))) context.skip();
    const { fs, calls } = recordingFs();
    for (const path of [join(box.released, 'rede0.txt'), join(box.released, 'rede1.txt'), join(box.released, 'pasta-rede', 'x.txt')]) {
      expect(await runTool('file_read', { path }, { policy: box.policy, fs }), path).toMatchObject({
        ok: false,
        failure: { reason: 'denied', denial: { reason: 'path', which: 'real', problem: 'unc' } },
      });
    }
    expect(calls.filter((call) => call.includes(' \\\\'))).toEqual([]);
    expect(calls.some((call) => call.startsWith('open ') || call.startsWith('realpath '))).toBe(false);
  });

  // O PowerShell que lê o nome curto é lento para abrir: no CI, o caso já passou dos 5 s padrão.
  it('nome curto 8.3 é recusado pelo texto, sem tocar o disco', { timeout: 30_000 }, async () => {
    const long = join(box.released, 'Pasta Com Nome Bem Comprido');
    await mkdir(long);
    await box.write(join(long, 'b.txt'), 'dentro');
    const short = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:JESUS_LONG_PATH).ShortPath'],
      { env: { ...process.env, JESUS_LONG_PATH: long }, encoding: 'utf8' },
    ).trim();
    // Volumes sem nomes curtos devolvem o próprio nome longo: aí não há o que testar.
    if (basename(short) === basename(long)) return;
    const { fs, calls } = recordingFs();
    expect(await runTool('file_read', { path: join(short, 'b.txt') }, { policy: box.policy, fs })).toMatchObject({
      ok: false,
      failure: { reason: 'denied', denial: { reason: 'path', which: 'requested', problem: 'short_name' } },
    });
    expect(calls).toEqual([]);
  });

  it('maiúsculas diferentes no pedido: lê o mesmo arquivo', async () => {
    await box.write(join(box.released, 'Notas.TXT'), 'ok');
    const outcome = await runTool('file_read', { path: join(box.released, 'notas.txt').toUpperCase() }, { policy: box.policy });
    expect(outcome.ok && outcome.text).toContain('1\tok');
  });

  it('hardlink: negado antes de abrir', async () => {
    const original = await box.write(join(box.outside, 'o.txt'), 'de fora');
    await link(original, join(box.released, 'gemeo.txt'));
    const { fs, calls } = recordingFs();
    expect(await runTool('file_read', { path: join(box.released, 'gemeo.txt') }, { policy: box.policy, fs })).toMatchObject({
      ok: false,
      failure: { reason: 'denied', denial: { reason: 'hardlink', links: 2 } },
    });
    expect(calls.some((call) => call.startsWith('open '))).toBe(false);
  });
});
