import { describe, expect, it } from 'vitest';
import { acceptsRequests, clampIdleMs, initialLockState, lockTransition } from './lock';
import type { LockEvent, LockState } from './lock';

const MIN = 60_000;
const policy = { idleMs: 15 * MIN };

function run(events: readonly LockEvent[], start: LockState = initialLockState) {
  let state = start;
  const effects = [];
  for (const event of events) {
    const t = lockTransition(state, event, policy);
    state = t.state;
    effects.push(...t.effects);
  }
  return { state, effects };
}

describe('lockTransition', () => {
  it('primeira vez: pede para criar a senha e entra desbloqueado', () => {
    const { state, effects } = run([
      { e: 'CREDENTIAL_LOADED', now: 0, exists: false },
      { e: 'PASSWORD_SET', now: 10 },
    ]);
    expect(state).toEqual({ kind: 'unlocked', since: 10, lastActivityAt: 10 });
    expect(effects).toEqual([{ fx: 'show_setup' }, { fx: 'show_app' }, { fx: 'schedule_tick', at: 10 + 15 * MIN }]);
  });

  it('com senha criada, abre bloqueado e só desbloqueia com UNLOCKED', () => {
    const { state } = run([
      { e: 'CREDENTIAL_LOADED', now: 0, exists: true },
      { e: 'ACTIVITY', now: 5 },
      { e: 'PASSWORD_SET', now: 6 },
    ]);
    expect(state).toMatchObject({ kind: 'locked', reason: 'startup' });
    expect(acceptsRequests(state)).toBe(false);
    const after = lockTransition(state, { e: 'UNLOCKED', now: 7, lockedSince: 0 }, policy).state;
    expect(acceptsRequests(after)).toBe(true);
  });

  it('bloqueia depois de 15 min sem uso e cancela cartões e fluxos de conexão', () => {
    const unlocked: LockState = { kind: 'unlocked', since: 0, lastActivityAt: 0 };
    const early = lockTransition(unlocked, { e: 'TICK', now: 14 * MIN }, policy);
    expect(early.state.kind).toBe('unlocked');
    expect(early.effects).toEqual([{ fx: 'schedule_tick', at: 15 * MIN }]);

    const late = lockTransition(unlocked, { e: 'TICK', now: 15 * MIN }, policy);
    expect(late.state).toEqual({ kind: 'locked', reason: 'idle', since: 15 * MIN });
    expect(late.effects).toEqual([
      { fx: 'cancel_pending_confirmations' },
      { fx: 'cancel_connection_flows' },
      { fx: 'show_lock_screen', reason: 'idle' },
    ]);
  });

  it('atividade adia o bloqueio', () => {
    const s0: LockState = { kind: 'unlocked', since: 0, lastActivityAt: 10 * MIN };
    const s1 = lockTransition(s0, { e: 'ACTIVITY', now: 12 * MIN }, policy).state;
    expect(s1).toMatchObject({ lastActivityAt: 12 * MIN });
    expect(lockTransition(s1, { e: 'ACTIVITY', now: 12 * MIN }, policy).state).toBe(s1);
    expect(lockTransition(s1, { e: 'TICK', now: 26 * MIN }, policy).state.kind).toBe('unlocked');
    expect(lockTransition(s1, { e: 'TICK', now: 27 * MIN }, policy).state.kind).toBe('locked');
  });

  it('relógio que volta não adia o bloqueio pelo tamanho do salto', () => {
    const H = 60 * MIN;
    // Desbloqueado com o relógio 3 h adiantado; depois o relógio é corrigido e ninguém mexe no PC.
    const ahead: LockState = { kind: 'unlocked', since: 3 * H, lastActivityAt: 3 * H };
    const first = lockTransition(ahead, { e: 'TICK', now: MIN }, policy);
    expect(first.state).toEqual({ kind: 'unlocked', since: 3 * H, lastActivityAt: MIN });
    expect(first.effects).toEqual([{ fx: 'schedule_tick', at: 16 * MIN }]);
    expect(lockTransition(first.state, { e: 'TICK', now: 16 * MIN }, policy).state.kind).toBe('locked');

    // Atividade com a hora corrigida também passa a contar de agora.
    const active = lockTransition(ahead, { e: 'ACTIVITY', now: 2 * MIN }, policy).state;
    expect(active).toMatchObject({ lastActivityAt: 2 * MIN });
    expect(lockTransition(active, { e: 'TICK', now: 17 * MIN }, policy).state.kind).toBe('locked');
  });

  it('bloqueio que chega durante a conferência da senha vence o desbloqueio atrasado', () => {
    const locked: LockState = { kind: 'locked', reason: 'startup', since: 0 };
    // A senha chega com o estado bloqueado desde 0; no meio da conferência, o Windows bloqueia.
    const relocked = lockTransition(locked, { e: 'OS_LOCKED', now: 100 }, policy);
    expect(relocked.state).toEqual({ kind: 'locked', reason: 'os_locked', since: 100 });
    expect(relocked.effects).toEqual([]);
    const late = lockTransition(relocked.state, { e: 'UNLOCKED', now: 400, lockedSince: 0 }, policy);
    expect(late.state).toBe(relocked.state);
    expect(late.effects).toEqual([]);
    // Uma senha digitada depois do bloqueio desbloqueia.
    expect(lockTransition(relocked.state, { e: 'UNLOCKED', now: 900, lockedSince: 100 }, policy).state.kind).toBe(
      'unlocked',
    );
    // Suspensão e pedido manual também renovam o bloqueio; no mesmo instante, o `since` muda mesmo assim.
    expect(lockTransition(locked, { e: 'SUSPEND', now: 0 }, policy).state).toEqual({
      kind: 'locked',
      reason: 'suspend',
      since: 1,
    });
    expect(lockTransition(locked, { e: 'LOCK_REQUESTED', now: 5 }, policy).state).toMatchObject({ reason: 'manual' });
  });

  it('desbloqueio continua possível com o relógio atrasado depois do bloqueio', () => {
    const locked: LockState = { kind: 'locked', reason: 'idle', since: 10 * MIN };
    expect(lockTransition(locked, { e: 'UNLOCKED', now: MIN, lockedSince: 10 * MIN }, policy).state.kind).toBe(
      'unlocked',
    );
  });

  it('bloqueio do Windows, suspensão e pedido manual bloqueiam na hora', () => {
    const unlocked: LockState = { kind: 'unlocked', since: 0, lastActivityAt: 0 };
    expect(lockTransition(unlocked, { e: 'OS_LOCKED', now: 1 }, policy).state).toMatchObject({ reason: 'os_locked' });
    expect(lockTransition(unlocked, { e: 'SUSPEND', now: 1 }, policy).state).toMatchObject({ reason: 'suspend' });
    expect(lockTransition(unlocked, { e: 'LOCK_REQUESTED', now: 1 }, policy).state).toMatchObject({ reason: 'manual' });
  });

  it('eventos fora de hora não mudam nada', () => {
    const locked: LockState = { kind: 'locked', reason: 'idle', since: 0 };
    for (const event of [
      { e: 'TICK', now: 99 },
      { e: 'ACTIVITY', now: 99 },
      { e: 'PASSWORD_SET', now: 99 },
      { e: 'CREDENTIAL_LOADED', now: 99, exists: false },
    ] as const) {
      const t = lockTransition(locked, event, policy);
      expect(t.state).toBe(locked);
      expect(t.effects).toEqual([]);
    }
  });

  it('o tempo sem uso fica entre 1 e 120 min', () => {
    expect(clampIdleMs(1)).toBe(MIN);
    expect(clampIdleMs(10 * 60 * MIN)).toBe(120 * MIN);
    expect(clampIdleMs(Number.NaN)).toBe(15 * MIN);
    const unlocked: LockState = { kind: 'unlocked', since: 0, lastActivityAt: 0 };
    expect(lockTransition(unlocked, { e: 'TICK', now: MIN }, { idleMs: 0 }).state.kind).toBe('locked');
  });
  it('piso do tempo sem uso: 1 min por padrão; só pode baixar até 1 s, quando a política pede', () => {
    expect(clampIdleMs(5_000)).toBe(60_000);
    expect(clampIdleMs(5_000, 2_000)).toBe(5_000);
    expect(clampIdleMs(500, 100)).toBe(1_000);
    expect(clampIdleMs(5_000, 10 * 60_000)).toBe(60_000);
    expect(clampIdleMs(5_000, Number.NaN)).toBe(60_000);
    const short = { idleMs: 4_000, minIdleMs: 4_000 };
    const opened = lockTransition(lockTransition(initialLockState, { e: 'CREDENTIAL_LOADED', now: 0, exists: false }, short).state, { e: 'PASSWORD_SET', now: 0 }, short).state;
    expect(lockTransition(opened, { e: 'TICK', now: 3_999 }, short).state.kind).toBe('unlocked');
    expect(lockTransition(opened, { e: 'TICK', now: 4_000 }, short).state.kind).toBe('locked');
    expect(lockTransition(opened, { e: 'TICK', now: 4_000 }, { idleMs: 4_000 }).state.kind).toBe('unlocked');
  });
});
