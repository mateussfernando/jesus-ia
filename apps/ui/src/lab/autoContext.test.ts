import { hologramSnapshotSchema } from '@jesus/hologram';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, describeLabBudget, labModels, withAutoLimit } from './autoContext';
import { applyAction, initialSnapshot } from './scenarios';

describe('limite de contexto automático no laboratório', () => {
  it('começa pelo cérebro escolhido (Claude Haiku 5.5): 80 mil, abaixo do degrau de preço', () => {
    const snapshot = withAutoLimit(initialSnapshot, DEFAULT_MODEL);
    expect(snapshot.context.limitTokens).toBe(80_000);
    expect(describeLabBudget(DEFAULT_MODEL, snapshot)).toContain('degrau de preço');
  });

  it('trocar o modelo muda o limite sozinho e mantém o snapshot válido', () => {
    const limits = new Set<number>();
    for (const model of labModels) {
      const snapshot = withAutoLimit(initialSnapshot, model.key);
      expect(hologramSnapshotSchema.safeParse(snapshot).success).toBe(true);
      expect(snapshot.context.usedTokens).toBeLessThanOrEqual(snapshot.context.limitTokens);
      limits.add(snapshot.context.limitTokens);
    }
    expect(limits.size).toBeGreaterThan(1);
  });

  it('gastar quase todo o orçamento do dia aperta o limite', () => {
    const relaxed = withAutoLimit(initialSnapshot, DEFAULT_MODEL);
    const tight = withAutoLimit(applyAction(relaxed, { type: 'spend', todayUsd: 4.8 }, 0), DEFAULT_MODEL);
    expect(tight.context.limitTokens).toBeLessThan(relaxed.context.limitTokens);
  });

  it('não recria o snapshot quando o limite não muda', () => {
    const snapshot = withAutoLimit(initialSnapshot, DEFAULT_MODEL);
    expect(withAutoLimit(snapshot, DEFAULT_MODEL)).toBe(snapshot);
  });

  it('uso em fração acompanha o limite atual', () => {
    const snapshot = withAutoLimit(initialSnapshot, DEFAULT_MODEL);
    expect(applyAction(snapshot, { type: 'contextRatio', ratio: 0.5 }, 0).context.usedTokens).toBe(40_000);
    expect(applyAction(snapshot, { type: 'contextRatio', ratio: 7 }, 0).context.usedTokens).toBe(80_000);
  });
});
