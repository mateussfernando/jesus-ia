import { describe, expect, it } from 'vitest';
import type { PreflightInput } from './preflight';
import { MIN_USEFUL_OUTPUT, preflight } from './preflight';

/** Gerador pseudoaleatório determinístico (LCG de Numerical Recipes), para as propriedades sem fast-check. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Exemplo da especificação: âncora 50.000, delta 1.000, k 1,1, m 0,10, R 32.768, janela 1.000.000. */
function input(extra: Partial<PreflightInput> = {}): PreflightInput {
  return {
    anchorActualInput: 50_000,
    deltaEstimate: 1_000,
    totalEstimate: 48_000,
    k: 1.1,
    m: 0.1,
    outputReserve: 32_768,
    budgetMaxOutput: 32_768,
    minUsefulOutput: MIN_USEFUL_OUTPUT,
    card: { contextWindow: 1_000_000, windowIncludesOutput: true },
    ...extra,
  };
}

describe('checagem antes do envio (seção 4.6)', () => {
  it('exemplo da especificação: 50.000 + ceil(1,21 × 1.000) = 51.210 → send', () => {
    // O produto em ponto flutuante passa de 1.210; o ceil puro daria 1.211.
    expect(1.1 * 1.1 * 1_000).toBeGreaterThan(1_210);
    expect(preflight(input())).toEqual({ kind: 'send', maxOutputTokens: 32_768, inputEstimate: 51_210 });
  });

  it('exemplo da especificação: budgetMaxOutput 500 com mínimo útil 1.024 → block budget', () => {
    expect(preflight(input({ budgetMaxOutput: 500 }))).toEqual({ kind: 'block', reason: 'budget' });
  });

  it('exemplo da especificação: entrada acima de maxInputTokens → needs_context_action', () => {
    const card = { contextWindow: 1_000_000, maxInputTokens: 200_000, windowIncludesOutput: false };
    // 199.000 + 1.210 = 200.210 > 200.000.
    expect(preflight(input({ card, anchorActualInput: 199_000 }))).toEqual({ kind: 'needs_context_action' });
    // No limite exato ainda sai: 198.790 + 1.210 = 200.000.
    expect(preflight(input({ card, anchorActualInput: 198_790 }))).toEqual({
      kind: 'send',
      maxOutputTokens: 32_768,
      inputEstimate: 200_000,
    });
  });

  it('a margem vale só para a parte estimada: sem nada novo, a entrada é a real', () => {
    expect(preflight(input({ deltaEstimate: 0 }))).toEqual({ kind: 'send', maxOutputTokens: 32_768, inputEstimate: 50_000 });
  });

  it('sem âncora: ceil((1 + m) × k × total), também sem o erro de ponto flutuante', () => {
    expect(1.1 * 1.1 * 100_000).toBeGreaterThan(121_000);
    expect(preflight(input({ anchorActualInput: null, totalEstimate: 100_000 }))).toEqual({
      kind: 'send',
      maxOutputTokens: 32_768,
      inputEstimate: 121_000,
    });
    // O delta é ignorado sem âncora.
    expect(preflight(input({ anchorActualInput: null, totalEstimate: 100_000, deltaEstimate: 900_000 }))).toMatchObject({
      inputEstimate: 121_000,
    });
  });

  it('com a saída dentro da janela: entrada + R_call precisa caber em W', () => {
    const card = { contextWindow: 128_000, windowIncludesOutput: true };
    const base = { anchorActualInput: null, k: 1, m: 0, outputReserve: 16_384, budgetMaxOutput: 16_384 };
    expect(preflight(input({ ...base, card, totalEstimate: 111_616 }))).toEqual({
      kind: 'send',
      maxOutputTokens: 16_384,
      inputEstimate: 111_616,
    });
    expect(preflight(input({ ...base, card, totalEstimate: 111_617 }))).toEqual({ kind: 'needs_context_action' });
    // Janela só de entrada: a mesma entrada sai.
    expect(preflight(input({ ...base, card: { ...card, windowIncludesOutput: false }, totalEstimate: 111_617 }))).toEqual({
      kind: 'send',
      maxOutputTokens: 16_384,
      inputEstimate: 111_617,
    });
  });

  it('R_call = min(R, saldo), arredondado para baixo; no mínimo útil exato ainda sai', () => {
    expect(preflight(input({ budgetMaxOutput: 2_000 }))).toMatchObject({ kind: 'send', maxOutputTokens: 2_000 });
    expect(preflight(input({ outputReserve: 8_192.9, budgetMaxOutput: 40_000 }))).toMatchObject({ maxOutputTokens: 8_192 });
    expect(preflight(input({ budgetMaxOutput: 1_024 }))).toMatchObject({ kind: 'send', maxOutputTokens: 1_024 });
    expect(preflight(input({ budgetMaxOutput: 1_023 }))).toEqual({ kind: 'block', reason: 'budget' });
    expect(preflight(input({ budgetMaxOutput: 0, minUsefulOutput: 0 }))).toEqual({ kind: 'block', reason: 'budget' });
  });

  it('resumidor: o mínimo útil é summaryTokens', () => {
    expect(preflight(input({ minUsefulOutput: 4_096, budgetMaxOutput: 3_000 }))).toEqual({ kind: 'block', reason: 'budget' });
    expect(preflight(input({ minUsefulOutput: 4_096, budgetMaxOutput: 4_096 }))).toMatchObject({ kind: 'send' });
  });

  it('saldo insuficiente vem antes do contexto: block budget mesmo com a entrada grande demais', () => {
    expect(preflight(input({ budgetMaxOutput: 500, anchorActualInput: 2_000_000 }))).toEqual({ kind: 'block', reason: 'budget' });
  });

  it('a entrada nunca passa da janela total, mesmo com maxInputTokens maior (cartão incoerente)', () => {
    const card = { contextWindow: 100_000, maxInputTokens: 150_000, windowIncludesOutput: false };
    expect(preflight(input({ card, anchorActualInput: null, k: 1, m: 0, totalEstimate: 120_000 }))).toEqual({
      kind: 'needs_context_action',
    });
  });

  describe('falha fechada: número inválido nunca dá send', () => {
    const bad = [Number.NaN, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    it.each(['outputReserve', 'budgetMaxOutput', 'minUsefulOutput'] as const)('%s inválido → block budget', (field) => {
      for (const value of bad) {
        expect(preflight(input({ [field]: value }))).toEqual({ kind: 'block', reason: 'budget' });
      }
    });

    it.each(['anchorActualInput', 'deltaEstimate', 'totalEstimate', 'k', 'm'] as const)(
      '%s inválido → needs_context_action',
      (field) => {
        for (const value of bad) {
          expect(preflight(input({ [field]: value }))).toEqual({ kind: 'needs_context_action' });
          expect(preflight(input({ anchorActualInput: null, [field]: value })).kind).not.toBe('send');
        }
      },
    );

    it('k zero ou fora de [0,5; 2] → needs_context_action (senão qualquer entrada caberia)', () => {
      for (const k of [0, 1e-9, 0.49, 2.01, 1e9]) {
        expect(preflight(input({ k }))).toEqual({ kind: 'needs_context_action' });
        expect(preflight(input({ anchorActualInput: null, k }))).toEqual({ kind: 'needs_context_action' });
      }
      // Antes, k = 1e-9 fazia 2 milhões de tokens estimados "caberem" numa janela de 128 mil.
      const huge = { anchorActualInput: null, totalEstimate: 2_000_000, k: 1e-9, card: { contextWindow: 128_000, windowIncludesOutput: true } };
      expect(preflight(input(huge))).toEqual({ kind: 'needs_context_action' });
      expect(preflight(input({ k: 0.5 })).kind).toBe('send');
      expect(preflight(input({ k: 2 })).kind).toBe('send');
    });

    it('âncora 0 (ou abaixo de 1) não vale como medida: needs_context_action, nunca send', () => {
      for (const anchorActualInput of [0, 0.4]) {
        const result = preflight(input({ anchorActualInput, deltaEstimate: 1_000, totalEstimate: 2_000_000, card: { contextWindow: 128_000, windowIncludesOutput: true } }));
        expect(result).toEqual({ kind: 'needs_context_action' });
      }
    });

    it('janela inválida → needs_context_action', () => {
      for (const value of [...bad, 0]) {
        expect(preflight(input({ card: { contextWindow: value, windowIncludesOutput: false } }))).toEqual({
          kind: 'needs_context_action',
        });
        expect(
          preflight(input({ card: { contextWindow: 1_000_000, maxInputTokens: value, windowIncludesOutput: false } })),
        ).toEqual({ kind: 'needs_context_action' });
      }
    });
  });

  it('propriedade (varredura com semente): send só se entrada ≤ Win e (saída na janela ⇒ entrada + saída ≤ W)', () => {
    const seen = { send: 0, block: 0, needs_context_action: 0 };
    for (let seed = 1; seed <= 3_000; seed++) {
      const rand = lcg(seed);
      const contextWindow = 4_096 + Math.floor(rand() * 1_996_000);
      const maxInputTokens = rand() < 0.4 ? 1_024 + Math.floor(rand() * contextWindow * 1.2) : undefined;
      const windowIncludesOutput = rand() < 0.5;
      const card =
        maxInputTokens === undefined
          ? { contextWindow, windowIncludesOutput }
          : { contextWindow, maxInputTokens, windowIncludesOutput };
      const k = 0.5 + rand() * 1.5;
      const m = rand() * 0.15;
      const anchorActualInput = rand() < 0.5 ? null : Math.floor(rand() * contextWindow);
      const deltaEstimate = Math.floor(rand() * contextWindow * 0.2);
      const totalEstimate = Math.floor(rand() * contextWindow);
      const outputReserve = 1_024 + Math.floor(rand() * 64_000);
      const budgetMaxOutput = Math.floor(rand() * 70_000);
      const minUsefulOutput = rand() < 0.8 ? MIN_USEFUL_OUTPUT : 2_000 + Math.floor(rand() * 10_000);
      const result = preflight({
        anchorActualInput,
        deltaEstimate,
        totalEstimate,
        k,
        m,
        outputReserve,
        budgetMaxOutput,
        minUsefulOutput,
        card,
      });
      seen[result.kind] += 1;

      // Entrada pela fórmula em números reais (a função pode arredondar para cima, nunca para baixo).
      const exact = anchorActualInput === null ? (1 + m) * k * totalEstimate : anchorActualInput + (1 + m) * k * deltaEstimate;
      const windowIn = maxInputTokens ?? contextWindow;
      if (result.kind === 'send') {
        expect(Number.isSafeInteger(result.inputEstimate)).toBe(true);
        expect(Number.isSafeInteger(result.maxOutputTokens)).toBe(true);
        expect(result.inputEstimate).toBeGreaterThanOrEqual(exact - 1e-6);
        expect(result.inputEstimate).toBeLessThan(exact + 1);
        expect(result.inputEstimate).toBeLessThanOrEqual(windowIn);
        expect(result.inputEstimate).toBeLessThanOrEqual(contextWindow);
        if (windowIncludesOutput) expect(result.inputEstimate + result.maxOutputTokens).toBeLessThanOrEqual(contextWindow);
        expect(result.maxOutputTokens).toBe(Math.min(outputReserve, budgetMaxOutput));
        expect(result.maxOutputTokens).toBeGreaterThanOrEqual(minUsefulOutput);
      } else if (result.kind === 'block') {
        expect(Math.min(outputReserve, budgetMaxOutput)).toBeLessThan(minUsefulOutput);
      } else {
        const rCall = Math.min(outputReserve, budgetMaxOutput);
        const needed = Math.ceil(exact);
        const fitsExact =
          needed <= Math.min(windowIn, contextWindow) && (!windowIncludesOutput || needed + rCall <= contextWindow);
        expect(rCall).toBeGreaterThanOrEqual(minUsefulOutput);
        // Só recusa o que de fato não cabe (o ceil tolerante pode economizar 1 token, nunca negar um envio que cabe).
        expect(fitsExact && Math.ceil(exact - 1e-6) === Math.ceil(exact)).toBe(false);
      }
    }
    // A varredura cobre os três resultados.
    expect(seen.send).toBeGreaterThan(100);
    expect(seen.block).toBeGreaterThan(100);
    expect(seen.needs_context_action).toBeGreaterThan(100);
  });
});
