import { clampIdleMs, defaultLockPolicy, initialLockState, lockTransition } from '@jesus/auth';
import type { LockEffect, LockEvent, LockPolicy, LockState } from '@jesus/auth';
import { sessionMatches } from './session';

/**
 * Estado de acesso do servidor da interface (decisão 0016): a máquina de bloqueio do `@jesus/auth` mais o hash
 * da sessão aberta no desbloqueio. Lógica pura: o relógio entra nos eventos. Saiu do estado desbloqueado,
 * a sessão é apagada, e o cookie antigo deixa de valer.
 */

export interface AccessState {
  readonly lock: LockState;
  readonly sessionHash: string | null;
}

export const initialAccessState: AccessState = { lock: initialLockState, sessionHash: null };

export interface AccessTransition {
  readonly state: AccessState;
  readonly effects: readonly LockEffect[];
}

export function accessTransition(state: AccessState, event: LockEvent, policy: LockPolicy): AccessTransition {
  const t = lockTransition(state.lock, event, policy);
  return {
    state: { lock: t.state, sessionHash: t.state.kind === 'unlocked' ? state.sessionHash : null },
    effects: t.effects,
  };
}

/**
 * Senha conferida (ou criada, ou recuperada): desbloqueia e troca a sessão. Uma sessão antiga, de outra
 * janela, deixa de valer.
 */
export function openSession(state: AccessState, tokenHash: string, now: number, policy: LockPolicy): AccessTransition {
  const event: LockEvent = state.lock.kind === 'setup_required' ? { e: 'PASSWORD_SET', now } : { e: 'UNLOCKED', now };
  const t = accessTransition(state, event, policy);
  if (t.state.lock.kind !== 'unlocked') return t;
  const touched = accessTransition({ ...t.state, sessionHash: tokenHash }, { e: 'ACTIVITY', now }, policy);
  return { state: touched.state, effects: [...t.effects, ...touched.effects] };
}

/** Confere o acesso de um pedido: aplica o tempo sem uso e compara o token do cookie com a sessão. */
export function checkAccess(
  state: AccessState,
  token: string | undefined,
  now: number,
  policy: LockPolicy,
  options: { activity: boolean },
): AccessTransition & { readonly unlocked: boolean } {
  let t = accessTransition(state, { e: 'TICK', now }, policy);
  const unlocked = t.state.lock.kind === 'unlocked' && sessionMatches(token, t.state.sessionHash);
  if (unlocked && options.activity) {
    const touched = accessTransition(t.state, { e: 'ACTIVITY', now }, policy);
    t = { state: touched.state, effects: [...t.effects, ...touched.effects] };
  }
  return { ...t, unlocked };
}

/** Tempo sem uso vindo da configuração (minutos, de 1 a 120); valor ausente ou inválido vale o padrão de 15. */
export function idlePolicyFromEnv(minutes: string | undefined): LockPolicy {
  if (minutes === undefined || minutes.trim() === '') return defaultLockPolicy;
  const value = Number(minutes);
  if (!Number.isFinite(value)) return defaultLockPolicy;
  return { idleMs: clampIdleMs(value * 60_000) };
}
