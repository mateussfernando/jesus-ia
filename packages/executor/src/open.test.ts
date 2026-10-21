import { execFileSync } from 'node:child_process';
import { chmod, mkdir, rename, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from './fs';
import type { ExecutorFs } from './fs';
import { runTool } from './run';
import { createSandbox, recordingFs } from './test-helpers';
import type { Sandbox } from './test-helpers';

/**
 * Links e trocas no meio da conferência, com links de verdade (no Linux; o CI do Windows tem as junções e os nomes
 * curtos no `windows-fs.test.ts`).
 */

const isWindows = process.platform === 'win32';
let box: Sandbox;

beforeEach(async () => {
  box = await createSandbox();
});

afterEach(async () => {
  await box.cleanup();
});

describe.skipIf(isWindows)('links: conferidos antes de seguidos', () => {
  it('link para dentro da pasta liberada: lê o destino', async () => {
    await box.write(join(box.released, 'docs', 'a.txt'), 'conteúdo do destino');
    await symlink(join(box.released, 'docs', 'a.txt'), join(box.released, 'atalho.txt'));
    await symlink('docs', join(box.released, 'pasta-atalho'));
    const direct = await runTool('file_read', { path: join(box.released, 'atalho.txt') }, { policy: box.policy });
    expect(direct.ok && direct.text).toContain('1\tconteúdo do destino');
    const through = await runTool('file_read', { path: join(box.released, 'pasta-atalho', 'a.txt') }, { policy: box.policy });
    expect(through.ok && through.text).toContain('1\tconteúdo do destino');
  });

  it('link para fora: negado pelo alvo, sem tocar no lugar de fora', async () => {
    const secret = await box.write(join(box.outside, 'segredo.txt'), 'de fora');
    await symlink(secret, join(box.released, 'link.txt'));
    await symlink(box.outside, join(box.released, 'pasta-link'));
    const { fs, calls } = recordingFs();
    for (const path of [join(box.released, 'link.txt'), join(box.released, 'pasta-link', 'segredo.txt')]) {
      const outcome = await runTool('file_read', { path }, { policy: box.policy, fs });
      expect(outcome, path).toMatchObject({ ok: false, failure: { reason: 'denied', denial: { reason: 'outside', which: 'real' } } });
      expect(outcome.text).toBe('O caminho leva (por link, atalho ou junção) a um lugar onde o Jesus não lê: fora das pastas liberadas.');
    }
    expect(calls.filter((call) => call.includes(box.outside))).toEqual([]);
    expect(calls.some((call) => call.startsWith('open '))).toBe(false);
  });

  it('link para o sensível ou para a pasta do Jesus: negado como caminho real', async () => {
    await box.write(join(box.released, '.ssh', 'id_ed25519'), 'chave');
    await symlink(join(box.released, '.ssh', 'id_ed25519'), join(box.released, 'chave.txt'));
    await symlink(box.jesus, join(box.released, 'dados'));
    expect(await runTool('file_read', { path: join(box.released, 'chave.txt') }, { policy: box.policy })).toMatchObject({
      ok: false,
      failure: { denial: { reason: 'sensitive', kind: 'ssh', which: 'real' } },
    });
    expect(await runTool('file_list', { path: join(box.released, 'dados') }, { policy: box.policy })).toMatchObject({
      ok: false,
      failure: { denial: { reason: 'jesus', which: 'real' } },
    });
  });

  it('link relativo com .. que volta para dentro: lê', async () => {
    await box.write(join(box.released, 'b', 'alvo.txt'), 'ok');
    await mkdir(join(box.released, 'a'));
    await symlink('../b/alvo.txt', join(box.released, 'a', 'rel.txt'));
    const outcome = await runTool('file_read', { path: join(box.released, 'a', 'rel.txt') }, { policy: box.policy });
    expect(outcome.ok && outcome.text).toContain('1\tok');
  });

  it('laço de links para no limite', async () => {
    await symlink(join(box.released, 'b'), join(box.released, 'a'));
    await symlink(join(box.released, 'a'), join(box.released, 'b'));
    expect(await runTool('file_read', { path: join(box.released, 'a') }, { policy: box.policy })).toMatchObject({ ok: false, failure: { reason: 'loop' } });
  });

  it('o arquivo vira link entre a conferência e a abertura: o open sem seguir recusa', async () => {
    const target = await box.write(join(box.released, 'a.txt'), 'dentro');
    const secret = await box.write(join(box.outside, 'segredo.txt'), 'de fora');
    const swapping: ExecutorFs = {
      ...nodeFs,
      async open(path) {
        await unlink(target);
        await symlink(secret, target);
        return nodeFs.open(path);
      },
    };
    expect(await runTool('file_read', { path: target }, { policy: box.policy, fs: swapping })).toMatchObject({ ok: false, failure: { reason: 'changed' } });
  });

  it('o arquivo é trocado por outro entre a conferência e a abertura: o dev/ino pega', async () => {
    const target = await box.write(join(box.released, 'a.txt'), 'original');
    const other = await box.write(join(box.released, 'outro.txt'), 'trocado');
    const swapping: ExecutorFs = {
      ...nodeFs,
      async open(path) {
        await rename(other, target);
        return nodeFs.open(path);
      },
    };
    expect(await runTool('file_read', { path: target }, { policy: box.policy, fs: swapping })).toMatchObject({ ok: false, failure: { reason: 'changed' } });
  });

  it('o caminho real do sistema leva a outro arquivo: recusa', async () => {
    const target = await box.write(join(box.released, 'a.txt'), 'dentro');
    const other = await box.write(join(box.released, 'b.txt'), 'outro');
    const lying: ExecutorFs = { ...nodeFs, realpath: async () => other };
    expect(await runTool('file_read', { path: target }, { policy: box.policy, fs: lying })).toMatchObject({ ok: false, failure: { reason: 'changed' } });
  });

  it('o caminho real do sistema cai fora da pasta liberada: o Porteiro nega', async () => {
    const target = await box.write(join(box.released, 'a.txt'), 'dentro');
    const lying: ExecutorFs = { ...nodeFs, realpath: async () => join(box.outside, 'montado', 'a.txt'), stat: (path) => nodeFs.stat(path === join(box.outside, 'montado', 'a.txt') ? target : path) };
    expect(await runTool('file_read', { path: target }, { policy: box.policy, fs: lying })).toMatchObject({
      ok: false,
      failure: { reason: 'denied', denial: { reason: 'outside', which: 'real' } },
    });
  });

  it('pipe com nome: negado pelo tipo, sem abrir (abrir travaria)', async (context) => {
    const fifo = join(box.released, 'fila');
    try {
      execFileSync('mkfifo', [fifo]);
    } catch {
      context.skip();
    }
    const { fs, calls } = recordingFs();
    expect(await runTool('file_read', { path: fifo }, { policy: box.policy, fs })).toMatchObject({
      ok: false,
      failure: { reason: 'denied', denial: { reason: 'kind', actual: 'other' } },
    });
    expect(calls.some((call) => call.startsWith('open '))).toBe(false);
  });

  it('o arquivo é apagado antes de abrir: não achado vira "mudou"', async () => {
    const target = await box.write(join(box.released, 'a.txt'), 'x');
    const vanishing: ExecutorFs = {
      ...nodeFs,
      async open(path) {
        await unlink(target);
        return nodeFs.open(path);
      },
    };
    expect(await runTool('file_read', { path: target }, { policy: box.policy, fs: vanishing })).toMatchObject({ ok: false, failure: { reason: 'changed' } });
  });

  it('sem permissão de leitura', async (context) => {
    if (process.getuid?.() === 0) context.skip();
    const target = await box.write(join(box.released, 'trancado.txt'), 'x');
    await chmod(target, 0o000);
    expect(await runTool('file_read', { path: target }, { policy: box.policy })).toMatchObject({ ok: false, failure: { reason: 'no_access' } });
  });
});
