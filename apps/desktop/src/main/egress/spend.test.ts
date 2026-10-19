import { computeCost, getModelCard } from '@jesus/models';
import { describe, expect, it } from 'vitest';
import { createSpendScan, DailySpend, DEFAULT_DAILY_LIMIT_PUSD, MAX_DAILY_LIMIT_PUSD, MIN_DAILY_LIMIT_PUSD, worstCaseCostPUsd } from './spend';

const card = getModelCard('anthropic:claude-haiku-5-5');
if (card === null) throw new Error('cartão do Claude Haiku 5.5 sumiu do catálogo');
const HAIKU = card;
const TZ = 'America/Sao_Paulo';
// 19/10/2026, 12:00 em São Paulo (15:00 UTC).
const NOON = Date.UTC(2026, 9, 19, 15, 0, 0);
const USD = 1_000_000_000_000;

describe('worstCaseCostPUsd', () => {
  it('cobre o custo real de um pedido típico (cache, entrada e saída)', () => {
    const bodyBytes = 60_000;
    const worst = worstCaseCostPUsd(HAIKU, bodyBytes, 4_096);
    const real = computeCost(
      { inputTokens: 15_000, cacheReadTokens: 12_000, cacheWrite5mTokens: 2_500, cacheWrite1hTokens: 0, outputTokens: 4_096 },
      HAIKU,
    ).totalPUsd;
    expect(worst).toBeGreaterThan(real);
  });

  it('acima de 100 mil tokens, usa a faixa de preço de cima', () => {
    const below = worstCaseCostPUsd(HAIKU, 90_000, 0);
    const above = worstCaseCostPUsd(HAIKU, 110_000, 0);
    expect(above / 114_096).toBeGreaterThan((below / 94_096) * 4);
  });

  it('nunca passa da janela de contexto', () => {
    expect(worstCaseCostPUsd(HAIKU, 50_000_000, 0)).toBe(worstCaseCostPUsd(HAIKU, HAIKU.contextWindow, 0));
  });
});

describe('DailySpend', () => {
  it('reserva, recusa o que não cabe e liquida pelo custo real', () => {
    const spend = new DailySpend({ limitPUsd: USD, timeZone: TZ, now: () => NOON });
    expect(spend.reserve('a', 0.6 * USD)).toBe(true);
    expect(spend.reserve('b', 0.5 * USD)).toBe(false);
    spend.settle('a', 0.1 * USD);
    expect(spend.snapshot()).toEqual({ dayKey: '2026-10-19', settledPUsd: 0.1 * USD, reservedPUsd: 0, limitPUsd: USD });
    expect(spend.reserve('b', 0.5 * USD)).toBe(true);
  });

  it('liquidar com zero devolve a reserva inteira', () => {
    const spend = new DailySpend({ limitPUsd: USD, timeZone: TZ, now: () => NOON });
    spend.reserve('a', USD);
    spend.settle('a', 0);
    expect(spend.snapshot().settledPUsd).toBe(0);
    expect(spend.reserve('b', USD)).toBe(true);
  });

  it('o mesmo pedido não reserva duas vezes, e valor inválido não reserva', () => {
    const spend = new DailySpend({ limitPUsd: USD, timeZone: TZ, now: () => NOON });
    expect(spend.reserve('a', 10)).toBe(true);
    expect(spend.reserve('a', 10)).toBe(false);
    expect(spend.reserve('b', -1)).toBe(false);
    expect(spend.reserve('c', 0.5)).toBe(false);
  });

  it('começa do que o registro mostra do dia, e o dia novo zera', () => {
    let now = NOON;
    const spend = new DailySpend({
      limitPUsd: USD,
      timeZone: TZ,
      now: () => now,
      start: { dayKey: '2026-10-19', settledPUsd: 0.9 * USD },
    });
    expect(spend.reserve('a', 0.2 * USD)).toBe(false);
    now += 24 * 60 * 60 * 1000;
    expect(spend.reserve('a', 0.2 * USD)).toBe(true);
    expect(spend.snapshot().dayKey).toBe('2026-10-20');
  });

  it('o gasto de outro dia no registro não conta', () => {
    const spend = new DailySpend({ limitPUsd: USD, timeZone: TZ, now: () => NOON, start: { dayKey: '2026-10-18', settledPUsd: USD } });
    expect(spend.snapshot().settledPUsd).toBe(0);
  });

  it('o teto padrão é US$ 1', () => {
    expect(DEFAULT_DAILY_LIMIT_PUSD).toBe(USD);
  });

  it('o teto muda na hora, só dentro da faixa (US$ 0,01 a US$ 100)', () => {
    const spend = new DailySpend({ limitPUsd: USD, timeZone: TZ, now: () => NOON });
    expect(spend.reserve('a', 0.9 * USD)).toBe(true);
    spend.settle('a', 0.9 * USD);
    expect(spend.reserve('b', 0.2 * USD)).toBe(false);
    expect(spend.setLimit(2 * USD)).toBe(true);
    expect(spend.reserve('b', 0.2 * USD)).toBe(true);
    // Abaixo do gasto do dia: os pedidos seguintes são recusados.
    expect(spend.setLimit(0.5 * USD)).toBe(true);
    expect(spend.reserve('c', 1)).toBe(false);
    for (const invalid of [0, MIN_DAILY_LIMIT_PUSD - 1, MAX_DAILY_LIMIT_PUSD + 1, 1.5, Number.NaN]) expect(spend.setLimit(invalid)).toBe(false);
    expect(spend.snapshot().limitPUsd).toBe(0.5 * USD);
  });
});

describe('createSpendScan', () => {
  const at = (hours: number) => NOON + hours * 60 * 60 * 1000;

  it('soma as chamadas do dia e cobra a reserva inteira das que não terminaram', () => {
    const scan = createSpendScan('2026-10-19', TZ);
    scan.add({ ts: at(-1), event: { type: 'api.reserved', request: 'r1', reserved_pusd: 500 } });
    scan.add({ ts: at(-1), event: { type: 'api.call', request: 'r1', cost_pusd: 120 } });
    scan.add({ ts: at(0), event: { type: 'api.reserved', request: 'r2', reserved_pusd: 900 } });
    scan.add({ ts: at(0), event: { type: 'app.opened' } });
    expect(scan.result()).toEqual({ dayKey: '2026-10-19', settledPUsd: 120 + 900, limitPUsd: null });
  });

  it('ignora outros dias (no fuso local) e o que não é gasto', () => {
    const scan = createSpendScan('2026-10-19', TZ);
    // 02:00 UTC de 19/10 ainda é 18/10 em São Paulo.
    scan.add({ ts: Date.UTC(2026, 9, 19, 2, 0, 0), event: { type: 'api.call', request: 'r0', cost_pusd: 999 } });
    scan.add({ ts: at(30), event: { type: 'api.call', request: 'r9', cost_pusd: 999 } });
    scan.add({ ts: at(0), event: { type: 'api.call', request: 7, cost_pusd: 999 } });
    expect(scan.result().settledPUsd).toBe(0);
  });

  it('o teto vem do último spend.limit_set válido, de qualquer dia', () => {
    const scan = createSpendScan('2026-10-19', TZ);
    expect(scan.result().limitPUsd).toBeNull();
    scan.add({ ts: at(-48), event: { type: 'spend.limit_set', limit_pusd: 3 * USD, previous_pusd: USD } });
    scan.add({ ts: at(-1), event: { type: 'spend.limit_set', limit_pusd: 2 * USD, previous_pusd: 3 * USD } });
    // Fora da faixa ou estragado: ignorado.
    scan.add({ ts: at(0), event: { type: 'spend.limit_set', limit_pusd: 0 } });
    scan.add({ ts: at(0), event: { type: 'spend.limit_set', limit_pusd: '5' } });
    expect(scan.result().limitPUsd).toBe(2 * USD);
  });

  it('valor estragado no registro conta como o dia inteiro gasto (falha fechada)', () => {
    const scan = createSpendScan('2026-10-19', TZ);
    scan.add({ ts: at(0), event: { type: 'api.call', request: 'r1', cost_pusd: -5 } });
    expect(scan.result().settledPUsd).toBe(Number.MAX_SAFE_INTEGER);
  });
});
