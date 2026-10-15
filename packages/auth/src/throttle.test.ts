import { describe, expect, it } from 'vitest';
import { defaultThrottlePolicy, delayAfterFailures, freeAttemptsLeft, needsFailureAnchor, remainingWaitMs } from './throttle';

const MIN = 60_000;

describe('delayAfterFailures', () => {
  it('5 erros livres; depois 30 s, 1, 2, 4, 8 min e teto de 15 min', () => {
    expect([0, 1, 2, 3, 4].map((f) => delayAfterFailures(f))).toEqual([0, 0, 0, 0, 0]);
    expect(delayAfterFailures(5)).toBe(30_000);
    expect(delayAfterFailures(6)).toBe(MIN);
    expect(delayAfterFailures(7)).toBe(2 * MIN);
    expect(delayAfterFailures(8)).toBe(4 * MIN);
    expect(delayAfterFailures(9)).toBe(8 * MIN);
    expect(delayAfterFailures(10)).toBe(15 * MIN);
    expect(delayAfterFailures(1_000)).toBe(15 * MIN);
  });

  it('entrada inválida vale o pior caso (teto)', () => {
    expect(delayAfterFailures(-1)).toBe(defaultThrottlePolicy.maxDelayMs);
    expect(delayAfterFailures(2.5)).toBe(defaultThrottlePolicy.maxDelayMs);
    expect(delayAfterFailures(Number.NaN)).toBe(defaultThrottlePolicy.maxDelayMs);
  });
});

describe('remainingWaitMs', () => {
  it('conta a partir do último erro', () => {
    expect(remainingWaitMs(5, 1_000_000, 1_000_000)).toBe(30_000);
    expect(remainingWaitMs(5, 1_000_000, 1_020_000)).toBe(10_000);
    expect(remainingWaitMs(5, 1_000_000, 1_030_000)).toBe(0);
    expect(remainingWaitMs(4, 1_000_000, 1_000_000)).toBe(0);
  });

  it('relógio que volta: o número mostrado não passa da espera, e quem chama precisa reancorar', () => {
    expect(remainingWaitMs(6, 10 * MIN, 0)).toBe(MIN);
    // Sem reancorar, a espera não andaria enquanto o relógio não alcança a data gravada.
    expect(remainingWaitMs(6, 10 * MIN, 5 * MIN)).toBe(MIN);
    expect(needsFailureAnchor(6, 10 * MIN, 0)).toBe(true);
    // Reancorada no instante atual, ela termina em no máximo a espera exigida.
    expect(remainingWaitMs(6, 0, MIN)).toBe(0);
  });

  it('pede reancorar só com erros contados e data ausente ou no futuro', () => {
    expect(needsFailureAnchor(0, null, 0)).toBe(false);
    expect(needsFailureAnchor(0, 10, 0)).toBe(false);
    expect(needsFailureAnchor(3, 10, 10)).toBe(false);
    expect(needsFailureAnchor(3, 5, 10)).toBe(false);
    expect(needsFailureAnchor(3, 11, 10)).toBe(true);
    expect(needsFailureAnchor(3, null, 10)).toBe(true);
    expect(needsFailureAnchor(3, Number.NaN, 10)).toBe(true);
  });

  it('sem data do último erro, mas com erros contados, vale a espera inteira', () => {
    expect(remainingWaitMs(7, null, 123)).toBe(2 * MIN);
  });
});

describe('freeAttemptsLeft', () => {
  it('diz quantas tentativas ainda não geram espera', () => {
    expect(freeAttemptsLeft(0)).toBe(5);
    expect(freeAttemptsLeft(3)).toBe(2);
    expect(freeAttemptsLeft(9)).toBe(0);
    expect(freeAttemptsLeft(-1)).toBe(0);
  });
});
