import { describe, expect, it } from 'vitest';
import type { ContextAnchor } from './anchor';
import { contextUsage, isAnchorValid } from './anchor';
import type { ContextItemMeta } from './items';

/** Gerador pseudoaleatório determinístico (LCG de Numerical Recipes), para as propriedades sem fast-check. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

let seq = 0;
function item(tokens: number, extra: Partial<ContextItemMeta> = {}): ContextItemMeta {
  seq += 1;
  return { id: `item-${seq}`, seq, turn: 1, kind: 'assistant', tokens, origin: 'local', ...extra };
}

const MODEL = 'deepseek:deepseek-v4-flash';
const current = { modelKey: MODEL, historyVersion: 3, toolsetHash: 'tools-a' };
const anchor: ContextAnchor = {
  ...current,
  actualInputTokens: 50_000,
  fixedEstimate: 10_000,
  historyEstimate: 38_000,
};

// Histórico até a âncora (38.000 estimados) e os dois itens novos depois dela.
const before = [item(20_000), item(10_000), item(8_000)];
const after = [item(1_000), item(500)];
const all = [...before, ...after];

describe('âncora no uso real (seção 7.2)', () => {
  it('exemplo da especificação: fixedReal 10.417, usedTokens 41.233, totalInputTokens 51.650', () => {
    const usage = contextUsage({ anchor, current, itemsAfterAnchor: after, allItems: all, fixedEstimate: 10_000, k: 1.1 });
    // fixedReal = round(50.000 × 10.000 / 48.000) = 10.417; usado = 50.000 − 10.417 + round(1,1 × 1.500).
    expect(usage).toEqual({ usedTokens: 41_233, totalInputTokens: 51_650, source: 'anchored' });
  });

  it('sem nada novo depois da âncora: total = entrada real e usado = real − fixedReal (10.417)', () => {
    const usage = contextUsage({ anchor, current, itemsAfterAnchor: [], allItems: before, fixedEstimate: 10_000, k: 1.1 });
    expect(usage).toEqual({ usedTokens: 50_000 - 10_417, totalInputTokens: 50_000, source: 'anchored' });
  });

  it.each([
    ['outro modelKey', { modelKey: 'anthropic:claude-haiku-5-5' }],
    ['outra historyVersion', { historyVersion: 4 }],
    ['outro toolsetHash', { toolsetHash: 'tools-b' }],
  ])('âncora com %s → estimated', (_label, change) => {
    const usage = contextUsage({
      anchor,
      current: { ...current, ...change },
      itemsAfterAnchor: after,
      allItems: all,
      fixedEstimate: 10_000,
      k: 1.1,
    });
    // total = round(1,1 × (39.500 + 10.000)) = 54.450; usado = 54.450 − round(1,1 × 10.000) = 43.450.
    expect(usage).toEqual({ usedTokens: 43_450, totalInputTokens: 54_450, source: 'estimated' });
  });

  it('sem âncora → estimated, com os mesmos números', () => {
    const usage = contextUsage({ anchor: null, current, itemsAfterAnchor: after, allItems: all, fixedEstimate: 10_000, k: 1.1 });
    expect(usage).toEqual({ usedTokens: 43_450, totalInputTokens: 54_450, source: 'estimated' });
  });

  it('parte fixa que mudou depois da âncora entra no total, não no usado', () => {
    const usage = contextUsage({ anchor, current, itemsAfterAnchor: after, allItems: all, fixedEstimate: 12_000, k: 1.1 });
    // total = 50.000 + round(1,1 × (1.500 + 2.000)) = 53.850; usado continua 41.233.
    expect(usage).toEqual({ usedTokens: 41_233, totalInputTokens: 53_850, source: 'anchored' });
  });

  it('itens limpos contam com os tokens atuais (o marcador)', () => {
    const stub = item(40, { kind: 'tool_result', cleared: true });
    const usage = contextUsage({
      anchor: null,
      current,
      itemsAfterAnchor: [],
      allItems: [item(9_000), stub],
      fixedEstimate: 1_000,
      k: 1,
    });
    expect(usage).toEqual({ usedTokens: 9_040, totalInputTokens: 10_040, source: 'estimated' });
  });

  it('arredonda o produto com k sem o erro de ponto flutuante (1,1 × 1.500 = 1.650; 1,1 × 5 = 5,5 → 6)', () => {
    expect(1.1 * 1_500).not.toBe(1_650);
    const usage = contextUsage({ anchor, current, itemsAfterAnchor: [item(5)], allItems: all, fixedEstimate: 10_000, k: 1.1 });
    expect(usage.usedTokens).toBe(50_000 - 10_417 + 6);
    expect(usage.totalInputTokens).toBe(50_006);
  });

  it('âncora com números degenerados não vale: volta a estimar', () => {
    const broken: ContextAnchor[] = [
      { ...anchor, actualInputTokens: Number.NaN },
      { ...anchor, actualInputTokens: 0 },
      { ...anchor, actualInputTokens: -5 },
      { ...anchor, actualInputTokens: Number.POSITIVE_INFINITY },
      { ...anchor, fixedEstimate: 0, historyEstimate: 0 },
      { ...anchor, fixedEstimate: -1 },
      { ...anchor, historyEstimate: Number.NaN },
      { ...anchor, historyVersion: Number.NaN },
    ];
    for (const candidate of broken) {
      const key = { ...current, historyVersion: candidate.historyVersion };
      expect(isAnchorValid(candidate, key)).toBe(false);
      const usage = contextUsage({
        anchor: candidate,
        current: key,
        itemsAfterAnchor: after,
        allItems: all,
        fixedEstimate: 10_000,
        k: 1.1,
      });
      expect(usage).toEqual({ usedTokens: 43_450, totalInputTokens: 54_450, source: 'estimated' });
    }
  });

  it('isAnchorValid: só com o mesmo modelo, historyVersion e toolsetHash', () => {
    expect(isAnchorValid(anchor, current)).toBe(true);
    expect(isAnchorValid(null, current)).toBe(false);
    expect(isAnchorValid(anchor, { ...current, modelKey: 'deepseek:deepseek-v4-pro' })).toBe(false);
    expect(isAnchorValid(anchor, { ...current, historyVersion: 2 })).toBe(false);
    expect(isAnchorValid(anchor, { ...current, toolsetHash: '' })).toBe(false);
  });

  it('contagens inválidas contam 0 e k inválido vale 1', () => {
    const weird = [item(Number.NaN), item(-300), item(Number.POSITIVE_INFINITY), item(2_000)];
    for (const k of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const usage = contextUsage({ anchor: null, current, itemsAfterAnchor: [], allItems: weird, fixedEstimate: Number.NaN, k });
      expect(usage).toEqual({ usedTokens: 2_000, totalInputTokens: 2_000, source: 'estimated' });
    }
  });

  it('a parte fixa que encolheu muito não deixa nada negativo', () => {
    const usage = contextUsage({
      anchor: { ...anchor, actualInputTokens: 1_000, fixedEstimate: 90_000, historyEstimate: 10_000 },
      current,
      itemsAfterAnchor: [],
      allItems: [],
      fixedEstimate: 0,
      k: 2,
    });
    // total = 1.000 + round(2 × (0 − 90.000)) < 0 → 0; usado = 1.000 − 900 = 100.
    expect(usage).toEqual({ usedTokens: 100, totalInputTokens: 0, source: 'anchored' });
  });

  it('não altera a âncora nem as listas recebidas', () => {
    const anchorCopy = { ...anchor };
    const afterCopy = after.map((x) => ({ ...x }));
    contextUsage({ anchor, current, itemsAfterAnchor: after, allItems: all, fixedEstimate: 10_000, k: 1.1 });
    expect(anchor).toEqual(anchorCopy);
    expect(after).toEqual(afterCopy);
  });

  it('propriedade (varredura com semente): inteiros, nunca negativos, e a fonte segue a validade da âncora', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rand = lcg(seed);
      const k = 0.5 + rand() * 1.5;
      const fixedEstimate = Math.floor(rand() * 60_000);
      const history = Array.from({ length: Math.floor(rand() * 12) }, () => item(Math.floor(rand() * 40_000)));
      const newOnes = Array.from({ length: Math.floor(rand() * 5) }, () => item(Math.floor(rand() * 20_000)));
      const candidate: ContextAnchor | null =
        rand() < 0.15
          ? null
          : {
              modelKey: rand() < 0.85 ? MODEL : 'openai:gpt-6',
              historyVersion: rand() < 0.85 ? 3 : 2,
              toolsetHash: rand() < 0.85 ? 'tools-a' : 'tools-z',
              actualInputTokens: Math.floor(rand() * 900_000),
              fixedEstimate: Math.floor(rand() * 60_000),
              historyEstimate: Math.floor(rand() * 800_000),
            };
      const usage = contextUsage({
        anchor: candidate,
        current,
        itemsAfterAnchor: newOnes,
        allItems: [...history, ...newOnes],
        fixedEstimate,
        k,
      });
      expect(Number.isSafeInteger(usage.usedTokens)).toBe(true);
      expect(Number.isSafeInteger(usage.totalInputTokens)).toBe(true);
      expect(usage.usedTokens).toBeGreaterThanOrEqual(0);
      expect(usage.totalInputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.source).toBe(isAnchorValid(candidate, current) ? 'anchored' : 'estimated');
      if (usage.source === 'estimated') {
        // Sem âncora, U + round(k × F) = total, e o total nunca fica abaixo de k × (Σ + F) − 0,5.
        const raw = k * (history.reduce((s, x) => s + x.tokens, 0) + newOnes.reduce((s, x) => s + x.tokens, 0) + fixedEstimate);
        expect(usage.totalInputTokens).toBeGreaterThanOrEqual(raw - 0.5);
        expect(usage.totalInputTokens).toBeLessThanOrEqual(raw + 0.5);
      } else if (candidate !== null) {
        // Com âncora, o usado nunca passa da entrada real mais os itens novos.
        const newRaw = k * newOnes.reduce((s, x) => s + x.tokens, 0);
        expect(usage.usedTokens).toBeLessThanOrEqual(candidate.actualInputTokens + newRaw + 0.5);
      }
    }
  });
});
