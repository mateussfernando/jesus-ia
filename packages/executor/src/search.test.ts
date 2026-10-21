import { link, mkdir, symlink } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BigIntStats } from 'node:fs';
import { nodeFs } from './fs';
import type { ExecutorFs } from './fs';
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

const search = (query: string, options: { path?: string; limits?: object; now?: () => number } = {}) =>
  runTool('file_search', { path: options.path ?? box.released, query }, { policy: box.policy, limits: options.limits ?? {}, ...(options.now === undefined ? {} : { now: options.now }) });

function results(outcome: ToolOutcome): string[] {
  if (!outcome.ok) throw new Error(`falhou: ${outcome.text}`);
  const match = /<dados-externos origem="file_search">\n([\s\S]*)\n<\/dados-externos>$/.exec(outcome.text);
  return match === null ? [] : (match[1] ?? '').split('\n');
}

const header = (outcome: ToolOutcome) => outcome.text.split('\n')[0];

describe('file_search', () => {
  it('acha o texto sem diferenciar maiúsculas, com caminho relativo e número da linha', async () => {
    await box.write(join(box.released, 'notas.md'), 'início\nO Contrato vence em março.\nfim');
    await box.write(join(box.released, 'docs', 'resumo.txt'), 'nada aqui\nsobre o CONTRATO novo');
    const outcome = await search('contrato');
    expect(results(outcome)).toEqual([`docs${sep}resumo.txt:2: sobre o CONTRATO novo`, 'notas.md:2: O Contrato vence em março.']);
    expect(header(outcome)).toBe('2 resultados (2 arquivos examinados).');
    expect(outcome).toMatchObject({ ok: true, stats: { tool: 'file_search', results: 2, files: 2, stopped: null } });
  });

  it('acha pelo nome, também de pasta e de binário', async () => {
    await box.write(join(box.released, 'Contrato 2024.pdf'), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00]));
    await mkdir(join(box.released, 'contratos'));
    expect(results(await search('contrato'))).toEqual(['[nome] Contrato 2024.pdf', `[nome] contratos${sep}`]);
  });

  it('a mesma letra em formas Unicode diferentes (NFC e NFD) é achada', async () => {
    await box.write(join(box.released, 'a.txt'), 'informac\u0327a\u0303o importante');
    // O trecho sai como está no arquivo (aqui, na forma decomposta).
    expect(results(await search('informação'))).toEqual(['a.txt:1: informac\u0327a\u0303o importante']);
    expect(results(await search('informac\u0327a\u0303o'))).toHaveLength(1);
  });

  it('não acha pedaço de segredo: a busca compara com o texto já mascarado', async () => {
    await box.write(join(box.released, 'senhas.txt'), 'a senha do banco é Abc123!xyz\noutra linha com xyz');
    expect(results(await search('Abc123'))).toEqual([]);
    expect(results(await search('xyz'))).toEqual(['senhas.txt:2: outra linha com xyz']);
    expect(results(await search('senha do banco'))).toEqual(['senhas.txt:1: a senha do banco é [segredo removido: senha]']);
  });

  it('pula sensível, pasta do Jesus, binário, .git e node_modules, e conta o que pulou', async () => {
    await box.write(join(box.released, '.env'), 'alvo=1');
    await box.write(join(box.released, '.jesus-dev', 'credencial.json'), 'alvo');
    await box.write(join(box.released, 'img.bin'), new Uint8Array([0x61, 0x6c, 0x76, 0x6f, 0x00]));
    await box.write(join(box.released, '.git', 'config'), 'alvo');
    await box.write(join(box.released, 'node_modules', 'x', 'index.js'), 'alvo');
    await box.write(join(box.released, 'ok.txt'), 'alvo');
    const outcome = await search('alvo');
    expect(results(outcome)).toEqual(['ok.txt:1: alvo']);
    expect(outcome.text.split('\n')[0]).toBe(
      '1 resultado (2 arquivos examinados). Pulados: 1 binário, 1 sensível, 2 pastas de repositório ou dependências (.git, node_modules).',
    );
  });

  it.skipIf(isWindows)('não segue links nem lê hardlink', async () => {
    await box.write(join(box.outside, 'fora.txt'), 'alvo de fora');
    await symlink(box.outside, join(box.released, 'link-pasta'));
    await symlink(join(box.outside, 'fora.txt'), join(box.released, 'link.txt'));
    await link(join(box.outside, 'fora.txt'), join(box.released, 'gemeo.txt'));
    const outcome = await search('alvo');
    expect(results(outcome)).toEqual([]);
    expect(outcome.text).toBe('Nenhum resultado (1 arquivo examinado). Pulados: 2 links, 1 que o Porteiro não deixa ler.');
  });

  it('não atravessa para outro disco (ponto de montagem dentro da pasta)', async () => {
    await box.write(join(box.released, 'montado', 'a.txt'), 'alvo');
    await box.write(join(box.released, 'b.txt'), 'alvo');
    const mounted = join(box.released, 'montado');
    const otherDisk: ExecutorFs = {
      ...nodeFs,
      async lstat(path) {
        const stats = await nodeFs.lstat(path);
        return path === mounted ? Object.assign(Object.create(Object.getPrototypeOf(stats) as object) as BigIntStats, stats, { dev: stats.dev + 1n }) : stats;
      },
    };
    const outcome = await runTool('file_search', { path: box.released, query: 'alvo' }, { policy: box.policy, fs: otherDisk });
    expect(results(outcome)).toEqual(['b.txt:1: alvo']);
    expect(header(outcome)).toBe('1 resultado (1 arquivo examinado). Pulados: 1 pasta de outro disco.');
  });

  it('arquivo grande demais é pulado; trecho de linha longa sai em volta do achado', async () => {
    await box.write(join(box.released, 'grande.txt'), `alvo${'x'.repeat(200)}`);
    await box.write(join(box.released, 'longa.txt'), `${'a'.repeat(50)} alvo ${'b'.repeat(50)}`);
    const outcome = await search('alvo', { limits: { searchFileBytes: 150, snippetChars: 20 } });
    expect(results(outcome)).toEqual(['longa.txt:1: …aaaaaaa alvo bbbbbbb…']);
    expect(header(outcome)).toContain('Pulados: 1 grande demais.');
  });

  it('para nos cortes: resultados, arquivos, bytes, itens, níveis e tempo', async () => {
    for (let index = 1; index <= 5; index++) await box.write(join(box.released, `f${index}.txt`), 'alvo\nalvo');
    const byResults = await search('alvo', { limits: { searchResults: 3 } });
    expect(results(byResults)).toHaveLength(3);
    expect(byResults).toMatchObject({ stats: { stopped: 'results' } });
    expect(byResults.text.split('\n')[0]).toBe('3 resultados (2 arquivos examinados). A busca parou em 3 resultados; procure um texto mais específico ou numa subpasta.');
    const bySize = await search('alvo', { limits: { responseChars: 30 } });
    expect(results(bySize)).toEqual(['f1.txt:1: alvo', 'f1.txt:2: alvo']);
    expect(bySize).toMatchObject({ stats: { stopped: 'results', results: 2 } });
    expect(await search('alvo', { limits: { searchFiles: 2 } })).toMatchObject({ stats: { stopped: 'files', files: 2 } });
    expect(await search('alvo', { limits: { searchTotalBytes: 20 } })).toMatchObject({ stats: { stopped: 'bytes', files: 3 } });
    expect(await search('alvo', { limits: { searchEntries: 2 } })).toMatchObject({ stats: { stopped: 'entries', results: 4 } });
    let clock = 0;
    const slow = await search('alvo', { limits: { searchMillis: 10 }, now: () => (clock += 4) });
    expect(slow).toMatchObject({ stats: { stopped: 'time' } });
    expect(slow.text).toContain('A busca parou no limite de 0 segundos');

    await box.write(join(box.released, 'a', 'b', 'c', 'fundo.txt'), 'alvo');
    const shallow = await search('fundo', { path: join(box.released, 'a'), limits: { searchDepth: 1 } });
    expect(results(shallow)).toEqual([]);
    expect(header(shallow)).toBe('Nenhum resultado (0 arquivos examinados). Pulados: 1 pasta funda demais.');
  });

  it('fora da pasta liberada e arquivo no lugar da pasta: negado', async () => {
    expect(await search('x', { path: box.outside })).toMatchObject({ ok: false, failure: { reason: 'denied', denial: { reason: 'outside' } } });
    const file = await box.write(join(box.released, 'a.txt'), 'x');
    expect(await search('x', { path: file })).toMatchObject({ ok: false, failure: { reason: 'denied', denial: { reason: 'kind' } } });
    expect(await runTool('file_search', { path: box.released, query: 'duas\nlinhas' }, { policy: box.policy })).toMatchObject({ ok: false, failure: { reason: 'input' } });
  });

  it('turno parado no meio da busca', async () => {
    for (let index = 1; index <= 3; index++) await box.write(join(box.released, `f${index}.txt`), 'alvo');
    const controller = new AbortController();
    let calls = 0;
    const outcome = await runTool('file_search', { path: box.released, query: 'alvo' }, {
      policy: box.policy,
      signal: controller.signal,
      now: () => {
        calls += 1;
        if (calls === 2) controller.abort();
        return 0;
      },
    });
    expect(outcome).toMatchObject({ ok: false, failure: { reason: 'cancelled' } });
  });
});
