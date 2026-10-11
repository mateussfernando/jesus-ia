import { describe, expect, it } from 'vitest';
import { accessTransition, checkAccess, idlePolicyFromEnv, initialAccessState, openSession } from './access';
import type { AccessState } from './access';
import { newSessionToken } from './session';

const MIN = 60_000;
const policy = { idleMs: 15 * MIN };

function loaded(exists: boolean): AccessState {
  return accessTransition(initialAccessState, { e: 'CREDENTIAL_LOADED', now: 0, exists }, policy).state;
}

describe('estado de acesso do servidor', () => {
  it('primeira vez: criar a senha abre a sessão', () => {
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(loaded(false), tokenHash, 10, policy).state;
    expect(opened.lock.kind).toBe('unlocked');
    expect(checkAccess(opened, token, 20, policy, { activity: false }).unlocked).toBe(true);
  });

  it('bloqueado no começo; só o cookie da sessão aberta vale', () => {
    const start = loaded(true);
    expect(checkAccess(start, undefined, 1, policy, { activity: false }).unlocked).toBe(false);
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(start, tokenHash, 10, policy).state;
    expect(checkAccess(opened, token, 11, policy, { activity: false }).unlocked).toBe(true);
    expect(checkAccess(opened, newSessionToken().token, 11, policy, { activity: false }).unlocked).toBe(false);
  });

  it('um desbloqueio novo invalida o cookie antigo', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    let state = openSession(loaded(true), a.tokenHash, 10, policy).state;
    state = openSession(state, b.tokenHash, 20, policy).state;
    expect(checkAccess(state, a.token, 21, policy, { activity: false }).unlocked).toBe(false);
    expect(checkAccess(state, b.token, 21, policy, { activity: false }).unlocked).toBe(true);
  });

  it('15 min sem uso bloqueia e apaga a sessão; o uso adia', () => {
    const { token, tokenHash } = newSessionToken();
    const opened = openSession(loaded(true), tokenHash, 0, policy).state;
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
    const opened = openSession(loaded(true), tokenHash, 0, policy).state;
    const locked = accessTransition(opened, { e: 'LOCK_REQUESTED', now: 1 }, policy).state;
    expect(locked.sessionHash).toBeNull();
    expect(checkAccess(locked, token, 2, policy, { activity: true }).unlocked).toBe(false);
  });

  it('lê o tempo sem uso do ambiente, dentro de 1 a 120 min', () => {
    expect(idlePolicyFromEnv(undefined).idleMs).toBe(15 * MIN);
    expect(idlePolicyFromEnv('5').idleMs).toBe(5 * MIN);
    expect(idlePolicyFromEnv('0').idleMs).toBe(MIN);
    expect(idlePolicyFromEnv('999').idleMs).toBe(120 * MIN);
    expect(idlePolicyFromEnv('abc').idleMs).toBe(15 * MIN);
  });
});
