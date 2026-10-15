import { describe, expect, it } from 'vitest';
import type { Calibration } from './calibration';
import { calibrationFactor, marginRatio, updateCalibration } from './calibration';
import { tokenizerFamilies } from './types';

/** Gerador congruente linear com semente: as "propriedades" rodam como varreduras determinísticas. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Aplica amostras (estimado, real) em sequência a partir de uma calibração vazia. */
function feed(samples: readonly (readonly [number, number])[], start: Calibration | null = null): Calibration | null {
  return samples.reduce<Calibration | null>((cal, [estimated, actual]) => updateCalibration(cal, estimated, actual), start);
}

describe('updateCalibration, calibrationFactor e marginRatio (seção 7.4, apêndice B)', () => {
  it('três amostras de razão 1,1: k = 1,1 (±1e-9) e m = 0,03', () => {
    const cal = feed([
      [1_000, 1_100],
      [2_000, 2_200],
      [10_000, 11_000],
    ]);
    expect(cal?.samples).toBe(3);
    expect(cal?.anomalies).toBe(0);
    expect(Math.abs(calibrationFactor(cal) - 1.1)).toBeLessThanOrEqual(1e-9);
    expect(marginRatio(cal, 'deepseek', false)).toBe(0.03);
    expect(marginRatio(cal, 'unknown', true)).toBe(0.03); // calibrado: a fórmula vale para qualquer família
  });

  it('razão 3,0: incrementa anomalies e não altera samples, mean nem variance', () => {
    const before = feed([
      [1_000, 1_100],
      [1_000, 1_300],
    ]);
    const after = updateCalibration(before, 1_000, 3_000);
    expect(after.anomalies).toBe(1);
    expect(after.samples).toBe(before?.samples);
    expect(after.mean).toBe(before?.mean);
    expect(after.variance).toBe(before?.variance);
  });

  it('marginRatio sem amostras: 0,10 para deepseek; 0,15 para unknown e para runtime local', () => {
    expect(marginRatio(null, 'deepseek', false)).toBe(0.1);
    expect(marginRatio(null, 'unknown', false)).toBe(0.15);
    expect(marginRatio(null, 'deepseek', true)).toBe(0.15);
    expect(marginRatio(null, 'claude', false)).toBe(0.1);
  });

  it('com menos de 3 amostras: k = 1 e margem padrão', () => {
    const two = feed([
      [1_000, 1_500],
      [1_000, 1_500],
    ]);
    expect(two?.samples).toBe(2);
    expect(calibrationFactor(null)).toBe(1);
    expect(calibrationFactor(two)).toBe(1);
    expect(marginRatio(two, 'openai_o200k', false)).toBe(0.1);
    expect(marginRatio(two, 'llama', true)).toBe(0.15);
  });

  it('a primeira amostra inicializa mean = ln r e variance = 0', () => {
    expect(updateCalibration(null, 1_000, 1_250)).toEqual({ samples: 1, mean: Math.log(1.25), variance: 0, anomalies: 0 });
  });

  it('EWMA: razões 1,0 e depois 2,0 dão mean = 0,2·ln 2 e variance = 0,16·(ln 2)²', () => {
    const cal = feed([
      [1_000, 1_000],
      [1_000, 2_000],
    ]);
    expect(cal?.samples).toBe(2);
    expect(cal?.mean).toBeCloseTo(0.2 * Math.LN2, 12);
    expect(cal?.variance).toBeCloseTo(0.16 * Math.LN2 * Math.LN2, 12);
  });

  it('as bordas 0,5 e 2,0 entram; logo fora delas é anomalia', () => {
    expect(updateCalibration(null, 1_000, 500).samples).toBe(1);
    expect(updateCalibration(null, 1_000, 2_000).samples).toBe(1);
    expect(updateCalibration(null, 1_000, 499)).toEqual({ samples: 0, mean: 0, variance: 0, anomalies: 1 });
    expect(updateCalibration(null, 1_000, 2_001)).toEqual({ samples: 0, mean: 0, variance: 0, anomalies: 1 });
  });

  it('estimativa ou real não finitos ou ≤ 0 contam como anomalia e nada mais muda', () => {
    const base = feed([[1_000, 1_100]]);
    const invalid: readonly (readonly [number, number])[] = [
      [0, 1_000],
      [-1_000, 1_000],
      [1_000, 0],
      [1_000, -5],
      [Number.NaN, 1_000],
      [1_000, Number.NaN],
      [Number.POSITIVE_INFINITY, 1_000],
      [1_000, Number.POSITIVE_INFINITY],
      [Number.MIN_VALUE, Number.MAX_VALUE],
    ];
    for (const [estimated, actual] of invalid) {
      const next = updateCalibration(base, estimated, actual);
      expect(next).toEqual({ samples: base?.samples, mean: base?.mean, variance: base?.variance, anomalies: 1 });
    }
  });

  it('α próprio é respeitado; α fora de (0; 1] vale 0,2', () => {
    const first = updateCalibration(null, 1_000, 1_000);
    const half = updateCalibration(first, 1_000, 2_000, 0.5);
    expect(half.mean).toBeCloseTo(0.5 * Math.LN2, 12);
    expect(half.variance).toBeCloseTo(0.25 * Math.LN2 * Math.LN2, 12);
    const standard = updateCalibration(first, 1_000, 2_000);
    for (const bad of [0, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(updateCalibration(first, 1_000, 2_000, bad)).toEqual(standard);
    }
  });

  it('variância alta (razões alternando 0,5 e 2): margem presa em 0,12', () => {
    const samples = Array.from({ length: 10 }, (_, i) => [1_000, i % 2 === 0 ? 500 : 2_000] as const);
    const cal = feed(samples);
    expect(cal?.samples).toBe(10);
    expect(marginRatio(cal, 'claude', false)).toBe(0.12);
  });

  it('margem calibrada intermediária: 0,02 + 2·√variance', () => {
    // Razões 1,0, 1,0 e 1,1: as duas primeiras deixam mean = 0 e variance = 0; a terceira tem d = ln 1,1.
    const x = Math.log(1.1);
    const varianceAfterThird = 0.8 * (0 + 0.2 * x * x);
    const cal = feed([
      [1_000, 1_000],
      [1_000, 1_000],
      [1_000, 1_100],
    ]);
    expect(cal?.variance).toBeCloseTo(varianceAfterThird, 15);
    const m = marginRatio(cal, 'gemini', false);
    expect(m).toBeCloseTo(0.02 + 2 * Math.sqrt(varianceAfterThird), 15); // ≈ 0,096: dentro de [0,03; 0,12]
    expect(m).toBeGreaterThan(0.03);
    expect(m).toBeLessThan(0.12);
  });

  it('calibração corrompida (banco) vale como "sem calibração" e a série recomeça', () => {
    const corrupt: Calibration[] = [
      { samples: 5, mean: Number.NaN, variance: 0, anomalies: 0 },
      { samples: 5, mean: 0.1, variance: -1, anomalies: 0 },
      { samples: 5, mean: 3, variance: 0, anomalies: 0 }, // exp(3) ≈ 20: impossível com amostras em [0,5; 2]
      { samples: Number.NaN, mean: 0.1, variance: 0, anomalies: 0 },
      { samples: 5, mean: 0.1, variance: Number.POSITIVE_INFINITY, anomalies: 0 },
    ];
    for (const cal of corrupt) {
      expect(calibrationFactor(cal)).toBe(1);
      expect(marginRatio(cal, 'deepseek', false)).toBe(0.1);
      expect(updateCalibration(cal, 1_000, 1_100)).toEqual({ samples: 1, mean: Math.log(1.1), variance: 0, anomalies: 0 });
    }
    expect(updateCalibration({ samples: 0, mean: 0, variance: 0, anomalies: Number.NaN }, 1_000, 3_000).anomalies).toBe(1);
  });

  it('é pura: não altera a calibração recebida', () => {
    const cal: Calibration = { samples: 4, mean: 0.05, variance: 0.001, anomalies: 2 };
    const copy = { ...cal };
    updateCalibration(cal, 1_000, 1_200);
    updateCalibration(cal, 1_000, 9_000);
    expect(cal).toEqual(copy);
  });

  it('propriedade (varredura com semente): k em [0,5; 2], m em [0,03; 0,12] e contagens coerentes', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = lcg(seed);
      let cal: Calibration | null = null;
      let accepted = 0;
      let rejected = 0;
      const steps = 1 + Math.floor(rand() * 40);
      for (let step = 0; step < steps; step++) {
        const estimated = 1 + Math.floor(rand() * 200_000);
        const ratio = 0.3 + rand() * 2.9; // de 0,3 a 3,2: parte fora da faixa
        const actual = Math.max(1, Math.round(estimated * ratio));
        const r = actual / estimated;
        if (r >= 0.5 && r <= 2) accepted++;
        else rejected++;
        cal = updateCalibration(cal, estimated, actual);
      }
      expect(cal?.samples).toBe(accepted);
      expect(cal?.anomalies).toBe(rejected);
      expect(Number.isFinite(cal?.mean)).toBe(true);
      expect(Math.abs(cal?.mean ?? 0)).toBeLessThanOrEqual(Math.LN2 + 1e-9);
      expect(cal?.variance ?? -1).toBeGreaterThanOrEqual(0);
      const k = calibrationFactor(cal);
      expect(k).toBeGreaterThanOrEqual(0.5);
      expect(k).toBeLessThanOrEqual(2);
      for (const family of tokenizerFamilies) {
        for (const local of [false, true]) {
          const m = marginRatio(cal, family, local);
          if (accepted >= 3) {
            expect(m).toBeGreaterThanOrEqual(0.03);
            expect(m).toBeLessThanOrEqual(0.12);
          } else {
            expect(m).toBe(family === 'unknown' || local ? 0.15 : 0.1);
          }
        }
      }
    }
  });
});
