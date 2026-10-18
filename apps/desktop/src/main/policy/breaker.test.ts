import { describe, expect, it } from 'vitest';
import { ViolationBreaker } from './breaker';

describe('disjuntor do vigia de quadros', () => {
  it('violações seguidas não são puladas: só passam do limite depois de muitas em pouco tempo', () => {
    const breaker = new ViolationBreaker({ limit: 3, windowMs: 10_000, now: () => 0 });
    expect([breaker.record(), breaker.record(), breaker.record()]).toEqual([false, false, false]);
    expect(breaker.record()).toBe(true);
  });

  it('violações espaçadas não somam', () => {
    let now = 0;
    const breaker = new ViolationBreaker({ limit: 2, windowMs: 10_000, now: () => now });
    for (let i = 0; i < 10; i++) {
      expect(breaker.record()).toBe(false);
      now += 6_000;
    }
  });
});
