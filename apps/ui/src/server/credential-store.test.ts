import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CredentialStoreConfigError, credentialStoreFromEnv } from './credential-store';

describe('onde fica a senha local', () => {
  it('sem variáveis, usa o arquivo de desenvolvimento na pasta atual', () => {
    expect(credentialStoreFromEnv({}, '/app')).toEqual({ kind: 'file', path: join('/app', '.jesus-dev', 'credentials.json') });
    expect(credentialStoreFromEnv({ JESUS_DATA_DIR: '', JESUS_DATABASE_URL: '' }, '/app')).toMatchObject({ kind: 'file' });
  });

  it('com JESUS_DATA_DIR, usa o arquivo dessa pasta', () => {
    expect(credentialStoreFromEnv({ JESUS_DATA_DIR: '/dados' }, '/app')).toEqual({
      kind: 'file',
      path: join('/dados', 'credentials.json'),
    });
  });

  it('com JESUS_DATABASE_URL, usa o banco (e ela vence a pasta de dados)', () => {
    const url = 'postgresql://jesus:segredo@127.0.0.1:5432/jesus';
    expect(credentialStoreFromEnv({ JESUS_DATABASE_URL: url, JESUS_DATA_DIR: '/dados' }, '/app')).toEqual({
      kind: 'database',
      url,
    });
    expect(credentialStoreFromEnv({ JESUS_DATABASE_URL: 'postgres://h/db' }, '/app')).toMatchObject({ kind: 'database' });
  });

  it('no app (https), sem pasta de dados nem banco, falha fechada em vez de usar a pasta atual', () => {
    expect(() => credentialStoreFromEnv({ JESUS_HTTPS: '1' }, '/app')).toThrow(CredentialStoreConfigError);
    expect(credentialStoreFromEnv({ JESUS_HTTPS: '1', JESUS_DATA_DIR: '/dados' }, '/app')).toMatchObject({ kind: 'file' });
  });

  it('URL fora do formato falha fechada, sem repetir a URL (ela traz a senha do banco)', () => {
    for (const url of ['mysql://jesus:segredo@h/db', 'segredo', 'postgresql://jesus:segredo@h/db com espaço']) {
      let error: unknown;
      try {
        credentialStoreFromEnv({ JESUS_DATABASE_URL: url }, '/app');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(CredentialStoreConfigError);
      expect(String((error as Error).message)).not.toContain('segredo');
    }
  });
});
