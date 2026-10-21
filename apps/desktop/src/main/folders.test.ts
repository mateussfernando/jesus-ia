import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReadPolicy } from '@jesus/gate';
import type { AuditEvent } from '@jesus/shared/audit';
import { FolderStore } from './folders';
import type { FolderStoreOptions } from './folders';
import { confirmText, releaseFolderFlow } from './release-folder';
import type { ConfirmText } from './release-folder';

let base: string;
let home: string;
let file: string;
let events: AuditEvent[];

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'jesus-folders-')));
  home = join(base, 'home');
  await mkdir(join(home, 'Documentos', 'escola'), { recursive: true });
  await mkdir(join(home, 'projetos', 'site'), { recursive: true });
  file = join(base, 'folders.json');
  events = [];
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

let ids = 0;
function options(extra: Partial<FolderStoreOptions> = {}): FolderStoreOptions {
  return {
    path: file,
    policy: createReadPolicy({
      platform: 'posix',
      released: [],
      places: { home, localAppData: join(home, '.config'), roamingAppData: join(home, '.config'), personal: [join(home, 'Documentos')], system: ['/etc', '/usr'] },
    }),
    audit: async (event) => {
      events.push(event);
    },
    auditHealthy: true,
    now: () => 1_000,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    platform: 'linux',
    ...extra,
  };
}

describe('pastas liberadas', () => {
  it('libera, guarda no disco (registro antes) e reabre com a mesma lista', async () => {
    const store = await FolderStore.open(options());
    expect(store.list()).toEqual([]);
    const added = await store.add(join(home, 'projetos', 'site'));
    expect(added).toMatchObject({ ok: true, folder: { path: join(home, 'projetos', 'site'), releasedAt: 1_000 } });
    expect(events.map((event) => event.type)).toEqual(['folder.released']);
    const reopened = await FolderStore.open(options());
    expect(reopened.releasedPaths()).toEqual([join(home, 'projetos', 'site')]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ v: 1, folders: [{ path: join(home, 'projetos', 'site') }] });
  });

  it('recusa pelo Porteiro, a repetida (ou dentro de uma liberada) e a lista cheia', async () => {
    const store = await FolderStore.open(options());
    expect(await store.add(home)).toMatchObject({ ok: false, reason: 'refused', refusal: { reason: 'too_broad' } });
    expect(await store.add(join(home, 'Documentos'))).toMatchObject({ ok: false, reason: 'refused', refusal: { reason: 'personal' } });
    expect((await store.add(join(home, 'Documentos', 'escola'))).ok).toBe(true);
    expect(await store.add(join(home, 'Documentos', 'escola'))).toEqual({ ok: false, reason: 'duplicate' });
    expect(await store.add(join(home, 'Documentos', 'escola', 'sub'))).toEqual({ ok: false, reason: 'duplicate' });
    for (let index = 1; index < 32; index++) expect((await store.add(join(home, 'p', String(index)))).ok).toBe(true);
    expect(await store.add(join(home, 'p', 'mais'))).toEqual({ ok: false, reason: 'full' });
  });

  it('sem registro, não libera', async () => {
    const store = await FolderStore.open(options({ audit: () => Promise.reject(new Error('sem registro')) }));
    expect(await store.add(join(home, 'projetos'))).toEqual({ ok: false, reason: 'unavailable' });
    expect(store.list()).toEqual([]);
  });

  it('remove na hora (a leitura para) e registra', async () => {
    const store = await FolderStore.open(options());
    const added = await store.add(join(home, 'projetos'));
    if (!added.ok) throw new Error('era para liberar');
    expect(await store.remove(added.folder.id)).toBe(true);
    expect(await store.remove(added.folder.id)).toBe(false);
    expect(store.list()).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['folder.released', 'folder.removed']);
    expect((await FolderStore.open(options())).list()).toEqual([]);
  });

  it('ao abrir, cada pasta passa de novo pelo Porteiro: a mexida à mão que ele recusa sai', async () => {
    await writeFile(
      file,
      JSON.stringify({
        v: 1,
        folders: [
          { id: '00000000-0000-4000-8000-000000000001', path: join(home, 'projetos'), releasedAt: 1 },
          { id: '00000000-0000-4000-8000-000000000002', path: home, releasedAt: 2 },
          { id: '00000000-0000-4000-8000-000000000003', path: '/etc', releasedAt: 3 },
        ],
      }),
    );
    const store = await FolderStore.open(options());
    expect(store.releasedPaths()).toEqual([join(home, 'projetos')]);
    expect(events).toEqual([
      { type: 'folder.dropped', id: '00000000-0000-4000-8000-000000000002', reason: 'too_broad' },
      { type: 'folder.dropped', id: '00000000-0000-4000-8000-000000000003', reason: 'system' },
    ]);
    expect(JSON.parse(await readFile(file, 'utf8')).folders).toHaveLength(1);
  });

  it('arquivo estragado vai para o lado e a lista começa vazia', async () => {
    await writeFile(file, '{"v":1,"folders":[{"id":"x"}]}');
    const store = await FolderStore.open(options());
    expect(store.list()).toEqual([]);
    expect(events).toEqual([{ type: 'folders.reset', reason: 'corrupt' }]);
    expect((await readdir(base)).some((name) => name.startsWith('folders.json.estragado-'))).toBe(true);
  });

  it('registro de auditoria posto de lado: nenhuma pasta, e liberar fica desligado', async () => {
    const store = await FolderStore.open(options());
    await store.add(join(home, 'projetos'));
    events = [];
    const after = await FolderStore.open(options({ auditHealthy: false }));
    expect(after.available).toBe(false);
    expect(after.list()).toEqual([]);
    expect(events).toEqual([{ type: 'folders.cleared', reason: 'audit_unhealthy', count: 1 }]);
    expect(await after.add(join(home, 'outra'))).toEqual({ ok: false, reason: 'unavailable' });
    expect((await FolderStore.open(options())).list()).toEqual([]);
  });
});

describe('liberar pasta pelo diálogo', () => {
  async function flow(picked: string | null, confirm: boolean, realpathOf = async (path: string) => path) {
    const store = await FolderStore.open(options());
    const shown: ConfirmText[] = [];
    const result = await releaseFolderFlow({
      pick: async () => picked,
      realpath: realpathOf,
      confirm: async (text) => {
        shown.push(text);
        return confirm;
      },
      store,
    });
    return { result, shown, store };
  }

  it('escolheu, o Porteiro deixou e o dono confirmou: liberada, com o caminho real', async () => {
    const { result, shown } = await flow(join(home, 'atalho'), true, async () => join(home, 'projetos', 'site'));
    expect(result).toMatchObject({ status: 'released', folder: { path: join(home, 'projetos', 'site') } });
    expect(shown[0]?.message).toContain(join(home, 'projetos', 'site'));
    expect(shown[0]?.detail).toContain('vai para a Anthropic');
  });

  it('cancelou no diálogo ou na confirmação: nada muda', async () => {
    expect((await flow(null, true)).result).toEqual({ status: 'cancelled' });
    const declined = await flow(join(home, 'projetos'), false);
    expect(declined.result).toEqual({ status: 'cancelled' });
    expect(declined.store.list()).toEqual([]);
  });

  it('o Porteiro recusa antes da confirmação, com o motivo em texto', async () => {
    const { result, shown } = await flow(join(home, 'Documentos'), true);
    expect(result).toEqual({
      status: 'refused',
      message: 'Documentos, Downloads, Área de Trabalho, Imagens, Vídeos e Música não podem ser liberados inteiros. Escolha uma pasta dentro deles.',
    });
    expect(shown).toEqual([]);
    expect((await flow(join(home, 'sumiu'), true, () => Promise.reject(new Error('ENOENT')))).result).toEqual({ status: 'refused', message: 'Não deu para abrir essa pasta.' });
  });

  it('o texto da confirmação é feito por código', () => {
    expect(confirmText('C:\\Users\\Mateus\\Projetos')).toMatchObject({ title: 'Liberar pasta', confirmLabel: 'Liberar', cancelLabel: 'Cancelar' });
  });
});
