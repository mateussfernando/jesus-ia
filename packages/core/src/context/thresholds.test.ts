import { describe, expect, it } from 'vitest';
import {
  bpToTokens,
  clampUserThresholds,
  deriveThresholds,
  fitStepResults,
  FULL_BP,
  MIN_RESULT_CAP,
  postCompactionSplit,
  subagentReturnCap,
  usageBp,
} from './thresholds';
import type { Thresholds } from './thresholds';

describe('limiares em pontos-base (seção 5.1)', () => {
  it('L = 252.144 (janela de 1 milhão, parte fixa de 10 mil): 85% / 60% / 75%', () => {
    const t = deriveThresholds({ limit: 252_144, inputMax: 879_301, fixedTokens: 10_000 });
    expect(t).toMatchObject({
      compactBp: 8_500,
      microBp: 6_000,
      warnBp: 7_500,
      postMicroBp: 4_500,
      postCompactBp: 3_000,
      hardBp: 34_476,
      toolResultCap: 12_607,
      stepResultCap: 25_214,
      stepGrowth: 2_000,
      clearAtLeast: 20_172,
    });
  });

  it('L = 91.469 (janela de 128 mil): a compactação desce para deixar folga até o limite técnico', () => {
    const t = deriveThresholds({ limit: 91_469, inputMax: 101_469, fixedTokens: 10_000 });
    expect(t).toMatchObject({ compactBp: 7_562, microBp: 5_062, warnBp: 6_562, postMicroBp: 3_562, toolResultCap: 4_573, stepResultCap: 9_146 });
  });

  it('L = 18.000 colado no limite técnico: piso de 60% e tetos por resultado reduzidos', () => {
    const t = deriveThresholds({ limit: 18_000, inputMax: 28_000, fixedTokens: 10_000 });
    expect(t).toMatchObject({ compactBp: 6_000, microBp: 4_000, warnBp: 5_000, hardBp: 10_000, toolResultCap: 1_800, stepResultCap: 1_800 });
  });

  it('propriedades: inteiros, compactar fica 2.000 acima de limpar e há folga de dois passos (L ≥ 5.000)', () => {
    let checked = 0;
    // Varredura determinística: L de 1.024 a 2.000.000 (passo geométrico) e várias folgas técnicas.
    for (let limit = 1_024; limit <= 2_000_000; limit = Math.ceil(limit * 1.013) + 1) {
      for (const fixed of [0, 2_500, 10_000, 40_000]) {
        for (const extra of [0, 1, 777, Math.floor(limit / 3), limit * 4]) {
          const t = deriveThresholds({ limit, inputMax: limit + fixed + extra, fixedTokens: fixed });
          for (const value of Object.values(t)) expect(Number.isInteger(value)).toBe(true);
          expect(t.compactBp - t.microBp).toBeGreaterThanOrEqual(2_000);
          expect(t.hardBp).toBeGreaterThanOrEqual(FULL_BP);
          expect(t.microBp).toBeLessThan(t.warnBp);
          expect(t.warnBp).toBeLessThan(t.compactBp);
          if (limit >= 5_000) {
            const atCompact = Math.floor((t.compactBp * limit) / FULL_BP);
            const atHard = Math.floor((t.hardBp * limit) / FULL_BP);
            expect(atCompact + 2 * (t.stepResultCap + t.stepGrowth)).toBeLessThanOrEqual(atHard);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(5_000);
  });

  it('uso em pontos-base é exato nas comparações (sem ponto flutuante)', () => {
    const limit = 252_144;
    expect(usageBp(bpToTokens(6_000, limit), limit)).toBe(5_999);
    expect(usageBp(Math.ceil((6_000 * limit) / FULL_BP), limit)).toBe(6_000);
    expect(usageBp(0, 0)).toBe(0);
    expect(usageBp(10, 0)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('ajustes da interface (clampUserThresholds)', () => {
  const derived = deriveThresholds({ limit: 252_144, inputMax: 879_301, fixedTokens: 10_000 });

  it('regressão do floor2: compactar em 82% dá limpeza em 57% exatos', () => {
    const t = clampUserThresholds({ compactBp: 8_200 }, derived, 252_144);
    expect(t.compactBp).toBe(8_200);
    expect(t.microBp).toBe(5_700);
    expect(t.warnBp).toBe(7_200);
    expect(t.postMicroBp).toBe(4_200);
  });

  it('corta valores fora da faixa', () => {
    expect(clampUserThresholds({ compactBp: 9_900 }, derived, 252_144).compactBp).toBe(9_000);
    expect(clampUserThresholds({ compactBp: 1_000 }, derived, 252_144).compactBp).toBe(5_000);
    const t = clampUserThresholds({ compactBp: 8_500, microBp: 8_000, warnBp: 9_000 }, derived, 252_144);
    expect(t.microBp).toBe(7_000);
    expect(t.warnBp).toBe(8_500);
    expect(clampUserThresholds({ microBp: Number.NaN }, derived, 252_144)).toEqual(derived);
  });

  it('respeita a folga até o limite técnico; se for impossível, volta aos derivados', () => {
    const tight = deriveThresholds({ limit: 18_000, inputMax: 28_000, fixedTokens: 10_000 });
    expect(clampUserThresholds({ compactBp: 8_000 }, tight, 18_000).compactBp).toBe(6_000);
    const tiny: Thresholds = deriveThresholds({ limit: 1_024, inputMax: 11_024, fixedTokens: 10_000 });
    expect(clampUserThresholds({ compactBp: 7_000 }, tiny, 1_024)).toEqual(tiny);
  });
});

describe('divisão depois da compactação (seção 5.5)', () => {
  it('L = 252.144 fica em 27% de L', () => {
    const split = postCompactionSplit(252_144);
    expect(split).toEqual({ summaryTokens: 12_000, userRequestsTokens: 12_607, actionLedgerTokens: 4_000, tailTokens: 40_000, totalTokens: 68_607 });
  });

  it('L = 63.705 fica em 30% de L', () => {
    const split = postCompactionSplit(63_705);
    expect(split).toEqual({ summaryTokens: 5_096, userRequestsTokens: 3_185, actionLedgerTokens: 1_274, tailTokens: 9_556, totalTokens: 19_111 });
  });

  it('o resumo não passa da reserva de saída do resumidor', () => {
    expect(postCompactionSplit(252_144, 8_192).summaryTokens).toBe(8_192);
  });

  it('retorno de subagente: 3% do limite do pai, entre 1.000 e 8.000', () => {
    expect(subagentReturnCap(252_144)).toBe(7_564);
    expect(subagentReturnCap(10_000)).toBe(1_000);
    expect(subagentReturnCap(1_000_000)).toBe(8_000);
  });
});

describe('teto por passo para resultados em paralelo (fitStepResults)', () => {
  it('três resultados cheios dividem o teto do passo igualmente', () => {
    const caps = fitStepResults(
      [
        { ref: 'a', tokens: 12_607 },
        { ref: 'b', tokens: 12_607 },
        { ref: 'c', tokens: 12_607 },
      ],
      25_214,
      12_607,
    );
    expect(caps.map((c) => c.capTokens)).toEqual([8_404, 8_404, 8_404]);
    expect(caps.reduce((sum, c) => sum + c.capTokens, 0)).toBeLessThanOrEqual(25_214);
  });

  it('os pequenos ficam inteiros; o corte sai dos maiores', () => {
    const caps = fitStepResults(
      [
        { ref: 'small', tokens: 300 },
        { ref: 'big1', tokens: 20_000 },
        { ref: 'big2', tokens: 20_000 },
      ],
      10_000,
      12_607,
    );
    expect(caps).toEqual([
      { ref: 'small', capTokens: 300 },
      { ref: 'big1', capTokens: 4_850 },
      { ref: 'big2', capTokens: 4_850 },
    ]);
  });

  it('cabe tudo: só aplica o teto por resultado; muitos resultados nunca ficam abaixo de 256', () => {
    expect(fitStepResults([{ ref: 'a', tokens: 30_000 }], 25_214, 12_607)).toEqual([{ ref: 'a', capTokens: 12_607 }]);
    const many = Array.from({ length: 200 }, (_, i) => ({ ref: `r${i}`, tokens: 1_000 }));
    expect(fitStepResults(many, 25_214, 12_607).every((c) => c.capTokens === MIN_RESULT_CAP)).toBe(true);
  });
});
