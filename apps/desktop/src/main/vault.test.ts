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
    const vault = new Vault(path, fakeStorage(), { platform: 'linux' });
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
    const vault = new Vault(path, fakeStorage(), { platform: 'linux' });
    vault.set('anthropic_api_key', SECRET);
    vault.set('audit_anchor', '{"seq":1}');
    vault.delete('anthropic_api_key');
    vault.delete('anthropic_api_key');
    expect(vault.get('anthropic_api_key')).toBeNull();
    expect(vault.get('audit_anchor')).toBe('{"seq":1}');
  });

  it('no Linux sem chaveiro do sistema (senha embutida) ou antes do ready, o cofre recusa', () => {
    for (const backend of ['basic_text', 'unknown']) {
      const vault = new Vault(path, fakeStorage({ backend }), { platform: 'linux' });
      expect(vault.problem()).toBe('insecure_backend');
      expect(() => vault.set('anthropic_api_key', SECRET)).toThrow(VaultError);
    }
    expect(vaultProblem(fakeStorage({ backend: 'basic_text' }), 'win32')).toBeNull();
    expect(vaultProblem(fakeStorage({ available: false }), 'win32')).toBe('unavailable');
  });

  it('no Linux, só blob v11 (o v10 é cifrado com uma senha conhecida); no Windows, o DPAPI decide', () => {
    expect(() => new Vault(path, fakeStorage({ prefix: 'v10' }), { platform: 'linux' }).set('anthropic_api_key', SECRET)).toThrow(VaultError);
    const windows = new Vault(path, fakeStorage({ prefix: 'v10' }), { platform: 'win32' });
    windows.set('anthropic_api_key', SECRET);
    expect(windows.get('anthropic_api_key')).toBe(SECRET);
    expect(() => new Vault(path, fakeStorage({ prefix: 'v11' }), { platform: 'linux' }).get('anthropic_api_key')).toThrow(VaultError);
  });

  it('arquivo estragado ou com campo estranho: a leitura dá erro, sem adivinhar e sem apagar nada', async () => {
    const vault = new Vault(path, fakeStorage(), { platform: 'linux' });
    for (const content of ['{', '\u0000'.repeat(64), '{"v":2,"entries":{}}', '{"v":1,"entries":{"Maiuscula":"AAAA"}}', '{"v":1,"entries":{"anthropic_api_key":"não é base64"}}', '{"v":1,"entries":{},"x":1}']) {
      await writeFile(path, content);
      expect(() => vault.get('anthropic_api_key'), content).toThrow(VaultError);
      expect(() => vault.has('anthropic_api_key'), content).toThrow(VaultError);
      expect(await readFile(path, 'utf8')).toBe(content);
    }
  });

  it('arquivo estragado (queda no meio de uma gravação antiga): guardar ou apagar a chave põe o arquivo de lado e recomeça', async () => {
    const resets: string[] = [];
    const vault = new Vault(path, fakeStorage(), { platform: 'linux', onReset: (name) => resets.push(name), now: () => Date.UTC(2026, 9, 19) });
    const zeros = '\u0000'.repeat(300);
    await writeFile(path, zeros);
    vault.set('anthropic_api_key', SECRET);
    expect(vault.get('anthropic_api_key')).toBe(SECRET);
    expect(resets).toEqual([`${path}.estragado-2026-10-19T00-00-00-000Z`]);
    // A prova fica como estava.
    expect(await readFile(resets[0] ?? '', 'utf8')).toBe(zeros);

    await writeFile(path, '{');
    vault.delete('anthropic_api_key');
    expect(vault.get('anthropic_api_key')).toBeNull();
    expect(resets).toHaveLength(2);
  });

  it('entradas de uma versão mais nova são guardadas como vieram', async () => {
    await writeFile(path, JSON.stringify({ v: 1, entries: { github_token: 'QUJD' } }));
    const vault = new Vault(path, fakeStorage(), { platform: 'linux' });
    vault.set('anthropic_api_key', SECRET);
    vault.delete('anthropic_api_key');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ v: 1, entries: { github_token: 'QUJD' } });
  });

  it('a gravação não deixa o temporário para trás', async () => {
    const vault = new Vault(path, fakeStorage(), { platform: 'linux' });
    vault.set('anthropic_api_key', SECRET);
    vault.set('anthropic_api_key', SECRET);
    expect(await readdir(dir)).toEqual(['vault.json']);
  });
});
