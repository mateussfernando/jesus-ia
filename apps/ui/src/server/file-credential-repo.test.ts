import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bcryptHasher, createAuthService } from '@jesus/auth';
import { hashPassword } from '@jesus/crypto/password';
import { describe, expect, it } from 'vitest';
import { CredentialFileError, createFileCredentialRepo } from './file-credential-repo';

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jesus-cred-'));
  return join(dir, 'sub', 'credentials.json');
}

describe('credencial em arquivo', () => {
  it('cria, lê, conta erros e troca os hashes, sempre com arquivo completo', async () => {
    const path = await tempFile();
    const repo = createFileCredentialRepo(path);
    const hash = await hashPassword('senha de teste comprida', { cost: 4 });
    expect(await repo.load()).toBeNull();
    expect(await repo.create({ passwordHash: hash, recoveryHash: hash, at: 1 })).toBe('created');
    expect(await repo.create({ passwordHash: hash, recoveryHash: hash, at: 2 })).toBe('exists');
    const counts = await Promise.all([repo.recordFailure(10), repo.recordFailure(11), repo.recordFailure(12)]);
    expect([...counts].sort()).toEqual([1, 2, 3]);
    expect(await repo.load()).toMatchObject({ failedAttempts: 3, lastFailedAt: 12 });
    const other = await hashPassword('outra senha comprida', { cost: 4 });
    await repo.replaceSecrets({ passwordHash: other, at: 20 });
    expect(await repo.load()).toMatchObject({ passwordHash: other, failedAttempts: 0, lastFailedAt: null, passwordChangedAt: 20 });
    // Nenhum temporário sobrando na pasta.
    expect(await readdir(join(path, '..'))).toEqual(['credentials.json']);
  });

  it('grava só para o dono (0600) no Linux e no macOS', async () => {
    if (process.platform === 'win32') return;
    const path = await tempFile();
    const repo = createFileCredentialRepo(path);
    const hash = await hashPassword('senha de teste comprida', { cost: 4 });
    await repo.create({ passwordHash: hash, recoveryHash: hash, at: 1 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('falha fechada com arquivo adulterado ou ilegível', async () => {
    const path = await tempFile();
    const repo = createFileCredentialRepo(path);
    const hash = await hashPassword('senha de teste comprida', { cost: 4 });
    await repo.create({ passwordHash: hash, recoveryHash: hash, at: 1 });
    const original = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...original, passwordHash: 'senha em texto puro' }));
    await expect(repo.load()).rejects.toBeInstanceOf(CredentialFileError);
    await writeFile(path, '{ quebrado');
    await expect(repo.load()).rejects.toBeInstanceOf(CredentialFileError);
    await writeFile(path, JSON.stringify({ ...original, extra: true }));
    await expect(repo.load()).rejects.toBeInstanceOf(CredentialFileError);
  });

  it('o serviço de login inteiro funciona sobre o arquivo e guarda a espera entre aberturas', async () => {
    const path = await tempFile();
    let now = 1_000_000;
    const make = () => createAuthService({ repo: createFileCredentialRepo(path), clock: { now: () => now }, hasher: bcryptHasher(4) });
    expect((await make().setup('girassol azul na janela')).ok).toBe(true);
    const first = make();
    for (let i = 0; i < 5; i++) await first.unlock('errada');
    expect(await make().unlock('girassol azul na janela')).toMatchObject({ ok: false, reason: 'throttled' });
    now += 30_000;
    expect(await make().unlock('girassol azul na janela')).toEqual({ ok: true });
  });
});
