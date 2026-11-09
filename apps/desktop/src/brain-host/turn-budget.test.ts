import { describe, expect, it } from 'vitest';
import { MAX_TURN_STEPS, MAX_TURN_TOOL_CALLS, STEP_OUTPUT_MARGIN, TOOL_RESERVE_TOKENS, TOOL_RESULT_OVERHEAD, TurnBudget } from './turn-budget';

const LIMIT = 89_700;

describe('orçamento de um turno com ferramentas', () => {
  it('cada chamada reserva o pior caso; sem espaço para a reserva, a chamada é recusada pelo contexto', () => {
    // Cabem exatamente duas reservas no primeiro passo.
    const start = LIMIT - STEP_OUTPUT_MARGIN - 2 * TOOL_RESERVE_TOKENS;
    const budget = new TurnBudget(LIMIT, start);
    expect(budget.reserve()).toBeNull();
    expect(budget.reserve()).toBeNull();
    expect(budget.reserve()).toBe('context');
    expect(budget.calls).toBe(2);
    // A resposta pequena devolve o espaço da reserva: cabe mais uma no mesmo passo.
    budget.settle(100);
    expect(budget.reserve()).toBe('context');
    budget.settle(0);
    expect(budget.reserve()).toBeNull();
  });

  it('o passo seguinte parte do uso medido mais as respostas, e as reservas zeram', () => {
    const budget = new TurnBudget(LIMIT, 1_000);
    expect(budget.reserve()).toBeNull();
    budget.settle(5_000);
    budget.addResult(10);
    budget.nextStep({ inputTokens: 2_000, outputTokens: 300 });
    expect(budget.estimate).toBe(2_000 + 300 + 5_000 + 10 + 2 * TOOL_RESULT_OVERHEAD);
    expect(budget.toolsAllowed(1)).toBe(true);
  });

  it('uso que não veio, ou inválido, fecha as ferramentas (falha fechada)', () => {
    for (const usage of [
      undefined,
      { inputTokens: undefined, outputTokens: 10 },
      { inputTokens: 100, outputTokens: undefined },
      { inputTokens: 0, outputTokens: 10 },
      { inputTokens: Number.NaN, outputTokens: 10 },
      { inputTokens: -5, outputTokens: 10 },
    ]) {
      const budget = new TurnBudget(LIMIT, 1_000);
      budget.nextStep(usage);
      expect(budget.estimate).toBe(Number.POSITIVE_INFINITY);
      expect(budget.toolsAllowed(1)).toBe(false);
      expect(budget.reserve()).toBe('context');
    }
    expect(new TurnBudget(LIMIT, Number.NaN).toolsAllowed(0)).toBe(false);
  });

  it('o último passo vai sem ferramentas, e o turno para de aceitar chamadas no teto', () => {
    const budget = new TurnBudget(10_000_000, 100);
    expect(budget.toolsAllowed(0)).toBe(true);
    expect(budget.toolsAllowed(MAX_TURN_STEPS - 2)).toBe(true);
    expect(budget.toolsAllowed(MAX_TURN_STEPS - 1)).toBe(false);
    for (let call = 0; call < MAX_TURN_TOOL_CALLS; call++) {
      expect(budget.reserve()).toBeNull();
      budget.settle(1);
    }
    expect(budget.reserve()).toBe('calls');
    expect(budget.toolsAllowed(1)).toBe(false);
  });

  it('perto do limite, o passo vai sem ferramentas', () => {
    const budget = new TurnBudget(LIMIT, 1_000);
    budget.nextStep({ inputTokens: LIMIT - STEP_OUTPUT_MARGIN - TOOL_RESERVE_TOKENS + 1, outputTokens: 0 });
    expect(budget.toolsAllowed(1)).toBe(false);
    budget.nextStep({ inputTokens: LIMIT - STEP_OUTPUT_MARGIN - TOOL_RESERVE_TOKENS, outputTokens: 0 });
    expect(budget.toolsAllowed(2)).toBe(true);
  });
});
