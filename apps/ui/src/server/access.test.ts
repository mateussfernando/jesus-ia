import { describe, expect, it } from 'vitest';
import {
  accessTransition,
  checkAccess,
  createAccessClock,
  hostActivity,
  hostLock,
  idlePolicyFromEnv,
  initialAccessState,
  lockedSinceOf,
  openSession,
} from './access';
import type { AccessState } from './access';
import { newSessionToken } from './session';

const MIN = 60_000;
const policy = { idleMs: 15 * MIN };

function loaded(exists: boolean): AccessState {
  return accessTransition(initialAccessState, { e: 'CREDENTIAL_LOADED', now: 0, exists }, policy).state;
}

const SETUP = { via: 'setup' } as const;
/** Desbloqueio de uma conferência que começou com o estado como está agora. */
const unlockFrom = (state: AccessState) => ({ via: 'unlock', lockedSince: lockedSinceOf(state) }) as const;

describe('estado de acesso do servidor', () => {
  it('primeira vez: criar a senha abre a sessão', () => {
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(loaded(false), tokenHash, 10, policy, SETUP).state;
    expect(opened.lock.kind).toBe('unlocked');
    expect(checkAccess(opened, token, 20, policy, { activity: false }).unlocked).toBe(true);
  });

  it('bloqueado no começo; só o cookie da sessão aberta vale', () => {
    const start = loaded(true);
    expect(checkAccess(start, undefined, 1, policy, { activity: false }).unlocked).toBe(false);
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(start, tokenHash, 10, policy, unlockFrom(start)).state;
    expect(checkAccess(opened, token, 11, policy, { activity: false }).unlocked).toBe(true);
    expect(checkAccess(opened, newSessionToken().token, 11, policy, { activity: false }).unlocked).toBe(false);
  });

  it('um desbloqueio novo invalida o cookie antigo', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    let state = openSession(loaded(true), a.tokenHash, 10, policy, unlockFrom(loaded(true))).state;
    state = openSession(state, b.tokenHash, 20, policy, unlockFrom(state)).state;
    expect(checkAccess(state, a.token, 21, policy, { activity: false }).unlocked).toBe(false);
    expect(checkAccess(state, b.token, 21, policy, { activity: false }).unlocked).toBe(true);
  });

  it('15 min sem uso bloqueia e apaga a sessão; o uso adia', () => {
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(loaded(true), tokenHash, 0, policy, unlockFrom(loaded(true))).state;
    const used = checkAccess(opened, token, 14 * MIN, policy, { activity: true });
    expect(used.unlocked).toBe(true);
    expect(checkAccess(used.state, token, 28 * MIN, policy, { activity: false }).unlocked).toBe(true);
    const idle = checkAccess(used.state, token, 29 * MIN, policy, { activity: false });
    expect(idle.unlocked).toBe(false);
    expect(idle.state).toMatchObject({ lock: { kind: 'locked', reason: 'idle' }, sessionHash: null });
    expect(idle.effects).toContainEqual({ fx: 'cancel_connection_flows' });
  });

  it('bloquear agora apaga a sessão', () => {
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(loaded(true), tokenHash, 0, policy, unlockFrom(loaded(true))).state;
    const locked = accessTransition(opened, { e: 'LOCK_REQUESTED', now: 1 }, policy).state;
    expect(locked.sessionHash).toBeNull();
    expect(checkAccess(locked, token, 2, policy, { activity: true }).unlocked).toBe(false);
  });

  it('criar a senha com o app bloqueado não abre sessão', () => {
    const { tokenHash } = newSessionToken();
    const locked = loaded(true);
    const t = openSession(locked, tokenHash, 10, policy, SETUP);
    expect(t.state).toBe(locked);
    expect(t.state.sessionHash).toBeNull();
  });

  it('bloqueio no meio da conferência da senha vence: a sessão não abre', () => {
    const { tokenHash } = newSessionToken();
    const start = loaded(true);
    const opening = unlockFrom(start);
    // Enquanto o bcrypt confere, o botão "Bloquear" de outra janela (ou o Windows) bloqueia de novo.
    const relocked = accessTransition(start, { e: 'LOCK_REQUESTED', now: 5 }, policy).state;
    const t = openSession(relocked, tokenHash, 10, policy, opening);
    expect(t.state.lock.kind).toBe('locked');
    expect(t.state.sessionHash).toBeNull();
    // Sem estado bloqueado no começo (ex.: já estava aberto e bloqueou no meio), também não abre.
    expect(openSession(start, tokenHash, 10, policy, { via: 'unlock', lockedSince: null }).state.lock.kind).toBe('locked');
  });

  it('bloqueio do Windows (sessão ou suspensão) apaga a sessão e vence uma conferência no meio', () => {
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(loaded(true), tokenHash, 0, policy, unlockFrom(loaded(true))).state;
    const osLocked = hostLock(opened, 'os_locked', 1, policy).state;
    expect(osLocked).toMatchObject({ lock: { kind: 'locked', reason: 'os_locked' }, sessionHash: null });
    expect(checkAccess(osLocked, token, 2, policy, { activity: false }).unlocked).toBe(false);
    expect(hostLock(opened, 'suspend', 1, policy).state.lock).toMatchObject({ reason: 'suspend' });
    // Conferência começou bloqueada; o Windows bloqueou de novo no meio: a sessão não abre.
    const start = loaded(true);
    const opening = unlockFrom(start);
    const relocked = hostLock(start, 'os_locked', 5, policy).state;
    expect(openSession(relocked, tokenHash, 10, policy, opening).state.lock.kind).toBe('locked');
  });

  it('uso visto pelo processo principal adia o bloqueio, mas não reabre depois do prazo', () => {
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(loaded(true), tokenHash, 0, policy, unlockFrom(loaded(true))).state;
    const used = hostActivity(opened, 14 * MIN, policy).state;
    expect(checkAccess(used, token, 28 * MIN, policy, { activity: false }).unlocked).toBe(true);
    const late = hostActivity(used, 30 * MIN, policy).state;
    expect(late.lock).toMatchObject({ kind: 'locked', reason: 'idle' });
    expect(hostActivity(loaded(true), 1, policy).state.lock.kind).toBe('locked');
  });

  it('o relógio do acesso nunca volta e anda o maior dos dois relógios', () => {
    let wall = 1_000_000;
    let mono = 50;
    const clock = createAccessClock(
      () => wall,
      () => mono,
    );
    expect(clock()).toBe(0);
    wall += 1000;
    mono += 1000;
    expect(clock()).toBe(1000);
    // A hora do Windows volta 3 h: o relógio do acesso segue o monotônico.
    wall -= 3 * 60 * MIN;
    mono += 500;
    expect(clock()).toBe(1500);
    // Suspensão: o monotônico parou, o de parede andou 2 h; conta as 2 h (erra para o lado de bloquear).
    wall += 120 * MIN;
    expect(clock()).toBe(1500 + 120 * MIN);
  });

  it('lê o tempo sem uso do ambiente, dentro de 1 a 120 min', () => {
    expect(idlePolicyFromEnv(undefined).idleMs).toBe(15 * MIN);
    expect(idlePolicyFromEnv('5').idleMs).toBe(5 * MIN);
    expect(idlePolicyFromEnv('0').idleMs).toBe(MIN);
    expect(idlePolicyFromEnv('999').idleMs).toBe(120 * MIN);
    expect(idlePolicyFromEnv('abc').idleMs).toBe(15 * MIN);
  });
});
