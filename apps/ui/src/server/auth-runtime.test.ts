import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryCredentialRepo } from '@jesus/auth';
import type { CredentialRecord, CredentialRepo } from '@jesus/auth';
import { hashPassword } from '@jesus/crypto/password';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStoreConfigError } from './credential-store';

// O runtime de verdade, com o banco trocado por um repositório em memória que pode falhar nas primeiras leituras.
vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({ record: null as CredentialRecord | null, failLoads: 0, clients: 0 }));
vi.mock('@jesus/db/client', () => ({
  createDbClient: (url: string) => {
    db.clients++;
    return { url };
  },
}));
vi.mock('@jesus/db/credentials', () => ({
  createCredentialRepo: (): CredentialRepo => {
    const inner = createMemoryCredentialRepo(db.record);
    return {
      ...inner,
      load: () => {
        if (db.failLoads > 0) {
          db.failLoads--;
          return Promise.reject(new Error("P1001: Can't reach database server"));
        }
        return inner.load();
      },
    };
  },
}));

const { getAuthRuntime } = await import('./auth-runtime');

const KEYS = ['JESUS_DATABASE_URL', 'JESUS_DATA_DIR', 'JESUS_HTTPS'] as const;
const saved = new Map<string, string | undefined>();
const URL = 'postgresql://jesus:segredo@127.0.0.1:5432/jesus';

const BRIDGE_KEY = Symbol.for('jesus.desktop.bridge');

function resetProcessState() {
  Reflect.deleteProperty(globalThis, Symbol.for('jesus.ui.auth-runtime'));
  Reflect.deleteProperty(globalThis, Symbol.for('jesus.ui.credential-repo'));
  Reflect.deleteProperty(globalThis, BRIDGE_KEY);
}

/** Ponte falsa do app de desktop: guarda os ouvintes para o teste disparar bloqueio e uso. */
function installFakeBridge(idleMs?: number) {
  const listeners: { lock?: (reason: 'os_locked' | 'suspend') => void; activity?: () => void } = {};
  Object.defineProperty(globalThis, BRIDGE_KEY, {
    configurable: true,
    value: Object.freeze({
      idleMs,
      vault: { status: vi.fn(), setAnthropicKey: vi.fn(), clearAnthropicKey: vi.fn() },
      spend: { status: vi.fn(), setDailyLimit: vi.fn() },
      chat: { state: vi.fn(), reset: vi.fn(), send: vi.fn(), stop: vi.fn() },
      onLock: (listener: (reason: 'os_locked' | 'suspend') => void) => (listeners.lock = listener),
      onActivity: (listener: () => void) => (listeners.activity = listener),
    }),
  });
  return listeners;
}

beforeEach(async () => {
  for (const key of KEYS) saved.set(key, process.env[key]);
  for (const key of KEYS) Reflect.deleteProperty(process.env, key);
  resetProcessState();
  const hash = await hashPassword('senha do dono bem comprida', { cost: 4 });
  db.record = { passwordHash: hash, recoveryHash: hash, failedAttempts: 0, lastFailedAt: null, createdAt: 1, passwordChangedAt: 1 };
  db.failLoads = 0;
  db.clients = 0;
});

afterEach(() => {
  resetProcessState();
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

describe('runtime do login no servidor', () => {
  it('banco fora do ar no primeiro pedido: a nova tentativa usa o mesmo banco, nunca o arquivo', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'jesus-runtime-'));
    process.env['JESUS_DATABASE_URL'] = URL;
    process.env['JESUS_DATA_DIR'] = dataDir;
    db.failLoads = 2;
    await expect(getAuthRuntime()).rejects.toThrow('P1001');
    expect(process.env['JESUS_DATABASE_URL']).toBeUndefined();
    await expect(getAuthRuntime()).rejects.toThrow('P1001');
    // O banco voltou: o estado vem da senha do dono no banco (bloqueado), não de um arquivo vazio.
    const runtime = await getAuthRuntime();
    expect(runtime.state.lock.kind).toBe('locked');
    expect(await readdir(dataDir)).toEqual([]);
    expect(db.clients).toBe(1);
  });

  it('no app (https) só com o banco: depois da falha, volta quando o banco volta', async () => {
    process.env['JESUS_HTTPS'] = '1';
    process.env['JESUS_DATABASE_URL'] = URL;
    db.failLoads = 1;
    await expect(getAuthRuntime()).rejects.toThrow('P1001');
    expect((await getAuthRuntime()).state.lock.kind).toBe('locked');
  });

  it('no app de desktop: o bloqueio do Windows chega pela ponte; o uso da página não conta, o do principal conta', async () => {
    process.env['JESUS_DATA_DIR'] = await mkdtemp(join(tmpdir(), 'jesus-runtime-'));
    const bridge = installFakeBridge(5_000);
    const { beginCheck, beginSession, readAccess } = await import('./auth-runtime');
    const runtime = await getAuthRuntime();
    expect(runtime.policy).toEqual({ idleMs: 5_000, minIdleMs: 5_000 });
    expect(runtime.activityFromHost).toBe(true);
    // Pasta de dados vazia: a primeira sessão é a da criação da senha.
    const token = beginSession(runtime, { via: 'setup' });
    expect(token).not.toBeNull();
    expect(readAccess(runtime, token ?? undefined, false)).toBe(true);
    bridge.lock?.('os_locked');
    expect(runtime.state.lock).toMatchObject({ kind: 'locked', reason: 'os_locked' });
    expect(readAccess(runtime, token ?? undefined, false)).toBe(false);
    // O uso do principal conta (adia o bloqueio), sem precisar do cookie.
    const again = beginSession(runtime, beginCheck(runtime));
    const before = runtime.state.lock.kind === 'unlocked' ? runtime.state.lock.lastActivityAt : -1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    bridge.activity?.();
    expect(runtime.state.lock.kind === 'unlocked' ? runtime.state.lock.lastActivityAt : -1).toBeGreaterThan(before);
    expect(readAccess(runtime, again ?? undefined, false)).toBe(true);
  });

  it('sem ponte (next dev): tempo sem uso do ambiente e o uso da página conta', async () => {
    process.env['JESUS_DATA_DIR'] = await mkdtemp(join(tmpdir(), 'jesus-runtime-'));
    const runtime = await getAuthRuntime();
    expect(runtime.activityFromHost).toBe(false);
    expect(runtime.policy).toEqual({ idleMs: 15 * 60_000 });
  });

  it('erro de configuração fica até reiniciar (falha fechada)', async () => {
    process.env['JESUS_HTTPS'] = '1';
    await expect(getAuthRuntime()).rejects.toBeInstanceOf(CredentialStoreConfigError);
    process.env['JESUS_DATA_DIR'] = await mkdtemp(join(tmpdir(), 'jesus-runtime-'));
    await expect(getAuthRuntime()).rejects.toBeInstanceOf(CredentialStoreConfigError);
  });
});
