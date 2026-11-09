import { describe, expect, it } from 'vitest';
import { VaultError } from '../vault';
import { readApiKey } from './api-key';

const KEY = `sk-ant-api03-${'a'.repeat(40)}`;

describe('readApiKey', () => {
  it('devolve a chave guardada', () => {
    expect(readApiKey({ get: () => KEY })).toEqual({ ok: true, key: KEY });
  });

  it('sem chave guardada', () => {
    expect(readApiKey({ get: () => null })).toEqual({ ok: false, problem: 'no_key' });
  });

  it('cofre que não abre', () => {
    expect(
      readApiKey({
        get: () => {
          throw new VaultError('unavailable');
        },
      }),
    ).toEqual({ ok: false, problem: 'vault' });
  });

  it('chave de administrador ou fora da forma no cofre não sai', () => {
    expect(readApiKey({ get: () => `sk-ant-admin01-${'a'.repeat(40)}` })).toEqual({ ok: false, problem: 'vault' });
    expect(readApiKey({ get: () => 'qualquer coisa' })).toEqual({ ok: false, problem: 'vault' });
  });
});
