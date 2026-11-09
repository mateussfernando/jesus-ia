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

/** Como a sessão está sendo aberta. */
export type SessionOpening =
  /** Senha criada na primeira vez: só vale com o estado ainda em `setup_required`. */
  | { readonly via: 'setup' }
  /**
   * Senha (ou código de recuperação) conferida. `lockedSince` é o `since` do estado bloqueado quando a
   * conferência começou (`null` se não estava bloqueado): um bloqueio que chegou no meio vence (`@jesus/auth`).
   */
  | { readonly via: 'unlock'; readonly lockedSince: number | null };

/** O estado bloqueado que uma conferência de senha começando agora precisa citar ao terminar. */
export function lockedSinceOf(state: AccessState): number | null {
  return state.lock.kind === 'locked' ? state.lock.since : null;
}

/**
 * Abre a sessão: a máquina de estados decide, e a sessão só existe se ela chegar a `unlocked`. Criar a senha com
 * o app bloqueado, ou um desbloqueio atrasado por um bloqueio no meio, não abre nada. Um desbloqueio novo troca a
 * sessão: a antiga, de outra janela, deixa de valer.
 */
export function openSession(
  state: AccessState,
  tokenHash: string,
  now: number,
  policy: LockPolicy,
  opening: SessionOpening,
): AccessTransition {
  const none: AccessTransition = { state, effects: [] };
  let t: AccessTransition;
  if (opening.via === 'setup') {
    if (state.lock.kind !== 'setup_required') return none;
    t = accessTransition(state, { e: 'PASSWORD_SET', now }, policy);
  } else if (state.lock.kind === 'locked') {
    if (opening.lockedSince === null) return none;
    t = accessTransition(state, { e: 'UNLOCKED', now, lockedSince: opening.lockedSince }, policy);
  } else if (state.lock.kind === 'unlocked') {
    t = none;
  } else {
    return none;
  }
  if (t.state.lock.kind !== 'unlocked') return t;
  const touched = accessTransition({ ...t.state, sessionHash: tokenHash }, { e: 'ACTIVITY', now }, policy);
  return { state: touched.state, effects: [...t.effects, ...touched.effects] };
}

/** Bloqueio que vem do Windows pelo app de desktop (decisão 0019): sessão bloqueada ou suspensão. */
export function hostLock(state: AccessState, reason: 'os_locked' | 'suspend', now: number, policy: LockPolicy): AccessTransition {
  return accessTransition(state, { e: reason === 'suspend' ? 'SUSPEND' : 'OS_LOCKED', now }, policy);
}

/**
 * Uso de verdade visto pelo processo principal (tecla, clique ou rolagem na janela; decisão 0019). Antes, aplica o
 * tempo sem uso: um aviso que chega depois do prazo não reabre nada.
 */
export function hostActivity(state: AccessState, now: number, policy: LockPolicy): AccessTransition {
  const ticked = accessTransition(state, { e: 'TICK', now }, policy);
  if (ticked.state.lock.kind !== 'unlocked') return ticked;
  const touched = accessTransition(ticked.state, { e: 'ACTIVITY', now }, policy);
  return { state: touched.state, effects: [...ticked.effects, ...touched.effects] };
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

/**
 * Relógio do estado de acesso, em ms desde que foi criado. Anda o maior entre o relógio monotônico e o de
 * parede, e nunca para trás: o relógio de parede que volta (correção de hora, dual boot) não adia o bloqueio,
 * e a suspensão do PC (que o monotônico pode não contar) continua contando. Erra para o lado de bloquear.
 */
export function createAccessClock(
  wall: () => number = () => Date.now(),
  mono: () => number = () => performance.now(),
): () => number {
  let lastWall = wall();
  let lastMono = mono();
  let elapsed = 0;
  return () => {
    const w = wall();
    const m = mono();
    const step = Math.max(0, w - lastWall, m - lastMono);
    if (Number.isFinite(step)) elapsed += step;
    lastWall = w;
    lastMono = m;
    return Math.floor(elapsed);
  };
}

/** Tempo sem uso vindo da configuração (minutos, de 1 a 120); valor ausente ou inválido vale o padrão de 15. */
export function idlePolicyFromEnv(minutes: string | undefined): LockPolicy {
  if (minutes === undefined || minutes.trim() === '') return defaultLockPolicy;
  const value = Number(minutes);
  if (!Number.isFinite(value)) return defaultLockPolicy;
  return { idleMs: clampIdleMs(value * 60_000) };
}
