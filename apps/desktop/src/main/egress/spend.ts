import { createSpendLedger, effectiveDayKey, estimatePreflightCost, localDayKey, reserveSpend, rollDay, settleSpend } from '@jesus/models';
import type { ModelCard, SpendLedger } from '@jesus/models';
import { MAX_OUTPUT_TOKENS } from './api-policy';

/**
 * Teto de gasto do dia no próprio processo principal (decisão 0023), com o livro de gastos do `packages/models`: antes
 * de cada pedido, reserva o pior caso; depois, liquida pelo uso real. Nada passa do teto, nem com o Cérebro
 * comprometido pedindo sem parar: o que não cabe na sobra do dia é recusado antes de sair.
 *
 * O dia é o local (fuso do sistema) e só avança. O gasto do dia é reconstruído do registro de auditoria ao abrir o app
 * (`createSpendScan`): reiniciar não zera o dia. Quando o registro vai para o lado (cadeia quebrada, âncora ilegível),
 * o registro novo começa com o gasto e o teto que a conferência leu do antigo (`spend.carried`): pôr o registro de lado
 * também não zera o dia.
 */

/** Teto padrão: US$ 1 por dia, uma dezena de vezes o uso típico estimado do Claude Haiku 5.5 (decisão 0011). */
export const DEFAULT_DAILY_LIMIT_PUSD = 1_000_000_000_000;
/** Faixa do teto que o dono pode escolher nas Configurações: de US$ 0,01 a US$ 100 por dia. */
export const MIN_DAILY_LIMIT_PUSD = 10_000_000_000;
export const MAX_DAILY_LIMIT_PUSD = 100_000_000_000_000;

/** O teto está na faixa aceita (inteiro, em picodólares). */
export function isValidDailyLimit(limitPUsd: unknown): limitPUsd is number {
  return (
    typeof limitPUsd === 'number' &&
    Number.isSafeInteger(limitPUsd) &&
    limitPUsd >= MIN_DAILY_LIMIT_PUSD &&
    limitPUsd <= MAX_DAILY_LIMIT_PUSD
  );
}

/**
 * Folga para o que a API põe na entrada além do corpo (instruções das ferramentas, separadores de papel). O resto do
 * pior caso conta cada byte do corpo como um token: um token nunca tem menos de um byte do texto.
 */
const INPUT_OVERHEAD_TOKENS = 4_096;

/**
 * Entrada de um bloco de raciocínio devolvido, no pior caso: o raciocínio vem cifrado na assinatura (talvez comprimido)
 * e é cobrado pelo tamanho original, que nunca passa da saída máxima da resposta que o gerou. Toda resposta passou por
 * esta saída, com `max_tokens` até `MAX_OUTPUT_TOKENS`; bloco de outra conta ou de modelo que não o lê cai sem cobrança.
 */
export const REPLAYED_THINKING_TOKENS = MAX_OUTPUT_TOKENS;

/**
 * Pior caso de um pedido, em picodólares: a entrada inteira como gravação no cache (o preço de entrada mais caro), na
 * faixa de preço desse tamanho, mais a saída inteira (`max_tokens`). Cada bloco de raciocínio devolvido conta a mais
 * pela saída máxima. O custo real nunca passa disso.
 */
export function worstCaseCostPUsd(card: ModelCard, bodyBytes: number, maxTokens: number, thinkingBlocks = 0): number {
  const inputTokens = Math.min(bodyBytes + INPUT_OVERHEAD_TOKENS + thinkingBlocks * REPLAYED_THINKING_TOKENS, card.contextWindow);
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
  #limitPUsd: number;
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

  /**
   * Troca o teto (pedido do dono nas Configurações, já gravado no registro). Vale na hora: abaixo do gasto do dia, os
   * pedidos seguintes são recusados até o dia virar. Fora da faixa, nada muda.
   */
  setLimit(limitPUsd: number): boolean {
    if (!isValidDailyLimit(limitPUsd)) return false;
    this.#limitPUsd = limitPUsd;
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

export interface SpendScanResult {
  readonly dayKey: string;
  readonly settledPUsd: number;
  readonly limitPUsd: number | null;
}

export interface SpendScan {
  add(entry: ScannedEntry): void;
  result(): SpendScanResult;
}

/**
 * Evento que leva o gasto e o teto do dia para o registro novo, quando o antigo vai para o lado: sem ele, a abertura
 * seguinte só leria o registro novo e esqueceria o dia.
 */
export function carriedSpendEvent(scanned: SpendScanResult): { readonly type: 'spend.carried'; readonly [field: string]: unknown } {
  return {
    type: 'spend.carried',
    day_key: scanned.dayKey,
    spent_pusd: scanned.settledPUsd,
    ...(scanned.limitPUsd === null ? {} : { limit_pusd: scanned.limitPUsd }),
  };
}

function pUsdField(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Gasto do dia a partir do registro de auditoria: soma o custo de cada `api.call` do dia e, para cada `api.reserved`
 * sem `api.call` depois (o app caiu no meio do pedido), o valor reservado inteiro (falha fechada). Um `spend.carried`
 * do dia (o registro anterior foi posto de lado) soma o gasto que ele traz. O teto vem do último `spend.limit_set` ou
 * `spend.carried` válido do registro inteiro (de qualquer dia); sem nenhum, vale o padrão.
 */
export function createSpendScan(dayKey: string, timeZone: string): SpendScan {
  let settled = 0;
  let limit: number | null = null;
  const open = new Map<string, number>();
  return {
    add(entry) {
      const { type } = entry.event;
      if (type === 'spend.limit_set' || type === 'spend.carried') {
        const value = entry.event['limit_pusd'];
        if (isValidDailyLimit(value)) limit = value;
        // O dia do gasto trazido é o que o evento diz (o do registro posto de lado), não a hora da gravação.
        if (type === 'spend.carried' && entry.event['day_key'] === dayKey) {
          settled = saturatingAdd(settled, pUsdField(entry.event['spent_pusd']) ?? Number.MAX_SAFE_INTEGER);
        }
        return;
      }
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
      return { dayKey, settledPUsd: total, limitPUsd: limit };
    },
  };
}
