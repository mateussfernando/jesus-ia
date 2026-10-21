import type { AuditEvent } from '@jesus/shared/audit';
import { describe, expect, it } from 'vitest';
import { DailySpend, MAX_DAILY_LIMIT_PUSD, MIN_DAILY_LIMIT_PUSD } from './egress/spend';
import { handleSpendRequest } from './spend-requests';

const USD = 1_000_000_000_000;
const NOON = Date.UTC(2026, 9, 19, 15, 0, 0);

function setup(options: { auditFails?: boolean } = {}) {
  const spend = new DailySpend({ limitPUsd: USD, timeZone: 'America/Sao_Paulo', now: () => NOON });
  const events: AuditEvent[] = [];
  const record = (event: AuditEvent) => {
    events.push(event);
    return options.auditFails === true ? Promise.reject(new Error('disco cheio')) : Promise.resolve();
  };
  return { spend, events, record };
}

describe('handleSpendRequest', () => {
  it('mostra o gasto do dia e o teto', async () => {
    const { spend, record } = setup();
    spend.reserve('a', 300);
    spend.settle('a', 120);
    spend.reserve('b', 50);
    expect(await handleSpendRequest({ type: 'spend', id: 1, op: 'status' }, spend, record)).toEqual({
      ok: true,
      day: { dayKey: '2026-10-19', spentPUsd: 120, reservedPUsd: 50, limitPUsd: USD },
    });
  });

  it('muda o teto: grava no registro (com o anterior) e só então aplica', async () => {
    const { spend, events, record } = setup();
    const result = await handleSpendRequest({ type: 'spend', id: 1, op: 'set-limit', limitPUsd: 2.5 * USD }, spend, record);
    expect(result).toMatchObject({ ok: true, day: { limitPUsd: 2.5 * USD } });
    expect(events).toEqual([{ type: 'spend.limit_set', limit_pusd: 2.5 * USD, previous_pusd: USD }]);
    expect(spend.snapshot().limitPUsd).toBe(2.5 * USD);
  });

  it('fora da faixa ou sem valor: recusa e não grava nada', async () => {
    const { spend, events, record } = setup();
    for (const limitPUsd of [undefined, 0, MIN_DAILY_LIMIT_PUSD - 1, MAX_DAILY_LIMIT_PUSD + 1]) {
      const result = await handleSpendRequest({ type: 'spend', id: 1, op: 'set-limit', ...(limitPUsd === undefined ? {} : { limitPUsd }) }, spend, record);
      expect(result).toMatchObject({ ok: false, problem: 'range', day: { limitPUsd: USD } });
    }
    expect(events).toEqual([]);
  });

  it('o registro não grava: o teto fica como estava', async () => {
    const { spend, record } = setup({ auditFails: true });
    const result = await handleSpendRequest({ type: 'spend', id: 1, op: 'set-limit', limitPUsd: 5 * USD }, spend, record);
    expect(result).toMatchObject({ ok: false, problem: 'audit', day: { limitPUsd: USD } });
    expect(spend.snapshot().limitPUsd).toBe(USD);
  });
});
