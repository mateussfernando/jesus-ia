import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileAnchorStore, sealedAnchorStore } from './audit-anchor';
import { Vault } from './vault';
import type { SafeStorageLike } from './vault';

/** `safeStorage` falso: "cifra" invertendo os bytes, com o prefixo `v11` (chaveiro do sistema, no Linux). */
function fakeStorage(options: { decryptFails?: boolean } = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (plain) => Buffer.concat([Buffer.from('v11', 'latin1'), Buffer.from(plain, 'utf8').reverse()]),
    decryptString: (blob) => {
      if (options.decryptFails === true) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return Buffer.from(blob.subarray(3)).reverse().toString('utf8');
    },
  };
}

const KEY = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');
const anchor = (seq: number) => ({ seq, hash: String(seq % 10).repeat(64) });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jesus-ancora-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(storage = fakeStorage()) {
  const vault = new Vault(join(dir, 'vault.json'), storage, { platform: 'linux' });
  const legacy = fileAnchorStore(join(dir, 'audit-anchor.json'), 'linux');
  const store = sealedAnchorStore({ path: join(dir, 'audit-anchor.vault'), storage, platform: 'linux', previous: { vault, legacy } });
  return { vault, legacy, store };
}

describe('âncora do registro num arquivo comum (onde o cofre não funciona)', () => {
  it('sem arquivo, não há âncora; grava e lê de volta', async () => {
    const store = fileAnchorStore(join(dir, 'ancora.json'));
    expect(await store.read()).toBeNull();
    await store.write(anchor(7));
    expect(await store.read()).toEqual(anchor(7));
    expect(JSON.parse(await readFile(join(dir, 'ancora.json'), 'utf8'))).toEqual(anchor(7));
    expect(await readdir(dir)).toEqual(['ancora.json']);
  });

  it('âncora estragada ou com campo a mais: a leitura lança (o registro trata como ilegível)', async () => {
    const path = join(dir, 'ancora.json');
    const store = fileAnchorStore(path);
    for (const content of ['{', '{"seq":0,"hash":"x"}', JSON.stringify({ ...anchor(1), extra: 1 })]) {
      await writeFile(path, content);
      await expect(store.read(), content).rejects.toThrow('âncora estragada');
    }
  });
});

describe('âncora cifrada num arquivo próprio', () => {
  it('grava cifrada, lê de volta, e nunca regrava o arquivo da chave', async () => {
    const { vault, store } = setup();
    vault.set('anthropic_api_key', KEY);
    const keyFile = await readFile(join(dir, 'vault.json'), 'utf8');
    for (let seq = 1; seq <= 20; seq++) await store.write(anchor(seq));
    expect(await store.read()).toEqual(anchor(20));
    expect(await readFile(join(dir, 'vault.json'), 'utf8')).toBe(keyFile);
    expect(await readFile(join(dir, 'audit-anchor.vault'), 'utf8')).not.toContain(anchor(20).hash);
    expect((await readdir(dir)).sort()).toEqual(['audit-anchor.vault', 'vault.json']);
  });

  it('migração: vale a âncora do cofre da chave (etapa 8) até a primeira gravação, que apaga as antigas', async () => {
    const { vault, legacy, store } = setup();
    vault.set('anthropic_api_key', KEY);
    vault.set('audit_anchor', JSON.stringify(anchor(3)));
    await legacy.write(anchor(1));
    expect(await store.read()).toEqual(anchor(3));
    await store.write(anchor(4));
    expect(await store.read()).toEqual(anchor(4));
    expect(vault.has('audit_anchor')).toBe(false);
    expect(vault.get('anthropic_api_key')).toBe(KEY);
    expect(await legacy.read()).toBeNull();
  });

  it('migração: sem âncora no cofre, vale a do arquivo comum (etapas 6 e 7)', async () => {
    const { legacy, store } = setup();
    await legacy.write(anchor(5));
    expect(await store.read()).toEqual(anchor(5));
    await store.write(anchor(6));
    expect(await legacy.read()).toBeNull();
  });

  it('arquivo estragado ou cifra que não abre: a leitura lança (o registro trata como ilegível)', async () => {
    const { store } = setup();
    await store.write(anchor(2));
    for (const content of ['\u0000'.repeat(80), '{"v":1}', '{"v":1,"anchor":"QUJD"}']) {
      await writeFile(join(dir, 'audit-anchor.vault'), content);
      await expect(store.read(), content).rejects.toThrow();
    }
    const other = setup(fakeStorage({ decryptFails: true }));
    await other.store.write(anchor(2));
    await expect(other.store.read()).rejects.toThrow('decrypting');
  });

  it('o cofre da chave estragado não impede a âncora (nem é recomeçado por ela)', async () => {
    const { store } = setup();
    await writeFile(join(dir, 'vault.json'), '{');
    // A leitura cai na migração e acha o cofre estragado: ilegível.
    await expect(store.read()).rejects.toThrow();
    await store.write(anchor(1));
    expect(await store.read()).toEqual(anchor(1));
    expect(await readFile(join(dir, 'vault.json'), 'utf8')).toBe('{');
  });
});
