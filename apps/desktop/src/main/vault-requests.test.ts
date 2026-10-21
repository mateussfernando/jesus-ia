import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@jesus/shared/audit';
import type { VaultRequest } from '../bridge/protocol';
import { VaultError } from './vault';
import type { VaultEntry, VaultProblem } from './vault';
import { createVaultRequests, MAX_VAULT_WRITES_PER_MINUTE } from './vault-requests';
import type { VaultRequestsOptions } from './vault-requests';

const KEY = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');
const ADMIN = ['sk-', 'ant-', 'admin01-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');

function memoryVault(problem: VaultProblem | null = null) {
  const entries = new Map<VaultEntry, string>();
  return {
    entries,
    problem: () => problem,
    has: (entry: VaultEntry) => entries.has(entry),
    get: (entry: VaultEntry) => entries.get(entry) ?? null,
    set: (entry: VaultEntry, value: string) => void entries.set(entry, value),
    delete: (entry: VaultEntry) => void entries.delete(entry),
  };
}

function handler(vault: VaultRequestsOptions['vault'], clock = { ms: 0 }) {
  const events: AuditEvent[] = [];
  const handle = createVaultRequests({ vault, record: (event) => events.push(event), now: () => clock.ms });
  let id = 0;
  const send = (op: VaultRequest['op'], key?: string) => handle({ type: 'vault', id: (id += 1), op, ...(key === undefined ? {} : { key }) });
  return { send, events, clock };
}

describe('pedidos ao cofre', () => {
  it('salva a chave de API comum, registra o fato e nunca a chave', () => {
    const vault = memoryVault();
    const { send, events } = handler(vault);
    expect(send('status')).toEqual({ ok: true, anthropicKey: 'absent' });
    expect(send('set-anthropic-key', ` ${KEY} `)).toEqual({ ok: true, anthropicKey: 'present' });
    expect(vault.entries.get('anthropic_api_key')).toBe(KEY);
    expect(send('status')).toEqual({ ok: true, anthropicKey: 'present' });
    expect(events).toEqual([{ type: 'vault.key_saved', provider: 'anthropic' }]);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('recusa a chave de administrador e o que não tem forma de chave (mesmo que a tela deixe passar)', () => {
    const vault = memoryVault();
    const { send, events } = handler(vault);
    expect(send('set-anthropic-key', ADMIN)).toMatchObject({ ok: false, problem: 'admin' });
    expect(send('set-anthropic-key', 'oi')).toMatchObject({ ok: false, problem: 'format' });
    expect(send('set-anthropic-key')).toMatchObject({ ok: false, problem: 'format' });
    expect(vault.entries.size).toBe(0);
    expect(JSON.stringify(events)).not.toContain(ADMIN);
  });

  it('cofre indisponível: não salva, mas apagar ainda funciona', () => {
    const vault = memoryVault('insecure_backend');
    vault.entries.set('anthropic_api_key', KEY);
    const { send } = handler(vault);
    expect(send('set-anthropic-key', KEY)).toEqual({ ok: false, anthropicKey: 'present', problem: 'insecure_backend' });
    expect(send('status')).toMatchObject({ ok: false, problem: 'insecure_backend' });
    expect(send('clear-anthropic-key')).toEqual({ ok: true, anthropicKey: 'absent' });
  });

  it('falha ao gravar vira "failed", sem detalhe', () => {
    const vault = {
      ...memoryVault(),
      set: () => {
        throw new Error('disco cheio');
      },
    };
    expect(handler(vault).send('set-anthropic-key', KEY)).toEqual({ ok: false, anthropicKey: 'absent', problem: 'failed' });
  });

  it('chave guardada que não abre mais (outra máquina, perfil refeito) ou cofre estragado: "unknown", e não "guardada"', () => {
    const undecryptable = {
      ...memoryVault(),
      get: () => {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      },
    };
    undecryptable.entries.set('anthropic_api_key', 'blob');
    expect(handler(undecryptable).send('status')).toEqual({ ok: true, anthropicKey: 'unknown' });
    const corrupt = {
      ...memoryVault(),
      has: () => {
        throw new VaultError('corrupt');
      },
    };
    expect(handler(corrupt).send('status')).toEqual({ ok: true, anthropicKey: 'unknown' });
  });

  it('recusas vão ao registro no máximo uma vez por minuto, com a contagem das que ficaram de fora', () => {
    const { send, events, clock } = handler(memoryVault());
    for (let i = 0; i < 5; i++) send('set-anthropic-key', ADMIN);
    clock.ms += 61_000;
    send('set-anthropic-key', 'oi');
    expect(events).toEqual([
      { type: 'vault.key_refused', provider: 'anthropic', reason: 'admin' },
      { type: 'vault.key_refused', provider: 'anthropic', reason: 'format', suppressed: 4 },
    ]);
  });

  it('gravações demais em um minuto: o excesso não grava nem vai ao registro (um aviso por minuto)', () => {
    const vault = memoryVault();
    const { send, events, clock } = handler(vault);
    for (let i = 0; i < MAX_VAULT_WRITES_PER_MINUTE; i++) expect(send('set-anthropic-key', KEY).ok).toBe(true);
    const saved = events.length;
    vault.entries.clear();
    for (let i = 0; i < 50; i++) expect(send(i % 2 === 0 ? 'set-anthropic-key' : 'clear-anthropic-key', KEY)).toMatchObject({ ok: false, problem: 'failed' });
    expect(vault.entries.size).toBe(0);
    expect(events.slice(saved)).toEqual([{ type: 'vault.throttled' }]);
    // O status não conta.
    expect(send('status')).toEqual({ ok: true, anthropicKey: 'absent' });
    clock.ms += 60_000;
    expect(send('set-anthropic-key', KEY)).toEqual({ ok: true, anthropicKey: 'present' });
  });
});
