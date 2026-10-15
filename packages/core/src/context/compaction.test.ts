import { getModelCard } from '@jesus/models';
import type { ModelCard } from '@jesus/models';
import { describe, expect, it } from 'vitest';
import { computeContextBudget } from './budget';
import type { ContextBudgetInput } from './budget';
import {
  decideContextAction,
  discardSpeculativeSummary,
  initialCompactionState,
  onBudgetChange,
  onCompactionResult,
  onNewTask,
  onSpeculativeSummaryReady,
  onToolResultsCleared,
  opportunisticCompactionWorthIt,
  planBudgetChange,
} from './compaction';
import type { CompactionState, ContextObservation } from './compaction';
import { describeCompactionState } from './describe';
import { deriveThresholds } from './thresholds';

const LIMIT = 252_144;
const FIXED = 10_000;
const INPUT_MAX = 879_301;
const thresholds = deriveThresholds({ limit: LIMIT, inputMax: INPUT_MAX, fixedTokens: FIXED });

/** Uso em fração de L, arredondado para cima (para cair do lado certo do limiar). */
function at(ratio: number): number {
  return Math.ceil(ratio * LIMIT);
}

function observe(extra: Partial<ContextObservation> = {}): ContextObservation {
  return {
    usedTokens: at(0.3),
    fixedTokens: FIXED,
    limit: LIMIT,
    inputMax: INPUT_MAX,
    step: 10,
    thresholds,
    largestTailItem: null,
    clearPlanFreed: 0,
    summarizerAffordable: true,
    costBand: 0,
    presence: 'present',
    midToolRound: false,
    newestOversizedResult: null,
    opportunisticWorthIt: false,
    explicitRequest: null,
    userCommand: 'none',
    speculativeValid: false,
    ...extra,
  };
}

const armed = initialCompactionState();
const cooldown: CompactionState = { ...armed, phase: 'cooldown', lastCompactionStep: 9 };
const tripped: CompactionState = { ...armed, phase: 'tripped', trippedReason: 'refill' };

describe('limpeza com marca d\'água (nível 1)', () => {
  it('limpa a partir de 60% de L; depois só com 10% de L de crescimento', () => {
    const plenty = thresholds.clearAtLeast;
    expect(decideContextAction(armed, observe({ usedTokens: Math.floor(0.5999 * LIMIT), clearPlanFreed: plenty })).action).toEqual({ type: 'none' });
    expect(decideContextAction(armed, observe({ usedTokens: at(0.605), clearPlanFreed: plenty })).action).toEqual({ type: 'clear_tool_results' });

    const afterClear = Math.round(0.52 * LIMIT);
    const state = onToolResultsCleared(armed, afterClear);
    expect(decideContextAction(state, observe({ usedTokens: Math.round(0.61 * LIMIT), clearPlanFreed: plenty })).action).toEqual({ type: 'none' });
    expect(
      decideContextAction(state, observe({ usedTokens: afterClear + Math.ceil(LIMIT / 10), clearPlanFreed: plenty })).action,
    ).toEqual({ type: 'clear_tool_results' });
  });

  it('não limpa se o plano libera menos que clearAtLeast', () => {
    const decision = decideContextAction(armed, observe({ usedTokens: at(0.65), clearPlanFreed: thresholds.clearAtLeast - 1 }));
    expect(decision.action).toEqual({ type: 'none' });
  });
});

describe('compactação automática (nível 2)', () => {
  it('em 86%: resumo por IA se couber no orçamento; senão, determinística', () => {
    const decision = decideContextAction(armed, observe({ usedTokens: at(0.86) }));
    expect(decision.action).toEqual({ type: 'compact', strategy: 'llm', trigger: 'auto' });
    expect(decision.next.phase).toBe('compacting');
    expect(decideContextAction(armed, observe({ usedTokens: at(0.86), summarizerAffordable: false })).action).toEqual({
      type: 'compact',
      strategy: 'deterministic',
      trigger: 'auto',
    });
    expect(decideContextAction({ ...armed, deterministicOnly: true }, observe({ usedTokens: at(0.86) })).action).toMatchObject({
      strategy: 'deterministic',
    });
    expect(decideContextAction(armed, observe({ usedTokens: at(0.86), summarizerFits: false })).action).toMatchObject({
      strategy: 'hierarchical',
    });
    expect(decideContextAction(armed, observe({ usedTokens: at(0.86), summarizerLocal: true })).action).toMatchObject({
      strategy: 'deterministic',
    });
  });

  it('usa o resumo antecipado quando está pronto e ainda vale', () => {
    const ready = onSpeculativeSummaryReady({ ...armed, speculative: { status: 'running', coversThroughSeq: null } }, 120);
    expect(ready.speculative).toEqual({ status: 'ready', coversThroughSeq: 120 });
    const decision = decideContextAction(ready, observe({ usedTokens: at(0.86), speculativeValid: true }));
    expect(decision.action).toEqual({ type: 'apply_speculative_summary' });
    expect(decision.next.phase).toBe('compacting');
    expect(decideContextAction(ready, observe({ usedTokens: at(0.86), speculativeValid: false })).action).toMatchObject({ type: 'compact' });
  });

  it('em 76%: começa o resumo antecipado, depois avisa uma vez, depois nada', () => {
    const first = decideContextAction(armed, observe({ usedTokens: at(0.76) }));
    expect(first.action).toEqual({ type: 'start_speculative_summary' });
    const second = decideContextAction(first.next, observe({ usedTokens: at(0.76) }));
    expect(second.action).toEqual({ type: 'notify_memory_pressure' });
    expect(decideContextAction(second.next, observe({ usedTokens: at(0.76) })).action).toEqual({ type: 'none' });
  });

  it('com gasto apertado (banda 2) não começa o resumo antecipado', () => {
    expect(decideContextAction(armed, observe({ usedTokens: at(0.76), costBand: 2 })).action).toEqual({ type: 'notify_memory_pressure' });
  });

  it('abaixo de L = 32.768 resume sem IA (determinística)', () => {
    const small = deriveThresholds({ limit: 20_000, inputMax: 30_000, fixedTokens: FIXED });
    const decision = decideContextAction(armed, observe({ limit: 20_000, inputMax: 30_000, thresholds: small, usedTokens: 19_000 }));
    expect(decision.action).toMatchObject({ type: 'compact', strategy: 'deterministic' });
  });
});

describe('disjuntor (reenchimento, laço e falhas)', () => {
  it('no resfriamento: despeja o item grande; senão compacta uma vez; na segunda, trava e pergunta', () => {
    const big = { ref: 'call_big', tokens: thresholds.toolResultCap + 1 };
    expect(decideContextAction(cooldown, observe({ usedTokens: at(0.86), largestTailItem: big })).action).toEqual({
      type: 'evict_oversized',
      ref: 'call_big',
    });

    const refill = decideContextAction(cooldown, observe({ usedTokens: at(0.86) }));
    expect(refill.action).toEqual({ type: 'compact', strategy: 'llm', trigger: 'refill' });
    expect(refill.next.consecutiveRefills).toBe(1);

    const afterRefill = onCompactionResult(refill.next, { ok: true, strategy: 'llm', beforeTokens: at(0.86), afterTokens: at(0.27), limit: LIMIT, step: 10 });
    expect(afterRefill.phase).toBe('cooldown');
    const second = decideContextAction(afterRefill, observe({ usedTokens: at(0.86), step: 11 }));
    expect(second.action).toEqual({ type: 'block_and_ask', reason: 'loop_guard' });
    expect(second.next).toMatchObject({ phase: 'tripped', trippedReason: 'refill' });

    const absent = decideContextAction(afterRefill, observe({ usedTokens: at(0.86), step: 11, presence: 'absent' }));
    expect(absent.action).toEqual({ type: 'stop_and_report', reason: 'loop_guard' });
  });

  it('o resfriamento acaba depois de 3 passos e zera os reenchimentos', () => {
    const state: CompactionState = { ...cooldown, consecutiveRefills: 1 };
    const decision = decideContextAction(state, observe({ step: 12 }));
    expect(decision.next).toMatchObject({ phase: 'armed', consecutiveRefills: 0 });
    expect(decideContextAction(state, observe({ step: 11 })).next.phase).toBe('cooldown');
  });

  it('travado: só o usuário destrava ("continuar"); trocar de modelo não destrava', () => {
    expect(decideContextAction(tripped, observe({ usedTokens: at(0.86) })).action).toEqual({ type: 'block_and_ask', reason: 'loop_guard' });
    expect(decideContextAction(tripped, observe({ usedTokens: at(0.5) })).action).toEqual({ type: 'none' });
    expect(onBudgetChange(tripped).phase).toBe('tripped');

    const unlocked = decideContextAction({ ...tripped, consecutiveRefills: 1, recentCompactionSteps: [1, 2, 3] }, observe({ userCommand: 'continue' }));
    expect(unlocked.next).toMatchObject({ phase: 'armed', trippedReason: null, consecutiveRefills: 0, recentCompactionSteps: [] });
    // Destravado, segue a decisão normal no mesmo passo.
    expect(decideContextAction(tripped, observe({ userCommand: 'continue', usedTokens: at(0.86) })).action).toMatchObject({
      type: 'compact',
      trigger: 'auto',
    });
  });

  it('"pare" cancela a compactação sem aplicar nada; nova sessão zera tudo', () => {
    const compacting: CompactionState = { ...armed, phase: 'compacting' };
    const stop = decideContextAction(compacting, observe({ userCommand: 'stop' }));
    expect(stop.action).toEqual({ type: 'cancel_compaction' });
    expect(stop.next.phase).toBe('armed');
    expect(decideContextAction(compacting, observe({ usedTokens: at(0.95) })).action).toEqual({ type: 'none' });

    const running: CompactionState = { ...armed, speculative: { status: 'running', coversThroughSeq: null } };
    expect(decideContextAction(running, observe({ userCommand: 'stop' })).next.speculative.status).toBe('none');

    const fresh = decideContextAction({ ...tripped, deterministicOnly: true, compactionsThisTask: 9 }, observe({ userCommand: 'new_session' }));
    expect(fresh.next).toEqual(initialCompactionState());
  });

  it('resultado da compactação: eficaz, ineficaz, laço e falhas', () => {
    const compacting: CompactionState = { ...armed, phase: 'compacting' };
    const result = (extra: Partial<Parameters<typeof onCompactionResult>[1]>) =>
      onCompactionResult(compacting, { ok: true, strategy: 'llm', beforeTokens: at(0.86), afterTokens: at(0.27), limit: LIMIT, step: 20, ...extra });

    expect(result({})).toMatchObject({ phase: 'cooldown', compactionsThisTask: 1, lastCompactionStep: 20, recentCompactionSteps: [20] });
    expect(result({ afterTokens: at(0.65) })).toMatchObject({ phase: 'armed', forceDeterministic: true });
    expect(result({ afterTokens: at(0.65), strategy: 'deterministic' })).toMatchObject({ phase: 'tripped', trippedReason: 'ineffective' });

    const loop = onCompactionResult(
      { ...compacting, recentCompactionSteps: [10, 15] },
      { ok: true, strategy: 'llm', beforeTokens: at(0.86), afterTokens: at(0.27), limit: LIMIT, step: 20 },
    );
    expect(loop).toMatchObject({ phase: 'tripped', trippedReason: 'loop' });
    const tooMany = onCompactionResult(
      { ...compacting, compactionsThisTask: 10 },
      { ok: true, strategy: 'llm', beforeTokens: at(0.86), afterTokens: at(0.27), limit: LIMIT, step: 20 },
    );
    expect(tooMany).toMatchObject({ phase: 'tripped', trippedReason: 'loop' });

    expect(onCompactionResult(compacting, { ok: false, strategy: 'deterministic', beforeTokens: 0, afterTokens: 0, limit: LIMIT, step: 20 })).toMatchObject({
      phase: 'tripped',
      trippedReason: 'failures',
    });
  });

  it('a primeira falha do resumo por IA não trava: tenta a determinística no mesmo ciclo; 3 seguidas fixam a determinística', () => {
    let state: CompactionState = { ...armed, phase: 'compacting' };
    const fail = { ok: false, strategy: 'llm' as const, beforeTokens: 0, afterTokens: 0, limit: LIMIT, step: 20 };
    state = onCompactionResult(state, fail);
    expect(state).toMatchObject({ phase: 'armed', forceDeterministic: true, consecutiveLlmFailures: 1, deterministicOnly: false });
    expect(decideContextAction(state, observe({ usedTokens: at(0.86) })).action).toEqual({
      type: 'compact',
      strategy: 'deterministic',
      trigger: 'auto',
    });
    state = onCompactionResult(onCompactionResult({ ...state, phase: 'compacting' }, fail), fail);
    expect(state).toMatchObject({ consecutiveLlmFailures: 3, deterministicOnly: true });
  });

  it('compactação eficaz reabre o aviso e o pedido do ciclo e zera a marca d\'água', () => {
    const state: CompactionState = {
      ...armed,
      phase: 'compacting',
      warnedThisCycle: true,
      modelRequestUsedThisCycle: true,
      lastClearAfterTokens: 1_000,
      forceDeterministic: true,
      consecutiveLlmFailures: 2,
    };
    const next = onCompactionResult(state, { ok: true, strategy: 'llm', beforeTokens: at(0.86), afterTokens: at(0.27), limit: LIMIT, step: 30 });
    expect(next).toMatchObject({
      warnedThisCycle: false,
      modelRequestUsedThisCycle: false,
      lastClearAfterTokens: null,
      forceDeterministic: false,
      consecutiveLlmFailures: 0,
    });
  });
});

describe('limite técnico e rodada de ferramentas aberta', () => {
  const full = INPUT_MAX - FIXED;

  it('com rodada aberta não edita o histórico: despeja o resultado novo grande ou para e pergunta', () => {
    const oversized = { ref: 'call_new', tokens: 30_000 };
    expect(decideContextAction(armed, observe({ usedTokens: full, midToolRound: true, newestOversizedResult: oversized })).action).toEqual({
      type: 'evict_oversized',
      ref: 'call_new',
    });
    expect(decideContextAction(armed, observe({ usedTokens: full, midToolRound: true })).action).toEqual({ type: 'block_and_ask', reason: 'hard_limit' });
    expect(decideContextAction(armed, observe({ usedTokens: full, midToolRound: true, presence: 'absent' })).action).toEqual({
      type: 'stop_and_report',
      reason: 'hard_limit',
    });
    expect(decideContextAction(armed, observe({ usedTokens: at(0.9), midToolRound: true })).action).toEqual({ type: 'none' });
  });

  it('fora da rodada: compacta (gatilho "hard"); travado, para e pergunta', () => {
    expect(decideContextAction(armed, observe({ usedTokens: full })).action).toEqual({ type: 'compact', strategy: 'llm', trigger: 'hard' });
    expect(decideContextAction(tripped, observe({ usedTokens: full })).action).toEqual({ type: 'block_and_ask', reason: 'hard_limit' });
  });
});

describe('pedidos explícitos e compactação oportunista', () => {
  it('pedido do modelo: aceito acima de 60% e uma vez por ciclo; pedido do usuário vale até em 20%', () => {
    const request = { by: 'model' as const, focus: 'orçamento' };
    const accepted = decideContextAction(armed, observe({ usedTokens: at(0.65), explicitRequest: request }));
    expect(accepted.action).toEqual({ type: 'compact', strategy: 'llm', trigger: 'requested' });
    expect(accepted.next.modelRequestUsedThisCycle).toBe(true);

    const afterFailure = onCompactionResult(accepted.next, { ok: false, strategy: 'llm', beforeTokens: 0, afterTokens: 0, limit: LIMIT, step: 10 });
    expect(decideContextAction(afterFailure, observe({ usedTokens: at(0.65), explicitRequest: request })).action).toEqual({ type: 'none' });
    expect(decideContextAction(armed, observe({ usedTokens: at(0.5), explicitRequest: request })).action).toEqual({ type: 'none' });

    expect(decideContextAction(armed, observe({ usedTokens: at(0.2), explicitRequest: { by: 'user', focus: null } })).action).toEqual({
      type: 'compact',
      strategy: 'llm',
      trigger: 'requested',
    });
  });

  it('com o cache frio, compacta a partir do aviso e limpa sem esperar a marca d\'água', () => {
    expect(decideContextAction(armed, observe({ usedTokens: at(0.76), opportunisticWorthIt: true })).action).toEqual({
      type: 'compact',
      strategy: 'llm',
      trigger: 'opportunistic',
    });
    const justCleared = onToolResultsCleared(armed, at(0.6));
    expect(
      decideContextAction(justCleared, observe({ usedTokens: at(0.62), opportunisticWorthIt: true, clearPlanFreed: thresholds.clearAtLeast })).action,
    ).toEqual({ type: 'clear_tool_results' });
  });

  it('vale a pena? cache já expirado, ou 10 min parado com gasto folgado e invalidação barata', () => {
    // US$ 0,14/M sem cache e 0,0028/M lido do cache: 210 mil tokens custam US$ 0,0288 para recarregar (< 1% de US$ 5).
    const base = {
      idleMs: 11 * 60_000,
      usedTokens: 200_000,
      fixedTokens: 10_000,
      pUncachedPUsdPerToken: 140_000,
      pCacheReadPUsdPerToken: 2_800,
      dailyLimitPUsd: 5e12,
      costBand: 0 as const,
    };
    expect(opportunisticCompactionWorthIt(base)).toBe(true);
    expect(opportunisticCompactionWorthIt({ ...base, costBand: 1 })).toBe(false);
    expect(opportunisticCompactionWorthIt({ ...base, idleMs: 9 * 60_000 })).toBe(false);
    expect(opportunisticCompactionWorthIt({ ...base, dailyLimitPUsd: 2e12 })).toBe(false);
    // Anthropic: o cache dura 5 minutos.
    expect(opportunisticCompactionWorthIt({ ...base, cacheTtlMs: 5 * 60_000, idleMs: 6 * 60_000, costBand: 2 })).toBe(true);
    expect(opportunisticCompactionWorthIt({ ...base, cacheTtlMs: 5 * 60_000, idleMs: 4 * 60_000 })).toBe(false);
  });
});

describe('troca de modelo no meio da sessão (seção 5.10)', () => {
  function card(key: string): ModelCard {
    const found = getModelCard(key);
    if (found === null) throw new Error(key);
    return found;
  }
  const budget = (key: string, extra: Partial<ContextBudgetInput> = {}) =>
    computeContextBudget({ card: card(key), fixedTokens: FIXED, spend: { dailyLimitUsd: 5, spentTodayUsd: 0 }, ...extra });
  const haikuMax = budget('anthropic:claude-haiku-5-5', { mode: 'max' });
  const opus = budget('anthropic:claude-opus-5-5');
  const unknown = budget('openai:modelo-desconhecido');
  const plan = (usedTokens: number, oldBudget: typeof opus, newBudget: typeof opus, extra: { oldModelAvailable?: boolean; newModelIsLocalOrSmall?: boolean } = {}) =>
    planBudgetChange({
      usedTokens,
      oldBudget,
      newBudget,
      oldModelAvailable: extra.oldModelAvailable ?? true,
      newModelIsLocalOrSmall: extra.newModelIsLocalOrSmall ?? false,
      newUncachedPUsdPerToken: 5_000_000,
    });

  it('não cabe no novo: compacta com o modelo antigo antes de trocar (alvo de 30% do novo L)', () => {
    expect(opus.limit).toBe(63_705);
    const p = plan(200_000, haikuMax, opus);
    expect(p).toMatchObject({ steps: ['compact_with_old'], switchAfter: true, targetTokens: 19_111 });
    // A primeira chamada ao novo modelo leva só o resultado da compactação.
    expect(p.estimatedSwitchCostPUsd).toBe((19_111 + FIXED) * 5_000_000);
  });

  it('sem o modelo antigo: compacta com o novo, ou de forma hierárquica se nem couber nele', () => {
    expect(plan(200_000, haikuMax, opus, { oldModelAvailable: false }).steps).toEqual(['compact_with_new']);
    expect(plan(30_000, opus, unknown, { oldModelAvailable: false }).steps).toEqual(['compact_hierarchical_with_new']);
    expect(plan(30_000, opus, unknown, { oldModelAvailable: false, newModelIsLocalOrSmall: true }).steps).toEqual(['compact_deterministic']);
  });

  it('entre 60% e 85% do novo L só limpa (o cache se perde na troca de qualquer jeito)', () => {
    expect(plan(50_000, haikuMax, opus)).toMatchObject({ steps: ['clear_tool_results'], switchAfter: false, targetTokens: 28_667 });
  });

  it('para uma janela maior, nada é desfeito; o estado zera as marcas d\'água e mantém o disjuntor', () => {
    expect(plan(40_000, opus, haikuMax)).toMatchObject({ steps: [], targetTokens: null });
    const state: CompactionState = {
      ...armed,
      lastClearAfterTokens: 30_000,
      recentCompactionSteps: [4, 9],
      speculative: { status: 'ready', coversThroughSeq: 50 },
    };
    expect(onBudgetChange(state)).toMatchObject({ lastClearAfterTokens: null, recentCompactionSteps: [4, 9], speculative: { status: 'none' } });
  });
});

describe('estado auxiliar e texto', () => {
  it('resumo antecipado: pronto só se ainda estiver em curso; descartar volta a "none"', () => {
    expect(onSpeculativeSummaryReady(armed, 10)).toBe(armed);
    const running: CompactionState = { ...armed, speculative: { status: 'running', coversThroughSeq: null } };
    expect(discardSpeculativeSummary(running).speculative.status).toBe('none');
    expect(discardSpeculativeSummary(armed)).toBe(armed);
  });

  it('nova tarefa zera só a contagem da tarefa', () => {
    expect(onNewTask({ ...tripped, compactionsThisTask: 7 })).toMatchObject({ phase: 'tripped', compactionsThisTask: 0 });
  });

  it('descreve o estado em pt-BR', () => {
    expect(describeCompactionState(armed)).toBe('Compactação automática ligada.');
    expect(describeCompactionState(tripped)).toContain('travada (disjuntor)');
    expect(describeCompactionState(tripped)).toContain('encheu de novo');
  });
});
