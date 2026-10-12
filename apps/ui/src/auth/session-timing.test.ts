import { describe, expect, it } from 'vitest';
import { sessionTimings } from './session-timing';

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

  it('valor inválido usa o mínimo seguro', () => {
    expect(sessionTimings(Number.NaN).activityEveryMs).toBe(15_000);
    expect(sessionTimings(0).activityEveryMs).toBe(15_000);
  });
});
