import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@jesus/shared/audit';
import type { VaultEntry, VaultProblem } from './vault';
import { handleVaultRequest } from './vault-requests';

const KEY = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');
const ADMIN = ['sk-', 'ant-', 'admin01-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');

function memoryVault(problem: VaultProblem | null = null) {
  const entries = new Map<VaultEntry, string>();
  return {
    entries,
    problem: () => problem,
    has: (entry: VaultEntry) => entries.has(entry),
    set: (entry: VaultEntry, value: string) => void entries.set(entry, value),
    delete: (entry: VaultEntry) => void entries.delete(entry),
  };
}

describe('pedidos ao cofre', () => {
  it('salva a chave de API comum, registra o fato e nunca a chave', () => {
    const vault = memoryVault();
    const events: AuditEvent[] = [];
    expect(handleVaultRequest({ type: 'vault', id: 1, op: 'status' }, vault, (e) => events.push(e))).toEqual({ ok: true, anthropicKey: 'absent' });
    expect(handleVaultRequest({ type: 'vault', id: 2, op: 'set-anthropic-key', key: ` ${KEY} ` }, vault, (e) => events.push(e))).toEqual({
      ok: true,
      anthropicKey: 'present',
    });
    expect(vault.entries.get('anthropic_api_key')).toBe(KEY);
    expect(events).toEqual([{ type: 'vault.key_saved', provider: 'anthropic' }]);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('recusa a chave de administrador e o que não tem forma de chave (mesmo que a tela deixe passar)', () => {
    const vault = memoryVault();
    const events: AuditEvent[] = [];
    expect(handleVaultRequest({ type: 'vault', id: 1, op: 'set-anthropic-key', key: ADMIN }, vault, (e) => events.push(e))).toMatchObject({ ok: false, problem: 'admin' });
    expect(handleVaultRequest({ type: 'vault', id: 2, op: 'set-anthropic-key', key: 'oi' }, vault, (e) => events.push(e))).toMatchObject({ ok: false, problem: 'format' });
    expect(handleVaultRequest({ type: 'vault', id: 3, op: 'set-anthropic-key' }, vault, (e) => events.push(e))).toMatchObject({ ok: false, problem: 'format' });
    expect(vault.entries.size).toBe(0);
    expect(JSON.stringify(events)).not.toContain(ADMIN);
  });

  it('cofre indisponível: não salva, mas apagar ainda funciona', () => {
    const vault = memoryVault('insecure_backend');
    vault.entries.set('anthropic_api_key', KEY);
    expect(handleVaultRequest({ type: 'vault', id: 1, op: 'set-anthropic-key', key: KEY }, vault, () => undefined)).toEqual({
      ok: false,
      anthropicKey: 'present',
      problem: 'insecure_backend',
    });
    expect(handleVaultRequest({ type: 'vault', id: 2, op: 'status' }, vault, () => undefined)).toMatchObject({ ok: false, problem: 'insecure_backend' });
    expect(handleVaultRequest({ type: 'vault', id: 3, op: 'clear-anthropic-key' }, vault, () => undefined)).toEqual({ ok: true, anthropicKey: 'absent' });
  });

  it('falha ao gravar vira "failed", sem detalhe', () => {
    const vault = {
      ...memoryVault(),
      set: () => {
        throw new Error('disco cheio');
      },
    };
    expect(handleVaultRequest({ type: 'vault', id: 1, op: 'set-anthropic-key', key: KEY }, vault, () => undefined)).toEqual({
      ok: false,
      anthropicKey: 'absent',
      problem: 'failed',
    });
  });
});
