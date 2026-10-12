/**
 * Estado de bloqueio do Jesus (decisão 0015), como máquina de estados pura: `lockTransition(estado, evento)`
 * devolve o próximo estado e os efeitos. Quem executa os efeitos (mostrar a tela de senha, cancelar cartões e
 * fluxos de conexão, agendar a próxima checagem) é o processo principal do Electron.
 */

export type LockReason = 'startup' | 'idle' | 'os_locked' | 'suspend' | 'manual';

export type LockState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'setup_required' }
  | { readonly kind: 'locked'; readonly reason: LockReason; readonly since: number }
  | { readonly kind: 'unlocked'; readonly since: number; readonly lastActivityAt: number };

export type LockEvent =
  | { readonly e: 'CREDENTIAL_LOADED'; readonly now: number; readonly exists: boolean }
  /** Senha criada na primeira vez: já entra desbloqueado. */
  | { readonly e: 'PASSWORD_SET'; readonly now: number }
  /**
   * O serviço conferiu a senha (ou o código de recuperação). `lockedSince` é o `since` do estado bloqueado que
   * quem chamou viu quando a conferência começou: se outro bloqueio (do Windows, da suspensão ou pedido) chegou
   * no meio, o `since` mudou e o resultado atrasado não abre o app. É uma marca de identidade, não uma
   * comparação de horários, então o relógio que volta não atrapalha.
   */
  | { readonly e: 'UNLOCKED'; readonly now: number; readonly lockedSince: number }
  /** Teclado, mouse ou voz do usuário com a janela em foco. */
  | { readonly e: 'ACTIVITY'; readonly now: number }
  | { readonly e: 'TICK'; readonly now: number }
  | { readonly e: 'OS_LOCKED'; readonly now: number }
  | { readonly e: 'SUSPEND'; readonly now: number }
  | { readonly e: 'LOCK_REQUESTED'; readonly now: number };

export type LockEffect =
  | { readonly fx: 'show_setup' }
  | { readonly fx: 'show_lock_screen'; readonly reason: LockReason }
  | { readonly fx: 'show_app' }
  /** Cartões de confirmação pendentes são cancelados: ninguém responde por você com o app bloqueado. */
  | { readonly fx: 'cancel_pending_confirmations' }
  /** Fluxos de conexão de contas são cancelados e o código do device flow sai da tela. */
  | { readonly fx: 'cancel_connection_flows' }
  | { readonly fx: 'schedule_tick'; readonly at: number };

export interface LockPolicy {
  /** Tempo sem uso até bloquear. Ajustável de 1 a 120 min (decisão 0015). */
  readonly idleMs: number;
}

export const MIN_IDLE_MS = 60_000;
export const MAX_IDLE_MS = 120 * 60_000;
export const defaultLockPolicy: LockPolicy = { idleMs: 15 * 60_000 };

/** Prende o tempo sem uso na faixa permitida; valor inválido vira o padrão. */
export function clampIdleMs(idleMs: number): number {
  if (!Number.isFinite(idleMs)) return defaultLockPolicy.idleMs;
  return Math.min(MAX_IDLE_MS, Math.max(MIN_IDLE_MS, Math.round(idleMs)));
}

export const initialLockState: LockState = { kind: 'loading' };

type Transition = { readonly state: LockState; readonly effects: readonly LockEffect[] };

function lock(reason: LockReason, now: number): Transition {
  return {
    state: { kind: 'locked', reason, since: now },
    effects: [
      { fx: 'cancel_pending_confirmations' },
      { fx: 'cancel_connection_flows' },
      { fx: 'show_lock_screen', reason },
    ],
  };
}

function unlocked(now: number, policy: LockPolicy): Transition {
  return {
    state: { kind: 'unlocked', since: now, lastActivityAt: now },
    effects: [{ fx: 'show_app' }, { fx: 'schedule_tick', at: now + clampIdleMs(policy.idleMs) }],
  };
}

const unchanged = (state: LockState): Transition => ({ state, effects: [] });

export function lockTransition(state: LockState, event: LockEvent, policy: LockPolicy = defaultLockPolicy): Transition {
  const idleMs = clampIdleMs(policy.idleMs);
  switch (event.e) {
    case 'CREDENTIAL_LOADED':
      if (state.kind !== 'loading') return unchanged(state);
      return event.exists
        ? { state: { kind: 'locked', reason: 'startup', since: event.now }, effects: [{ fx: 'show_lock_screen', reason: 'startup' }] }
        : { state: { kind: 'setup_required' }, effects: [{ fx: 'show_setup' }] };

    case 'PASSWORD_SET':
      // Só vale na primeira configuração; trocar a senha com o app aberto não muda o estado.
      return state.kind === 'setup_required' ? unlocked(event.now, policy) : unchanged(state);

    case 'UNLOCKED':
      if (state.kind !== 'locked') return unchanged(state);
      // Houve outro bloqueio depois que a conferência começou: o resultado é de antes dele e não abre o app.
      if (event.lockedSince !== state.since) return unchanged(state);
      return unlocked(event.now, policy);

    case 'ACTIVITY':
      if (state.kind !== 'unlocked' || event.now === state.lastActivityAt) return unchanged(state);
      // Também quando o relógio voltou: a atividade é de agora, e o prazo nunca fica além de agora + idleMs.
      return { state: { ...state, lastActivityAt: event.now }, effects: [] };

    case 'TICK': {
      if (state.kind !== 'unlocked') return unchanged(state);
      // Relógio que voltou para antes da última atividade: o prazo passa a contar de agora. Sem isso, o Jesus
      // ficaria aberto sem uso pelo tamanho do salto mais o tempo de inatividade.
      const current = event.now < state.lastActivityAt ? { ...state, lastActivityAt: event.now } : state;
      const deadline = current.lastActivityAt + idleMs;
      if (event.now >= deadline) return lock('idle', event.now);
      return { state: current, effects: [{ fx: 'schedule_tick', at: deadline }] };
    }

    case 'OS_LOCKED':
    case 'SUSPEND':
    case 'LOCK_REQUESTED': {
      const reason: LockReason = event.e === 'OS_LOCKED' ? 'os_locked' : event.e === 'SUSPEND' ? 'suspend' : 'manual';
      if (state.kind === 'unlocked') return lock(reason, event.now);
      // Já bloqueado: um `since` novo invalida a senha que estava sendo conferida (veja `UNLOCKED`). Se o
      // relógio der o mesmo instante, soma 1 ms: o `since` precisa mudar.
      if (state.kind === 'locked') {
        const since = event.now === state.since ? event.now + 1 : event.now;
        return { state: { kind: 'locked', reason, since }, effects: [] };
      }
      return unchanged(state);
    }
  }
}

/**
 * Pedidos novos (voz ou texto) só com o app desbloqueado. "Jesus, pare" e o botão de emergência não passam por
 * aqui: funcionam sempre, porque parar é seguro (seção 3.11).
 */
export function acceptsRequests(state: LockState): boolean {
  return state.kind === 'unlocked';
}
