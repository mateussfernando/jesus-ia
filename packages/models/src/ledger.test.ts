import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { computeCost, usdPerMTokToPUsdPerToken } from './cost';
import {
  createSpendLedger,
  DEFAULT_TASK_LIMIT_PUSD,
  effectiveDayKey,
  estimatePreflightCost,
  localDayKey,
  maxOutputForBudget,
  recoverOrphanedReservations,
  reserveSpend,
  rollDay,
  securityReservePUsd,
  settleSpend,
  toHologramSpend,
} from './ledger';
import type { ReserveSpendRequest, SpendLedger, SpendLimits, UsageRecordMeta } from './ledger';
import { getModelCard } from './registry';
import type { ModelCard, ModelPrice } from './types';

/** US$ → pUSD sem ponto flutuante nos exemplos (centavos de milésimo bastam aqui). */
const usd = (dollars: number): number => Math.round(dollars * 1e4) * 1e8;

function card(key: string): ModelCard {
  const found = getModelCard(key);
  if (found === null) throw new Error(`sem cartão: ${key}`);
  return found;
}

/** DeepSeek V4 Flash da tabela curada (seção 3.4): entrada 0,14; cache 0,0028; saída 0,28; cache automático. */
const FLASH_PRICE: ModelPrice = {
  currency: 'USD',
  inputPerMTok: 0.14,
  cacheReadPerMTok: 0.0028,
  outputPerMTok: 0.28,
  confidence: 'secondary',
};

/** Mesmo formato do `spend` do hologramSnapshotSchema (packages/hologram/src/model.ts), sem importar o holograma. */
const hologramSpendSchema = z
  .object({
    todayUsd: z.number().nonnegative().finite(),
    limitUsd: z.number().positive().finite(),
  })
  .strict();

const LIMITS_5: SpendLimits = {
  dailyPUsd: usd(5),
  securityReservePUsd: securityReservePUsd(usd(5)),
  taskPUsd: DEFAULT_TASK_LIMIT_PUSD,
  routinePUsd: usd(1),
};

const request = (requestId: string, estimatePUsd: number, extra: Partial<ReserveSpendRequest> = {}): ReserveSpendRequest => ({
  requestId,
  taskId: null,
  routineId: null,
  kind: 'regular',
  estimatePUsd,
  ...extra,
});

function reserveOk(ledger: SpendLedger, r: ReserveSpendRequest, limits: SpendLimits = LIMITS_5): SpendLedger {
  const result = reserveSpend(ledger, r, limits);
  if (!result.ok) throw new Error(`reserva recusada: ${result.reason}`);
  return result.ledger;
}

function totalReserved(ledger: SpendLedger): number {
  return Object.values(ledger.reservations).reduce((sum, r) => sum + r.pUsd, 0);
}

/** Gerador pseudoaleatório determinístico (LCG de Numerical Recipes), para as propriedades sem fast-check. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('conversão de preço (US$/M → pUSD por token)', () => {
  it('o cache do Flash, 0,0028 US$/M, dá 2.800 pUSD por token', () => {
    expect(usdPerMTokToPUsdPerToken(0.0028)).toBe(2_800);
    expect(usdPerMTokToPUsdPerToken(1)).toBe(1_000_000);
    expect(usdPerMTokToPUsdPerToken(0)).toBe(0);
    expect(usdPerMTokToPUsdPerToken(0.125)).toBe(125_000);
  });

  it('lança para preço negativo, NaN ou resultado fora dos inteiros seguros', () => {
    expect(() => usdPerMTokToPUsdPerToken(-0.1)).toThrow(RangeError);
    expect(() => usdPerMTokToPUsdPerToken(-1e-9)).toThrow(RangeError);
    expect(() => usdPerMTokToPUsdPerToken(Number.NaN)).toThrow(RangeError);
    expect(() => usdPerMTokToPUsdPerToken(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => usdPerMTokToPUsdPerToken(1e10)).toThrow(RangeError);
  });

  it('computeCost continua igual usando a conversão exportada', () => {
    const haiku = card('anthropic:claude-haiku-5-5');
    const flash: ModelCard = { ...haiku, price: FLASH_PRICE, capabilities: { ...haiku.capabilities, cache: 'automatic' } };
    const cost = computeCost(
      { inputTokens: 1_000_000, cacheReadTokens: 900_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 10_000 },
      flash,
    );
    expect(cost.totalPUsd).toBe(19_320_000_000);
  });
});

describe('estimatePreflightCost', () => {
  it('Flash: 1 milhão de entrada com 90% em cache e 10 mil de saída → 19.320.000.000 pUSD (igual ao computeCost)', () => {
    expect(
      estimatePreflightCost({ inputTokens: 1_000_000, expectedCacheHit: 0.9, expectedOutput: 10_000, price: FLASH_PRICE, cache: 'automatic' }),
    ).toBe(19_320_000_000);
  });

  it("cache 'explicit': a parte sem cache é cobrada como escrita de 5 min (pessimista)", () => {
    const haiku = card('anthropic:claude-haiku-5-5').price;
    // 9.000 lidos × 10.000 + 1.000 gravados × 125.000 + 1.500 de saída × 500.000
    expect(estimatePreflightCost({ inputTokens: 10_000, expectedCacheHit: 0.9, expectedOutput: 1_500, price: haiku, cache: 'explicit' })).toBe(
      965_000_000,
    );
    // Sem cache explícito, a parte sem cache paga o preço de entrada: 1.000 × 100.000 em vez de 1.000 × 125.000.
    expect(estimatePreflightCost({ inputTokens: 10_000, expectedCacheHit: 0.9, expectedOutput: 1_500, price: haiku, cache: 'automatic' })).toBe(
      940_000_000,
    );
  });

  it('a faixa de preço vem da entrada inteira', () => {
    const haiku = card('anthropic:claude-haiku-5-5').price;
    // Acima de 100 mil: entrada 0,50 e saída 2,50; sem cache, com 'automatic' → 150.000 × 500.000 + 1.000 × 2.500.000.
    expect(estimatePreflightCost({ inputTokens: 150_000, expectedCacheHit: 0, expectedOutput: 1_000, price: haiku, cache: 'automatic' })).toBe(
      77_500_000_000,
    );
  });

  it('a taxa de cache é limitada a [0, 1] e NaN conta como sem cache', () => {
    const base = { inputTokens: 1_000_000, expectedOutput: 0, price: FLASH_PRICE, cache: 'automatic' as const };
    const none = estimatePreflightCost({ ...base, expectedCacheHit: 0 });
    const all = estimatePreflightCost({ ...base, expectedCacheHit: 1 });
    expect(none).toBe(140_000_000_000);
    expect(all).toBe(2_800_000_000);
    expect(estimatePreflightCost({ ...base, expectedCacheHit: -0.5 })).toBe(none);
    expect(estimatePreflightCost({ ...base, expectedCacheHit: Number.NaN })).toBe(none);
    expect(estimatePreflightCost({ ...base, expectedCacheHit: 1.7 })).toBe(all);
  });

  it('a parte em cache arredonda para baixo, sem erro de ponto flutuante (0,57 × 100 = 57)', () => {
    const price: ModelPrice = { currency: 'USD', inputPerMTok: 1, cacheReadPerMTok: 0, outputPerMTok: 0, confidence: 'verified' };
    // 57 em cache (grátis) e 43 sem cache × 1.000.000.
    expect(estimatePreflightCost({ inputTokens: 100, expectedCacheHit: 0.57, expectedOutput: 0, price, cache: 'automatic' })).toBe(43_000_000);
    // 0,999 de 10 tokens = 9,99 → 9 em cache, 1 sem cache.
    expect(estimatePreflightCost({ inputTokens: 10, expectedCacheHit: 0.999, expectedOutput: 0, price, cache: 'automatic' })).toBe(1_000_000);
  });

  it('contagem fracionária arredonda para cima; negativa, NaN ou infinita fica impagável (falha fechada)', () => {
    const base = { expectedCacheHit: 0, price: FLASH_PRICE, cache: 'automatic' as const };
    expect(estimatePreflightCost({ ...base, inputTokens: 0.5, expectedOutput: 0 })).toBe(140_000);
    expect(estimatePreflightCost({ ...base, inputTokens: -1, expectedOutput: 0 })).toBe(Number.MAX_SAFE_INTEGER);
    expect(estimatePreflightCost({ ...base, inputTokens: 1, expectedOutput: Number.NaN })).toBe(Number.MAX_SAFE_INTEGER);
    expect(estimatePreflightCost({ ...base, inputTokens: Number.POSITIVE_INFINITY, expectedOutput: 0 })).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('modelo local (preço 0) custa 0', () => {
    const local: ModelPrice = { currency: 'USD', inputPerMTok: 0, outputPerMTok: 0, confidence: 'free_local' };
    expect(estimatePreflightCost({ inputTokens: 30_000, expectedCacheHit: 0.5, expectedOutput: 800, price: local, cache: 'none' })).toBe(0);
  });
});

describe('maxOutputForBudget', () => {
  const base = { remainingPUsd: 1e10, inputCostPUsd: 7e9, outputPUsdPerToken: 280_000, outputReserve: 32_768, minUseful: 1_024 };

  it('exemplos do apêndice B: 10.714 e, com saldo de 7,1e9, 0 (abaixo do mínimo útil)', () => {
    expect(maxOutputForBudget(base)).toBe(10_714);
    expect(maxOutputForBudget({ ...base, remainingPUsd: 7.1e9 })).toBe(0);
  });

  it('nunca passa da reserva de saída R', () => {
    expect(maxOutputForBudget({ ...base, remainingPUsd: 1e13 })).toBe(32_768);
  });

  it('saldo que não cobre a entrada → 0', () => {
    expect(maxOutputForBudget({ ...base, remainingPUsd: 6e9 })).toBe(0);
    expect(maxOutputForBudget({ ...base, remainingPUsd: 7e9, minUseful: 0 })).toBe(0);
  });

  it('saída de graça → outputReserve (se cobrir a entrada e passar do mínimo útil)', () => {
    expect(maxOutputForBudget({ ...base, outputPUsdPerToken: 0 })).toBe(32_768);
    expect(maxOutputForBudget({ ...base, outputPUsdPerToken: 0, remainingPUsd: 0, inputCostPUsd: 0 })).toBe(32_768);
    expect(maxOutputForBudget({ ...base, outputPUsdPerToken: 0, outputReserve: 512 })).toBe(0);
    expect(maxOutputForBudget({ ...base, outputPUsdPerToken: 0, remainingPUsd: 1, inputCostPUsd: 2 })).toBe(0);
  });

  it('números inválidos → 0 (falha fechada)', () => {
    expect(maxOutputForBudget({ ...base, remainingPUsd: Number.NaN })).toBe(0);
    expect(maxOutputForBudget({ ...base, outputPUsdPerToken: -1 })).toBe(0);
    expect(maxOutputForBudget({ ...base, outputPUsdPerToken: Number.NaN })).toBe(0);
    expect(maxOutputForBudget({ ...base, minUseful: Number.NaN })).toBe(0);
    expect(maxOutputForBudget({ ...base, outputReserve: Number.NaN })).toBe(0);
    // Custo de entrada negativo não pode virar saldo: antes, saldo 1e9 com entrada −5e9 liberava 21.428 tokens (~6e9 pUSD).
    expect(maxOutputForBudget({ ...base, remainingPUsd: 1e9, inputCostPUsd: -5e9 })).toBe(0);
    expect(maxOutputForBudget({ ...base, inputCostPUsd: Number.NEGATIVE_INFINITY })).toBe(0);
    expect(maxOutputForBudget({ ...base, inputCostPUsd: Number.NaN })).toBe(0);
  });

  it('com o resultado, saída × preço + entrada nunca passa do saldo', () => {
    const next = lcg(7);
    for (let n = 0; n < 2_000; n++) {
      const remainingPUsd = Math.floor(next() * 1e11);
      const inputCostPUsd = Math.floor(next() * 1e11);
      const outputPUsdPerToken = 1 + Math.floor(next() * 3_000_000);
      const out = maxOutputForBudget({ remainingPUsd, inputCostPUsd, outputPUsdPerToken, outputReserve: 32_768, minUseful: 1_024 });
      expect(out === 0 || out >= 1_024).toBe(true);
      expect(out).toBeLessThanOrEqual(32_768);
      if (out > 0) expect(inputCostPUsd + out * outputPUsdPerToken).toBeLessThanOrEqual(remainingPUsd);
    }
  });
});

describe('securityReservePUsd', () => {
  it('max(US$ 0,05; 5% do limite diário), sem passar do limite', () => {
    expect(securityReservePUsd(usd(5))).toBe(250_000_000_000); // US$ 0,25
    expect(securityReservePUsd(usd(0.5))).toBe(50_000_000_000); // 5% seria US$ 0,025 → piso de US$ 0,05
    expect(securityReservePUsd(usd(1))).toBe(50_000_000_000); // exatamente 5%
    expect(securityReservePUsd(usd(0.03))).toBe(usd(0.03)); // limite menor que o piso
    expect(securityReservePUsd(0)).toBe(0);
    expect(securityReservePUsd(usd(100))).toBe(usd(5));
  });

  it('limite inválido → 0 (e o reserveSpend recusa tudo)', () => {
    expect(securityReservePUsd(-1)).toBe(0);
    expect(securityReservePUsd(1.5)).toBe(0);
    expect(securityReservePUsd(Number.NaN)).toBe(0);
    const result = reserveSpend(createSpendLedger('2026-10-08'), request('r1', 0), { ...LIMITS_5, dailyPUsd: Number.NaN });
    expect(result).toEqual({ ok: false, reason: 'daily_limit' });
  });
});

describe('reserveSpend', () => {
  const settled460: SpendLedger = { ...createSpendLedger('2026-10-08'), settledPUsd: usd(4.6) };

  it('limite de US$ 5, liquidado US$ 4,60 e estimativa US$ 0,20: comum recusa (4,80 > 4,75), segurança passa', () => {
    expect(LIMITS_5.securityReservePUsd).toBe(usd(0.25));
    expect(reserveSpend(settled460, request('r1', usd(0.2)), LIMITS_5)).toEqual({ ok: false, reason: 'daily_limit' });
    const security = reserveSpend(settled460, request('r1', usd(0.2), { kind: 'security' }), LIMITS_5);
    expect(security.ok).toBe(true);
    if (security.ok) {
      expect(security.ledger.reservations['r1']).toEqual({ taskId: null, routineId: null, kind: 'security', pUsd: usd(0.2) });
      expect(security.ledger.settledPUsd).toBe(usd(4.6));
    }
    // Segurança vai até o limite do dia, e não além.
    expect(reserveSpend(settled460, request('r1', usd(0.4), { kind: 'security' }), LIMITS_5).ok).toBe(true);
    expect(reserveSpend(settled460, request('r1', usd(0.4) + 1, { kind: 'security' }), LIMITS_5)).toEqual({
      ok: false,
      reason: 'daily_limit',
    });
  });

  it('chamada comum vai exatamente até limite − reserva de segurança', () => {
    expect(reserveSpend(settled460, request('r1', usd(0.15)), LIMITS_5).ok).toBe(true);
    expect(reserveSpend(settled460, request('r1', usd(0.15) + 1), LIMITS_5)).toEqual({ ok: false, reason: 'daily_limit' });
  });

  it('as reservas em andamento contam no total do dia', () => {
    const one = reserveOk(createSpendLedger('2026-10-08'), request('r1', usd(4)));
    expect(reserveSpend(one, request('r2', usd(0.75)), LIMITS_5).ok).toBe(true);
    expect(reserveSpend(one, request('r2', usd(0.76)), LIMITS_5)).toEqual({ ok: false, reason: 'daily_limit' });
  });

  it('passando do limite da tarefa (US$ 1) → task_limit, contando liquidado e reservas da tarefa', () => {
    let ledger: SpendLedger = { ...createSpendLedger('2026-10-08'), byTaskPUsd: { t1: usd(0.6) } };
    ledger = reserveOk(ledger, request('r1', usd(0.3), { taskId: 't1' }));
    expect(reserveSpend(ledger, request('r2', usd(0.1), { taskId: 't1' }), LIMITS_5).ok).toBe(true);
    expect(reserveSpend(ledger, request('r2', usd(0.11), { taskId: 't1' }), LIMITS_5)).toEqual({ ok: false, reason: 'task_limit' });
    // Outra tarefa não é afetada; chamada de segurança também respeita o limite da tarefa.
    expect(reserveSpend(ledger, request('r2', usd(0.5), { taskId: 't2' }), LIMITS_5).ok).toBe(true);
    expect(reserveSpend(ledger, request('r2', usd(0.11), { taskId: 't1', kind: 'security' }), LIMITS_5)).toEqual({
      ok: false,
      reason: 'task_limit',
    });
  });

  it('passando da fatia da rotina → routine_limit', () => {
    let ledger: SpendLedger = { ...createSpendLedger('2026-10-08'), byRoutinePUsd: { morning: usd(0.5) } };
    ledger = reserveOk(ledger, request('r1', usd(0.4), { routineId: 'morning' }));
    expect(reserveSpend(ledger, request('r2', usd(0.1), { routineId: 'morning' }), LIMITS_5).ok).toBe(true);
    expect(reserveSpend(ledger, request('r2', usd(0.1) + 1, { routineId: 'morning' }), LIMITS_5)).toEqual({
      ok: false,
      reason: 'routine_limit',
    });
  });

  it('requestId repetido (reservado ou já liquidado hoje) → duplicate_request', () => {
    const reserved = reserveOk(createSpendLedger('2026-10-08'), request('r1', usd(0.1)));
    expect(reserveSpend(reserved, request('r1', usd(0.1)), LIMITS_5)).toEqual({ ok: false, reason: 'duplicate_request' });
    const settled = settleSpend(reserved, { requestId: 'r1', actualPUsd: usd(0.05), taskId: null, routineId: null });
    expect(reserveSpend(settled, request('r1', usd(0.1)), LIMITS_5)).toEqual({ ok: false, reason: 'duplicate_request' });
  });

  it('estimativa negativa, fracionária, NaN ou fora dos inteiros seguros → invalid_estimate', () => {
    const empty = createSpendLedger('2026-10-08');
    for (const estimate of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(reserveSpend(empty, request('r1', estimate), LIMITS_5)).toEqual({ ok: false, reason: 'invalid_estimate' });
    }
    expect(reserveSpend(empty, request('r1', 0), LIMITS_5).ok).toBe(true);
  });

  it('limite de tarefa ou de rotina inválido recusa (falha fechada)', () => {
    const empty = createSpendLedger('2026-10-08');
    expect(reserveSpend(empty, request('r1', 1, { taskId: 't1' }), { ...LIMITS_5, taskPUsd: Number.NaN })).toEqual({
      ok: false,
      reason: 'task_limit',
    });
    expect(reserveSpend(empty, request('r1', 1, { routineId: 'x' }), { ...LIMITS_5, routinePUsd: -1 })).toEqual({
      ok: false,
      reason: 'routine_limit',
    });
  });

  it('é puro: o livro original não muda', () => {
    const empty = createSpendLedger('2026-10-08');
    const snapshot = structuredClone(empty);
    reserveOk(empty, request('r1', usd(0.1)));
    expect(empty).toEqual(snapshot);
  });

  it("ids como '__proto__' e 'constructor' não leem nada do protótipo", () => {
    const empty = createSpendLedger('2026-10-08');
    expect(reserveSpend(empty, request('constructor', 1), LIMITS_5).ok).toBe(true);
    expect(reserveSpend(empty, request('toString', 1, { taskId: 'constructor', routineId: '__proto__' }), LIMITS_5).ok).toBe(true);
    let ledger = reserveOk(empty, request('__proto__', usd(0.1), { taskId: '__proto__' }));
    expect(Object.keys(ledger.reservations)).toEqual(['__proto__']);
    expect(totalReserved(ledger)).toBe(usd(0.1));
    ledger = settleSpend(ledger, { requestId: '__proto__', actualPUsd: usd(0.05), taskId: null, routineId: null });
    expect(Object.keys(ledger.reservations)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(ledger.byTaskPUsd, '__proto__')?.value).toBe(usd(0.05));
  });
});

describe('settleSpend', () => {
  it('remove a reserva e soma o custo real ao dia, à tarefa e à rotina', () => {
    let ledger = reserveOk(createSpendLedger('2026-10-08'), request('r1', usd(0.2), { taskId: 't1', routineId: 'morning' }));
    ledger = settleSpend(ledger, { requestId: 'r1', actualPUsd: usd(0.05), taskId: 't1', routineId: 'morning' });
    expect(ledger.reservations).toEqual({});
    expect(ledger.settledPUsd).toBe(usd(0.05));
    expect(ledger.byTaskPUsd).toEqual({ t1: usd(0.05) });
    expect(ledger.byRoutinePUsd).toEqual({ morning: usd(0.05) });
    expect(ledger.settledRequestIds).toEqual(['r1']);
  });

  it('é idempotente: a segunda liquidação com o mesmo requestId não muda nada', () => {
    const reserved = reserveOk(createSpendLedger('2026-10-08'), request('r1', usd(0.2)));
    const once = settleSpend(reserved, { requestId: 'r1', actualPUsd: usd(0.1), taskId: null, routineId: null });
    const twice = settleSpend(once, { requestId: 'r1', actualPUsd: usd(0.3), taskId: 't9', routineId: null });
    expect(twice).toBe(once);
    expect(twice.settledPUsd).toBe(usd(0.1));
  });

  it('liquidação sem reserva também soma (com os ids informados)', () => {
    const ledger = settleSpend(createSpendLedger('2026-10-08'), { requestId: 'late', actualPUsd: 1_234, taskId: 't1', routineId: null });
    expect(ledger.settledPUsd).toBe(1_234);
    expect(ledger.byTaskPUsd).toEqual({ t1: 1_234 });
    expect(ledger.byRoutinePUsd).toEqual({});
  });

  it('com reserva, valem a tarefa e a rotina gravadas nela', () => {
    const reserved = reserveOk(createSpendLedger('2026-10-08'), request('r1', usd(0.2), { taskId: 't1' }));
    const ledger = settleSpend(reserved, { requestId: 'r1', actualPUsd: 10, taskId: 'outra', routineId: 'outra' });
    expect(ledger.byTaskPUsd).toEqual({ t1: 10 });
    expect(ledger.byRoutinePUsd).toEqual({});
  });

  it('custo real válido abaixo da reserva é cobrado como veio; zero também', () => {
    const reserved = reserveOk(createSpendLedger('2026-10-08'), request('r1', usd(0.2)));
    expect(settleSpend(reserved, { requestId: 'r1', actualPUsd: 0, taskId: null, routineId: null }).settledPUsd).toBe(0);
  });

  it('nunca de graça: custo real inválido cobra pelo menos o valor reservado', () => {
    const reserved = reserveOk(createSpendLedger('2026-10-08'), request('r1', 1_000));
    const settle = (actualPUsd: number): number => settleSpend(reserved, { requestId: 'r1', actualPUsd, taskId: null, routineId: null }).settledPUsd;
    expect(settle(-5)).toBe(1_000);
    expect(settle(Number.NaN)).toBe(1_000);
    expect(settle(10.2)).toBe(1_000);
    expect(settle(1_500.2)).toBe(1_501);
    expect(settle(Number.POSITIVE_INFINITY)).toBe(Number.MAX_SAFE_INTEGER);
    expect(settle(1e300)).toBe(Number.MAX_SAFE_INTEGER);
    // Sem reserva e sem base (NaN, negativo): não há o que cobrar.
    const bare = createSpendLedger('2026-10-08');
    expect(settleSpend(bare, { requestId: 'x', actualPUsd: Number.NaN, taskId: null, routineId: null }).settledPUsd).toBe(0);
    expect(settleSpend(bare, { requestId: 'x', actualPUsd: 2.5, taskId: null, routineId: null }).settledPUsd).toBe(3);
  });

  it('as somas saturam nos inteiros seguros e o dia fica bloqueado', () => {
    const huge = settleSpend(createSpendLedger('2026-10-08'), { requestId: 'a', actualPUsd: Number.MAX_SAFE_INTEGER, taskId: 't', routineId: null });
    const more = settleSpend(huge, { requestId: 'b', actualPUsd: usd(1), taskId: 't', routineId: null });
    expect(more.settledPUsd).toBe(Number.MAX_SAFE_INTEGER);
    expect(more.byTaskPUsd).toEqual({ t: Number.MAX_SAFE_INTEGER });
    expect(reserveSpend(more, request('c', 0, { kind: 'security' }), LIMITS_5)).toEqual({ ok: false, reason: 'daily_limit' });
  });
});

describe('propriedades do livro (varredura determinística)', () => {
  const LIMITS: SpendLimits = {
    dailyPUsd: usd(1),
    securityReservePUsd: securityReservePUsd(usd(1)),
    taskPUsd: usd(0.3),
    routinePUsd: usd(0.2),
  };
  const TASKS = [null, 't1', 't2', 't3'] as const;
  const ROUTINES = [null, 'morning', 'night'] as const;

  function pick<T>(items: readonly T[], next: () => number): T {
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) throw new Error('lista vazia');
    return item;
  }

  function checkInvariants(ledger: SpendLedger): void {
    const reserved = totalReserved(ledger);
    expect(Number.isSafeInteger(ledger.settledPUsd)).toBe(true);
    expect(ledger.settledPUsd + reserved).toBeLessThanOrEqual(LIMITS.dailyPUsd);
    for (const task of TASKS) {
      if (task === null) continue;
      const inFlight = Object.values(ledger.reservations)
        .filter((r) => r.taskId === task)
        .reduce((sum, r) => sum + r.pUsd, 0);
      expect((ledger.byTaskPUsd[task] ?? 0) + inFlight).toBeLessThanOrEqual(LIMITS.taskPUsd);
    }
    for (const routine of ROUTINES) {
      if (routine === null) continue;
      const inFlight = Object.values(ledger.reservations)
        .filter((r) => r.routineId === routine)
        .reduce((sum, r) => sum + r.pUsd, 0);
      expect((ledger.byRoutinePUsd[routine] ?? 0) + inFlight).toBeLessThanOrEqual(LIMITS.routinePUsd);
    }
  }

  it('liquidado + reservado ≤ limite; comum nunca ocupa a reserva de segurança; liquidar duas vezes conta uma', () => {
    let acceptedRegular = 0;
    let acceptedSecurity = 0;
    const rejected = new Map<string, number>();
    for (let seed = 1; seed <= 150; seed++) {
      const next = lcg(seed);
      let ledger = createSpendLedger('2026-10-08');
      let counter = 0;
      const settledIds: string[] = [];
      for (let step = 0; step < 150; step++) {
        const roll = next();
        const open = Object.keys(ledger.reservations);
        if (roll < 0.55 || open.length === 0) {
          const kind = next() < 0.3 ? 'security' : 'regular';
          const r = request(`s${seed}-${counter++}`, Math.floor(next() * usd(0.12)), {
            kind,
            taskId: pick(TASKS, next),
            routineId: pick(ROUTINES, next),
          });
          const result = reserveSpend(ledger, r, LIMITS);
          if (result.ok) {
            ledger = result.ledger;
            if (kind === 'regular') {
              acceptedRegular++;
              expect(ledger.settledPUsd + totalReserved(ledger)).toBeLessThanOrEqual(LIMITS.dailyPUsd - LIMITS.securityReservePUsd);
            } else {
              acceptedSecurity++;
            }
          } else {
            rejected.set(result.reason, (rejected.get(result.reason) ?? 0) + 1);
          }
        } else if (roll < 0.9) {
          // Liquida uma reserva em andamento; a resposta nunca custa mais que o reservado (maxOutputForBudget).
          const id = pick(open, next);
          const reservation = ledger.reservations[id];
          if (reservation === undefined) throw new Error('reserva sumiu');
          const actualPUsd = Math.floor(next() * (reservation.pUsd + 1));
          const before = ledger.settledPUsd;
          ledger = settleSpend(ledger, { requestId: id, actualPUsd, taskId: reservation.taskId, routineId: reservation.routineId });
          expect(ledger.settledPUsd).toBe(before + actualPUsd);
          settledIds.push(id);
        } else if (settledIds.length > 0) {
          // Liquidação repetida: devolve o mesmo livro.
          const id = pick(settledIds, next);
          const again = settleSpend(ledger, { requestId: id, actualPUsd: usd(0.5), taskId: 't1', routineId: 'morning' });
          expect(again).toBe(ledger);
        }
        checkInvariants(ledger);
      }
    }
    // A varredura exercita as duas espécies de chamada e os três limites.
    expect(acceptedRegular).toBeGreaterThan(1_000);
    expect(acceptedSecurity).toBeGreaterThan(300);
    expect([...rejected.keys()].sort()).toEqual(['daily_limit', 'routine_limit', 'task_limit']);
    expect(Math.min(...rejected.values())).toBeGreaterThan(50);
  });

  it('liquidação sem reserva prévia soma exatamente o custo', () => {
    const next = lcg(42);
    let ledger = createSpendLedger('2026-10-08');
    let expected = 0;
    for (let n = 0; n < 500; n++) {
      const actualPUsd = Math.floor(next() * usd(0.01));
      ledger = settleSpend(ledger, { requestId: `u${n}`, actualPUsd, taskId: 't1', routineId: null });
      expected += actualPUsd;
      expect(ledger.settledPUsd).toBe(expected);
      expect(ledger.byTaskPUsd['t1']).toBe(expected);
    }
  });
});

describe('recoverOrphanedReservations', () => {
  const HOUR = 3_600_000;
  const now = Date.UTC(2026, 9, 8, 12, 0);

  it('reserva de 2 h sem liquidação, com timeout de 15 min → orphaned, cobrada pelo valor reservado', () => {
    const records: UsageRecordMeta[] = [{ requestId: 'r1', status: 'reserved', reservedAtMs: now - 2 * HOUR, reservedPUsd: 4_200_000 }];
    expect(recoverOrphanedReservations(records, now, 15 * 60_000)).toEqual([{ requestId: 'r1', status: 'orphaned', chargedPUsd: 4_200_000 }]);
  });

  it('ignora reservas recentes, liquidadas, já órfãs e repetidas', () => {
    const records: UsageRecordMeta[] = [
      { requestId: 'recent', status: 'reserved', reservedAtMs: now - 60_000, reservedPUsd: 1 },
      { requestId: 'edge', status: 'reserved', reservedAtMs: now - 15 * 60_000, reservedPUsd: 1 },
      { requestId: 'done', status: 'reserved', reservedAtMs: now - HOUR, reservedPUsd: 1 },
      { requestId: 'done', status: 'settled', reservedAtMs: now - HOUR, reservedPUsd: 1 },
      { requestId: 'old', status: 'orphaned', reservedAtMs: now - 5 * HOUR, reservedPUsd: 1 },
      { requestId: 'twice', status: 'reserved', reservedAtMs: now - HOUR, reservedPUsd: 7 },
      { requestId: 'twice', status: 'reserved', reservedAtMs: now - HOUR, reservedPUsd: 7 },
    ];
    expect(recoverOrphanedReservations(records, now, 15 * 60_000)).toEqual([{ requestId: 'twice', status: 'orphaned', chargedPUsd: 7 }]);
  });

  it('instante inválido conta como antigo; valor fracionário sobe (nunca de graça)', () => {
    const records: UsageRecordMeta[] = [
      { requestId: 'nan', status: 'reserved', reservedAtMs: Number.NaN, reservedPUsd: 10.5 },
      { requestId: 'neg', status: 'reserved', reservedAtMs: now - HOUR, reservedPUsd: -3 },
    ];
    expect(recoverOrphanedReservations(records, now, 15 * 60_000)).toEqual([
      { requestId: 'nan', status: 'orphaned', chargedPUsd: 11 },
      { requestId: 'neg', status: 'orphaned', chargedPUsd: 0 },
    ]);
  });

  it('reserva com instante no futuro (o relógio voltou) também vira orphaned e é cobrada', () => {
    const records: UsageRecordMeta[] = [
      { requestId: 'future', status: 'reserved', reservedAtMs: now + HOUR, reservedPUsd: 5 },
      { requestId: 'recent', status: 'reserved', reservedAtMs: now - 60_000, reservedPUsd: 9 },
    ];
    expect(recoverOrphanedReservations(records, now, 15 * 60_000)).toEqual([{ requestId: 'future', status: 'orphaned', chargedPUsd: 5 }]);
  });
});

describe('dia local', () => {
  it("02:30 UTC de 09/10/2026 em 'America/Sao_Paulo' é '2026-10-08'", () => {
    expect(localDayKey(Date.UTC(2026, 9, 9, 2, 30), 'America/Sao_Paulo')).toBe('2026-10-08');
    expect(localDayKey(Date.UTC(2026, 9, 9, 2, 30), 'UTC')).toBe('2026-10-09');
    expect(localDayKey(Date.UTC(2026, 0, 1, 0, 0), 'Asia/Tokyo')).toBe('2026-01-01');
    expect(localDayKey(Date.UTC(2026, 0, 1, 0, 0), 'America/Los_Angeles')).toBe('2025-12-31');
  });

  it('effectiveDayKey: o dia não volta', () => {
    const instant = Date.UTC(2026, 9, 9, 2, 30);
    expect(effectiveDayKey(instant, 'America/Sao_Paulo', '2026-10-09')).toBe('2026-10-09');
    expect(effectiveDayKey(instant, 'America/Sao_Paulo', '2026-10-07')).toBe('2026-10-08');
    expect(effectiveDayKey(instant, 'America/Sao_Paulo', null)).toBe('2026-10-08');
    expect(effectiveDayKey(instant, 'America/Sao_Paulo', 'lixo')).toBe('2026-10-08');
  });

  it('instante inválido ou fuso desconhecido lança RangeError', () => {
    expect(() => localDayKey(Number.NaN, 'UTC')).toThrow(RangeError);
    expect(() => localDayKey(0, 'Marte/Olympus_Mons')).toThrow(RangeError);
  });
});

describe('rollDay', () => {
  function busyLedger(): SpendLedger {
    let ledger = reserveOk(createSpendLedger('2026-10-08'), request('r1', usd(0.1), { taskId: 't1', routineId: 'morning' }));
    ledger = reserveOk(ledger, request('r2', usd(0.2), { taskId: 't1', routineId: 'morning' }));
    return settleSpend(ledger, { requestId: 'r1', actualPUsd: usd(0.05), taskId: 't1', routineId: 'morning' });
  }

  it('no mesmo dia (ou num dia anterior, ou com chave fora do formato) devolve o mesmo objeto', () => {
    const ledger = busyLedger();
    expect(rollDay(ledger, '2026-10-08')).toBe(ledger);
    expect(rollDay(ledger, '2026-10-07')).toBe(ledger);
    expect(rollDay(ledger, 'zzzz')).toBe(ledger);
  });

  it('num dia novo zera o liquidado, os ids do dia e as rotinas; mantém reservas e tarefas', () => {
    const ledger = busyLedger();
    const next = rollDay(ledger, '2026-10-09');
    expect(next).toEqual({
      dayKey: '2026-10-09',
      settledPUsd: 0,
      reservations: { r2: { taskId: 't1', routineId: 'morning', kind: 'regular', pUsd: usd(0.2) } },
      settledRequestIds: [],
      byTaskPUsd: { t1: usd(0.05) },
      byRoutinePUsd: {},
    });
    // A reserva de ontem liquida no dia novo.
    const settled = settleSpend(next, { requestId: 'r2', actualPUsd: usd(0.15), taskId: 't1', routineId: 'morning' });
    expect(settled.settledPUsd).toBe(usd(0.15));
    expect(settled.byTaskPUsd).toEqual({ t1: usd(0.2) });
    expect(settled.byRoutinePUsd).toEqual({ morning: usd(0.15) });
  });
});

describe('toHologramSpend', () => {
  it('soma as reservas ao liquidado e arredonda a 4 casas', () => {
    let ledger: SpendLedger = { ...createSpendLedger('2026-10-08'), settledPUsd: 1_234_560_000_000 };
    ledger = reserveOk(ledger, request('r1', 19_320_000_000));
    const spend = toHologramSpend(ledger, 5);
    expect(spend).toEqual({ todayUsd: 1.2539, limitUsd: 5 });
    expect(hologramSpendSchema.safeParse(spend).success).toBe(true);
    expect(toHologramSpend({ ...createSpendLedger('2026-10-08'), settledPUsd: 50_000_000 }, 5).todayUsd).toBe(0.0001);
    expect(toHologramSpend({ ...createSpendLedger('2026-10-08'), settledPUsd: 49_999_999 }, 5).todayUsd).toBe(0);
  });

  it('nunca negativo, sempre finito, e limite inválido vira o mínimo positivo', () => {
    const corrupt: SpendLedger = { ...createSpendLedger('2026-10-08'), settledPUsd: -usd(1) };
    expect(toHologramSpend(corrupt, 5).todayUsd).toBe(0);
    expect(toHologramSpend({ ...corrupt, settledPUsd: Number.NaN }, 5).todayUsd).toBe(0);
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const spend = toHologramSpend(createSpendLedger('2026-10-08'), limit);
      expect(spend.limitUsd).toBe(0.0001);
      expect(hologramSpendSchema.safeParse(spend).success).toBe(true);
    }
    const saturated = toHologramSpend({ ...createSpendLedger('2026-10-08'), settledPUsd: Number.MAX_SAFE_INTEGER }, 5);
    expect(hologramSpendSchema.safeParse(saturated).success).toBe(true);
  });
});
