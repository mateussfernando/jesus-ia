import { describe, expect, it } from 'vitest';
import { sessionTimings, shouldSignal } from './session-timing';

describe('cadência da página aberta', () => {
  it('o sinal de uso sai bem antes do tempo sem uso acabar', () => {
    for (const minutes of [1, 2, 5, 15, 120]) {
      const idleMs = minutes * 60_000;
      const { checkEveryMs, activityEveryMs } = sessionTimings(idleMs);
      expect(activityEveryMs).toBeLessThanOrEqual(idleMs / 4);
      expect(checkEveryMs).toBeLessThanOrEqual(30_000);
    }
    expect(sessionTimings(60_000)).toEqual({ checkEveryMs: 15_000, activityEveryMs: 15_000 });
    expect(sessionTimings(15 * 60_000)).toEqual({ checkEveryMs: 30_000, activityEveryMs: 30_000 });
  });

  it('limita a frequência do sinal de uso sem travar se o relógio voltar', () => {
    expect(shouldSignal(0, Number.NEGATIVE_INFINITY, 15_000)).toBe(true);
    expect(shouldSignal(10_000, 0, 15_000)).toBe(false);
    expect(shouldSignal(15_000, 0, 15_000)).toBe(true);
    // Relógio que voltou: manda na hora, em vez de esperar alcançar o carimbo antigo.
    expect(shouldSignal(5_000, 3_600_000, 15_000)).toBe(true);
  });

  it('valor inválido usa o mínimo seguro', () => {
    expect(sessionTimings(Number.NaN).activityEveryMs).toBe(15_000);
    expect(sessionTimings(0).activityEveryMs).toBe(15_000);
  });
});
