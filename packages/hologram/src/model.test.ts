import { describe, expect, it } from 'vitest';
import { hologramStates, MAX_SATELLITES, parseHologramSnapshot } from './model';
import type { HologramSnapshot } from './model';

const valid: HologramSnapshot = {
  state: 'idle',
  context: { usedTokens: 1000, limitTokens: 200_000 },
  spend: { todayUsd: 0.5, limitUsd: 5 },
  satellites: [{ id: 'google', label: 'Google', access: 'read' }],
  pulses: [{ id: 'p1', satelliteId: 'google', kind: 'action', startedAt: 10 }],
  taint: 'clean',
  subagents: 0,
  memoryCount: 3,
  deviceCode: null,
};

describe('parseHologramSnapshot', () => {
  it('aceita um snapshot válido', () => {
    const result = parseHologramSnapshot(valid);
    expect(result.ok).toBe(true);
  });

  it('aceita todos os estados documentados', () => {
    for (const state of hologramStates) {
      expect(parseHologramSnapshot({ ...valid, state }).ok).toBe(true);
    }
  });

  it('rejeita campos desconhecidos (Zod estrito na fronteira)', () => {
    expect(parseHologramSnapshot({ ...valid, extra: true }).ok).toBe(false);
    expect(parseHologramSnapshot({ ...valid, context: { ...valid.context, hack: 1 } }).ok).toBe(false);
  });

  it('rejeita estado, acesso e código de login inválidos', () => {
    expect(parseHologramSnapshot({ ...valid, state: 'hacked' }).ok).toBe(false);
    expect(parseHologramSnapshot({ ...valid, satellites: [{ id: 'x', label: 'X', access: 'admin' }] }).ok).toBe(false);
    expect(parseHologramSnapshot({ ...valid, deviceCode: '<script>' }).ok).toBe(false);
    expect(parseHologramSnapshot({ ...valid, deviceCode: 'WDJB-MJHT' }).ok).toBe(true);
  });

  it('rejeita números fora da faixa', () => {
    expect(parseHologramSnapshot({ ...valid, context: { usedTokens: -1, limitTokens: 10 } }).ok).toBe(false);
    expect(parseHologramSnapshot({ ...valid, context: { usedTokens: 1, limitTokens: 0 } }).ok).toBe(false);
    expect(parseHologramSnapshot({ ...valid, spend: { todayUsd: Number.NaN, limitUsd: 5 } }).ok).toBe(false);
    expect(parseHologramSnapshot({ ...valid, subagents: 99 }).ok).toBe(false);
  });

  it('limita o número de satélites', () => {
    const satellites = Array.from({ length: MAX_SATELLITES + 1 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, access: 'read' }));
    expect(parseHologramSnapshot({ ...valid, satellites }).ok).toBe(false);
  });

  it('nunca lança: lixo volta como erro', () => {
    for (const input of [null, undefined, 42, 'texto', [], {}]) {
      const result = parseHologramSnapshot(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
