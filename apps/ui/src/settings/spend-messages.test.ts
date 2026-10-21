import { describe, expect, it } from 'vitest';
import { formatUsd, limitInputValue, NO_SPEND, parseDailyLimit, spendMessageFor } from './spend-messages';

const USD = 1_000_000_000_000;

describe('teto de gasto do dia na tela', () => {
  it('lê o valor digitado em reais-de-dólar, com vírgula ou ponto, dentro da faixa', () => {
    expect(parseDailyLimit('2')).toEqual({ ok: true, pUsd: 2 * USD });
    expect(parseDailyLimit('2,5')).toEqual({ ok: true, pUsd: 2.5 * USD });
    expect(parseDailyLimit(' 2.50 ')).toEqual({ ok: true, pUsd: 2.5 * USD });
    expect(parseDailyLimit('US$ 0,05')).toEqual({ ok: true, pUsd: 0.05 * USD });
    expect(parseDailyLimit('0,01')).toEqual({ ok: true, pUsd: 0.01 * USD });
    expect(parseDailyLimit('100')).toEqual({ ok: true, pUsd: 100 * USD });
    for (const invalid of ['0', '0,00', '100,01', '1000', '-1', '1,234', '1e3', '', 'dez', '1,5,0', '0x10']) {
      expect(parseDailyLimit(invalid), invalid).toEqual({ ok: false });
    }
  });

  it('formata em dólares, no jeito brasileiro', () => {
    expect(formatUsd(USD)).toMatch(/^US\$\s1,00$/);
    expect(formatUsd(31_200_000_000)).toMatch(/^US\$\s0,0312$/);
    expect(limitInputValue(2.5 * USD)).toBe('2,50');
  });

  it('mensagens: resumo do dia, teto no campo e um texto por problema', () => {
    const day = { dayKey: '2026-10-19', spentPUsd: 0.02 * USD, reservedPUsd: 0.01 * USD, limitPUsd: 2 * USD };
    const ok = spendMessageFor({ ok: true, day }, 'Teto salvo.');
    expect(ok.summary).toMatch(/^Gasto hoje: US\$\s0,03 \(com US\$\s0,01 em andamento\) de US\$\s2,00\.$/);
    expect(ok.limitInput).toBe('2,00');
    expect(ok.message).toBe('Teto salvo.');
    expect(spendMessageFor({ ok: false, day, problem: 'range' }, null).message).toContain('US$ 0,01');
    expect(spendMessageFor({ ok: false, day, problem: 'audit' }, null).message).toContain('registro');
    expect(spendMessageFor({ ok: false, problem: 'failed' }, null)).toMatchObject({ summary: null, limitInput: '' });
    expect(NO_SPEND.available).toBe(false);
  });
});
