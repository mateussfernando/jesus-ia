import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Vault, VaultError, vaultProblem } from './vault';
import type { SafeStorageLike } from './vault';

/** `safeStorage` falso: "cifra" invertendo os bytes, com o prefixo de versão escolhido. */
function fakeStorage(options: { available?: boolean; backend?: string; prefix?: string } = {}): SafeStorageLike {
  const prefix = options.prefix ?? 'v11';
  return {
    isEncryptionAvailable: () => options.available ?? true,
    getSelectedStorageBackend: () => options.backend ?? 'gnome_libsecret',
    encryptString: (plain) => Buffer.concat([Buffer.from(prefix, 'latin1'), Buffer.from(plain, 'utf8').reverse()]),
    decryptString: (blob) => Buffer.from(blob.subarray(3)).reverse().toString('utf8'),
  };
}

const SECRET = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');
let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jesus-cofre-'));
  path = join(dir, 'vault.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('cofre do processo principal', () => {
  it('guarda cifrado, devolve aberto, e o arquivo não tem o texto', async () => {
    const vault = new Vault(path, fakeStorage(), 'linux');
    expect(vault.get('anthropic_api_key')).toBeNull();
    vault.set('anthropic_api_key', SECRET);
    expect(vault.get('anthropic_api_key')).toBe(SECRET);
    expect(vault.has('anthropic_api_key')).toBe(true);
    const content = await readFile(path, 'utf8');
    expect(content).not.toContain(SECRET);
    expect(await readdir(dir)).toEqual(['vault.json']);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('apagar tira só a entrada pedida', () => {
    const vault = new Vault(path, fakeStorage(), 'linux');
    vault.set('anthropic_api_key', SECRET);
    vault.set('audit_anchor', '{"seq":1}');
    vault.delete('anthropic_api_key');
    vault.delete('anthropic_api_key');
    expect(vault.get('anthropic_api_key')).toBeNull();
    expect(vault.get('audit_anchor')).toBe('{"seq":1}');
  });

  it('no Linux sem chaveiro do sistema (senha embutida) ou antes do ready, o cofre recusa', () => {
    for (const backend of ['basic_text', 'unknown']) {
      const vault = new Vault(path, fakeStorage({ backend }), 'linux');
      expect(vault.problem()).toBe('insecure_backend');
      expect(() => vault.set('anthropic_api_key', SECRET)).toThrow(VaultError);
    }
    expect(vaultProblem(fakeStorage({ backend: 'basic_text' }), 'win32')).toBeNull();
    expect(vaultProblem(fakeStorage({ available: false }), 'win32')).toBe('unavailable');
  });

  it('no Linux, só blob v11 (o v10 é cifrado com uma senha conhecida); no Windows, o DPAPI decide', () => {
    expect(() => new Vault(path, fakeStorage({ prefix: 'v10' }), 'linux').set('anthropic_api_key', SECRET)).toThrow(VaultError);
    const windows = new Vault(path, fakeStorage({ prefix: 'v10' }), 'win32');
    windows.set('anthropic_api_key', SECRET);
    expect(windows.get('anthropic_api_key')).toBe(SECRET);
    expect(() => new Vault(path, fakeStorage({ prefix: 'v11' }), 'linux').get('anthropic_api_key')).toThrow(VaultError);
  });

  it('arquivo estragado ou com campo estranho: erro, sem adivinhar', async () => {
    const vault = new Vault(path, fakeStorage(), 'linux');
    for (const content of ['{', '{"v":2,"entries":{}}', '{"v":1,"entries":{"outra":"AAAA"}}', '{"v":1,"entries":{},"x":1}']) {
      await writeFile(path, content);
      expect(() => vault.get('anthropic_api_key'), content).toThrow(VaultError);
    }
  });
});
