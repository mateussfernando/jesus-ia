import type { ActivityMessage, HostLockReason, LockMessage } from '../bridge/protocol';

/**
 * Sinais do principal para o servidor da interface (decisão 0019):
 * - **bloqueio** (sessão do Windows bloqueada, suspensão): vai com um número de sequência e espera a confirmação;
 *   sem ela no prazo, o servidor é derrubado e sobe de novo, bloqueado. Sem servidor pronto para receber, não há o que
 *   confirmar: o próximo já começa bloqueado;
 * - **uso de verdade** (tecla, clique, rolagem na janela): no máximo um aviso a cada `activityEveryMs`. O tempo sem
 *   uso é de minutos; avisar a cada tecla seria só ruído na ponte.
 */

export interface LockSignalsOptions {
  /** Manda ao servidor pronto; `false` se não há servidor pronto para receber. */
  readonly notify: (message: LockMessage | ActivityMessage) => boolean;
  /** Um bloqueio ficou sem confirmação no prazo. */
  readonly unconfirmed: (seq: number) => void;
  readonly ackTimeoutMs?: number;
  readonly activityEveryMs?: number;
  readonly now?: () => number;
}

export const DEFAULT_ACK_TIMEOUT_MS = 2_000;
export const DEFAULT_ACTIVITY_EVERY_MS = 5_000;

export class LockSignals {
  readonly #options: LockSignalsOptions;
  readonly #pending = new Map<number, NodeJS.Timeout>();
  #seq = 0;
  #lastActivity = Number.NEGATIVE_INFINITY;

  constructor(options: LockSignalsOptions) {
    this.#options = options;
  }

  lock(reason: HostLockReason): void {
    this.#seq += 1;
    const seq = this.#seq;
    if (!this.#options.notify({ type: 'lock', reason, seq })) return;
    const timer = setTimeout(() => {
      this.#pending.delete(seq);
      this.#options.unconfirmed(seq);
    }, this.#options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS);
    this.#pending.set(seq, timer);
  }

  /** O servidor confirmou o bloqueio `seq` (confirmação de número desconhecido não faz nada). */
  ack(seq: number): void {
    clearTimeout(this.#pending.get(seq));
    this.#pending.delete(seq);
  }

  activity(): void {
    const now = (this.#options.now ?? (() => performance.now()))();
    if (now - this.#lastActivity < (this.#options.activityEveryMs ?? DEFAULT_ACTIVITY_EVERY_MS)) return;
    this.#lastActivity = now;
    this.#options.notify({ type: 'activity' });
  }

  /** O servidor caiu: as confirmações pendentes não vêm mais, e o próximo começa bloqueado. */
  reset(): void {
    for (const timer of this.#pending.values()) clearTimeout(timer);
    this.#pending.clear();
  }

  get pending(): number {
    return this.#pending.size;
  }
}
