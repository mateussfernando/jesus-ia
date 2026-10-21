import { link, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runTool } from './run';
import type { ToolOutcome } from './outcome';
import { createSandbox } from './test-helpers';
import type { Sandbox } from './test-helpers';

const isWindows = process.platform === 'win32';
let box: Sandbox;

beforeEach(async () => {
  box = await createSandbox();
});

afterEach(async () => {
  await box.cleanup();
});

const list = (path: string, limits = {}) => runTool('file_list', { path }, { policy: box.policy, limits });

function entries(outcome: ToolOutcome): string[] {
  if (!outcome.ok) throw new Error(`falhou: ${outcome.text}`);
  const match = /<dados-externos origem="file_list">\n([\s\S]*)\n<\/dados-externos>$/.exec(outcome.text);
  if (match === null) throw new Error(`sem bloco de dados: ${outcome.text}`);
  return (match[1] ?? '').split('\n');
}

describe('file_list', () => {
  it('pastas, arquivos com tamanho e o sensível marcado sem ser olhado, em ordem de nome', async () => {
    await mkdir(join(box.released, 'src'));
    await box.write(join(box.released, 'README.md'), 'x'.repeat(2_355));
    await box.write(join(box.released, 'arquivo10.txt'), '');
    await box.write(join(box.released, 'arquivo2.txt'), 'ab');
    await box.write(join(box.released, '.env'), 'TOKEN=1');
    const outcome = await list(box.released);
    expect(outcome).toMatchObject({ ok: true, stats: { tool: 'file_list', shown: 5, total: 5, more: false } });
    expect(outcome.text.split('\n')[0]).toBe('Pasta com 5 itens.');
    expect(entries(outcome)).toEqual([
      '[sensível] .env (o Jesus não lê)',
      '[arquivo] arquivo2.txt (2 bytes)',
      '[arquivo] arquivo10.txt (0 bytes)',
      '[arquivo] README.md (2,3 KB)',
      '[pasta] src',
    ]);
  });

  it('a pasta do Jesus nem aparece', async () => {
    await mkdir(join(box.released, '.jesus-dev'));
    await box.write(join(box.released, 'a.txt'), 'x');
    expect(entries(await list(box.released))).toEqual(['[arquivo] a.txt (1 byte)']);
  });

  it.skipIf(isWindows)('links aparecem como link, sem ser seguidos; hardlink aparece marcado', async () => {
    await symlink(box.outside, join(box.released, 'fora'));
    const original = await box.write(join(box.outside, 'o.txt'), 'abc');
    await link(original, join(box.released, 'gemeo.txt'));
    expect(entries(await list(box.released))).toEqual(['[link] fora', '[arquivo] gemeo.txt (3 bytes; tem mais de um nome, e o Jesus não lê)']);
  });

  it.skipIf(isWindows)('nome com quebra de linha não inventa uma linha na listagem', async () => {
    await box.write(join(box.released, 'a\n[arquivo] falso.txt'), 'x');
    expect(entries(await list(box.released))).toEqual(['[não lido] a\uFFFD[arquivo] falso.txt (nome que o Jesus não lê)']);
  });

  it('nomes comuns ficam; chave de API no nome sai', async () => {
    const key = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');
    await box.write(join(box.released, 'Screenshot_2023-10-15-12-34-56-789_com.whatsapp.jpg'), 'x');
    await box.write(join(box.released, `${key}.txt`), 'x');
    const outcome = await list(box.released);
    expect(entries(outcome)).toEqual(['[arquivo] Screenshot_2023-10-15-12-34-56-789_com.whatsapp.jpg (1 byte)', '[arquivo] [segredo removido: chave de API].txt (1 byte)']);
    expect(outcome.ok && outcome.secrets).toEqual(['api_key']);
  });

  it('pasta grande: mostra os primeiros em ordem de nome e conta o resto', async () => {
    for (let index = 1; index <= 12; index++) await box.write(join(box.released, `f${index}.txt`), '');
    const outcome = await list(box.released, { listEntries: 3 });
    expect(entries(outcome)).toEqual(['[arquivo] f1.txt (0 bytes)', '[arquivo] f2.txt (0 bytes)', '[arquivo] f3.txt (0 bytes)']);
    expect(outcome.text.split('\n')[0]).toBe('Pasta com 12 itens. Mostrando 3, em ordem de nome; para achar algo específico, use file_search.');
    const bySize = await list(box.released, { responseChars: 60 });
    expect(entries(bySize)).toEqual(['[arquivo] f1.txt (0 bytes)', '[arquivo] f2.txt (0 bytes)']);
    expect(bySize).toMatchObject({ ok: true, stats: { shown: 2, total: 12 } });
    const scanned = await list(box.released, { listScan: 5, listEntries: 3 });
    expect(scanned).toMatchObject({ ok: true, stats: { shown: 3, total: 5, more: true } });
    expect(scanned.text.split('\n')[0]).toBe('A pasta tem mais de 5 itens. Mostrando 3, em ordem de nome; para achar algo específico, use file_search.');
  });

  it('pasta vazia, arquivo no lugar da pasta, fora da pasta liberada', async () => {
    await mkdir(join(box.released, 'vazia'));
    expect(await list(join(box.released, 'vazia'))).toMatchObject({ ok: true, text: 'A pasta está vazia.' });
    const file = await box.write(join(box.released, 'a.txt'), 'x');
    expect(await list(file)).toMatchObject({ ok: false, failure: { reason: 'denied', denial: { reason: 'kind', expected: 'directory', actual: 'file' } } });
    expect(await list(box.outside)).toMatchObject({ ok: false, failure: { reason: 'denied', denial: { reason: 'outside', which: 'requested' } } });
    expect(await list(join(box.released, 'nada'))).toMatchObject({ ok: false, failure: { reason: 'not_found' } });
  });
});
