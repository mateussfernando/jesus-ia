import { createSpendLedger, effectiveDayKey, estimatePreflightCost, localDayKey, reserveSpend, rollDay, settleSpend } from '@jesus/models';
import type { ModelCard, SpendLedger } from '@jesus/models';

/**
 * Teto de gasto do dia no próprio processo principal (decisão 0023), com o livro de gastos do `packages/models`: antes
 * de cada pedido, reserva o pior caso; depois, liquida pelo uso real. Nada passa do teto, nem com o Cérebro
 * comprometido pedindo sem parar: o que não cabe na sobra do dia é recusado antes de sair.
 *
 * O dia é o local (fuso do sistema) e só avança. O gasto do dia é reconstruído do registro de auditoria ao abrir o app
 * (`createSpendScan`): reiniciar não zera o dia.
 */

/** Teto padrão: US$ 1 por dia, uma dezena de vezes o uso típico estimado do Claude Haiku 5.5 (decisão 0011). */
export const DEFAULT_DAILY_LIMIT_PUSD = 1_000_000_000_000;

/**
 * Folga para o que a API põe na entrada além do corpo (instruções das ferramentas, separadores de papel). O resto do
 * pior caso conta cada byte do corpo como um token: um token nunca tem menos de um byte do texto.
 */
const INPUT_OVERHEAD_TOKENS = 4_096;

/**
 * Pior caso de um pedido, em picodólares: a entrada inteira como gravação no cache (o preço de entrada mais caro), na
 * faixa de preço desse tamanho, mais a saída inteira (`max_tokens`). O custo real nunca passa disso.
 */
export function worstCaseCostPUsd(card: ModelCard, bodyBytes: number, maxTokens: number): number {
  const inputTokens = Math.min(bodyBytes + INPUT_OVERHEAD_TOKENS, card.contextWindow);
  try {
    return estimatePreflightCost({ inputTokens, expectedCacheHit: 0, expectedOutput: maxTokens, price: card.price, cache: 'explicit' });
  } catch {
    // Preço inválido no catálogo: o pior caso não se calcula, e nada cabe no teto (falha fechada).
    return Number.MAX_SAFE_INTEGER;
  }
}

export interface SpendSnapshot {
  readonly dayKey: string;
  readonly settledPUsd: number;
  readonly reservedPUsd: number;
  readonly limitPUsd: number;
}

export interface DailySpendOptions {
  readonly limitPUsd: number;
  /** Fuso IANA do dia local (no app, o do sistema). */
  readonly timeZone: string;
  readonly now?: () => number;
  /** O que o registro de auditoria mostra do dia (`createSpendScan`). */
  readonly start?: { readonly dayKey: string; readonly settledPUsd: number };
}

function saturatingAdd(a: number, b: number): number {
  return Math.min(a + b, Number.MAX_SAFE_INTEGER);
}

export class DailySpend {
  #ledger: SpendLedger;
  readonly #limitPUsd: number;
  readonly #timeZone: string;
  readonly #now: () => number;

  constructor(options: DailySpendOptions) {
    this.#limitPUsd = options.limitPUsd;
    this.#timeZone = options.timeZone;
    this.#now = options.now ?? Date.now;
    const today = localDayKey(this.#now(), this.#timeZone);
    const start = options.start;
    this.#ledger =
      start !== undefined && start.dayKey === today && Number.isSafeInteger(start.settledPUsd) && start.settledPUsd >= 0
        ? { ...createSpendLedger(today), settledPUsd: start.settledPUsd }
        : createSpendLedger(today);
  }

  #roll(): void {
    this.#ledger = rollDay(this.#ledger, effectiveDayKey(this.#now(), this.#timeZone, this.#ledger.dayKey));
  }

  /** Reserva o pior caso de um pedido. `false`: não cabe no que sobra do dia (ou o valor é inválido). */
  reserve(requestId: string, estimatePUsd: number): boolean {
    this.#roll();
    const limit = this.#limitPUsd;
    const result = reserveSpend(
      this.#ledger,
      { requestId, taskId: null, routineId: null, kind: 'regular', estimatePUsd },
      { dailyPUsd: limit, securityReservePUsd: 0, taskPUsd: limit, routinePUsd: limit },
    );
    if (!result.ok) return false;
    this.#ledger = result.ledger;
    return true;
  }

  /** Liquida pelo custo real (zero devolve a reserva inteira: o pedido não saiu ou a API não cobra erro). */
  settle(requestId: string, actualPUsd: number): void {
    this.#roll();
    this.#ledger = settleSpend(this.#ledger, { requestId, actualPUsd, taskId: null, routineId: null });
  }

  snapshot(): SpendSnapshot {
    this.#roll();
    let reserved = 0;
    for (const reservation of Object.values(this.#ledger.reservations)) reserved = saturatingAdd(reserved, reservation.pUsd);
    return { dayKey: this.#ledger.dayKey, settledPUsd: this.#ledger.settledPUsd, reservedPUsd: reserved, limitPUsd: this.#limitPUsd };
  }
}

/** Evento do registro de auditoria, como o leitor do registro entrega. */
export interface ScannedEntry {
  readonly ts: number;
  readonly event: { readonly type: string; readonly [field: string]: unknown };
}

export interface SpendScan {
  add(entry: ScannedEntry): void;
  result(): { readonly dayKey: string; readonly settledPUsd: number };
}

function pUsdField(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Gasto do dia a partir do registro de auditoria: soma o custo de cada `api.call` do dia e, para cada `api.reserved`
 * sem `api.call` depois (o app caiu no meio do pedido), o valor reservado inteiro (falha fechada).
 */
export function createSpendScan(dayKey: string, timeZone: string): SpendScan {
  let settled = 0;
  const open = new Map<string, number>();
  return {
    add(entry) {
      const { type } = entry.event;
      if (type !== 'api.reserved' && type !== 'api.call') return;
      let day: string;
      try {
        day = localDayKey(entry.ts, timeZone);
      } catch {
        return;
      }
      if (day !== dayKey) return;
      const request = entry.event['request'];
      if (typeof request !== 'string') return;
      if (type === 'api.reserved') {
        open.set(request, pUsdField(entry.event['reserved_pusd']) ?? Number.MAX_SAFE_INTEGER);
        return;
      }
      open.delete(request);
      settled = saturatingAdd(settled, pUsdField(entry.event['cost_pusd']) ?? Number.MAX_SAFE_INTEGER);
    },
    result() {
      let total = settled;
      for (const reserved of open.values()) total = saturatingAdd(total, reserved);
      return { dayKey, settledPUsd: total };
    },
  };
}
