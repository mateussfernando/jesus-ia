import type { ContextBudget, PressureBand } from './budget';
import type { Thresholds } from './thresholds';
import { bpToTokens, FULL_BP, usageBp } from './thresholds';

/**
 * Compactação automática (docs/rascunhos/algoritmo-contexto.md, seções 5.7 a 5.10): decide, a cada passo, se
 * limpa saídas antigas, avisa, começa um resumo antecipado, compacta ou para e pergunta. O disjuntor impede
 * laços (encher, compactar, encher de novo). Lógica pura: o orquestrador observa, chama `decideContextAction`
 * em laço (até 'none' ou uma ação que bloqueia, no máximo 4 vezes) e informa os resultados.
 * Nada aqui mexe na contaminação, na origem dos valores ou nas aprovações pendentes.
 */

/** 'present': há alguém para perguntar. 'absent' (rotina agendada): para e registra, sem perguntar. */
export type Presence = 'present' | 'absent';
export type CompactionPhase = 'armed' | 'compacting' | 'cooldown' | 'tripped';
export type TripReason = 'refill' | 'ineffective' | 'loop' | 'failures';
export type CompactionStrategy = 'llm' | 'deterministic' | 'hierarchical';
export type CompactionTrigger = 'auto' | 'hard' | 'refill' | 'requested' | 'opportunistic';
export type BlockReason = 'hard_limit' | 'loop_guard';
export type UserContextCommand = 'none' | 'stop' | 'continue' | 'new_session';

export interface SpeculativeSummaryState {
  status: 'none' | 'running' | 'ready';
  /** Último item coberto pelo resumo antecipado. */
  coversThroughSeq: number | null;
}

export interface CompactionState {
  phase: CompactionPhase;
  trippedReason: TripReason | null;
  /** Marca d'água da limpeza: uso (tokens) logo depois da última limpeza. Zera quando L muda. */
  lastClearAfterTokens: number | null;
  lastCompactionStep: number | null;
  /** Passos das compactações recentes (até 8), para o disjuntor de laço. */
  recentCompactionSteps: readonly number[];
  compactionsThisTask: number;
  consecutiveRefills: number;
  consecutiveLlmFailures: number;
  /** Depois de 3 falhas seguidas do resumo por LLM, a sessão só compacta de forma determinística. */
  deterministicOnly: boolean;
  /** Só neste ciclo: o resumo por LLM falhou ou não liberou espaço. */
  forceDeterministic: boolean;
  warnedThisCycle: boolean;
  modelRequestUsedThisCycle: boolean;
  speculative: SpeculativeSummaryState;
}

export interface ContextObservation {
  /** Histórico em uso (sem a parte fixa), em tokens. */
  usedTokens: number;
  fixedTokens: number;
  /** Limite efetivo L. */
  limit: number;
  /** Teto técnico de entrada (inclui a parte fixa). */
  inputMax: number;
  /** Passo atual (chamadas ao modelo nesta sessão). */
  step: number;
  thresholds: Thresholds;
  /** Maior item da cauda que pode virar marcador. */
  largestTailItem: { ref: string; tokens: number } | null;
  /** Tokens que `selectToolResultsToClear` liberaria agora. */
  clearPlanFreed: number;
  /** O resumidor cabe no orçamento (simulação da reserva de gasto). */
  summarizerAffordable: boolean;
  /** O histórico cabe no resumidor de uma vez (senão, resumo hierárquico). Padrão: sim. */
  summarizerFits?: boolean;
  /** O resumidor é um modelo local (fraco para resumir: usa a compactação determinística). Padrão: não. */
  summarizerLocal?: boolean;
  costBand: PressureBand;
  presence: Presence;
  /** Há chamada de ferramenta sem resultado: não dá para editar o histórico agora. */
  midToolRound: boolean;
  /** O resultado mais novo, se passou do teto por resultado. */
  newestOversizedResult: { ref: string; tokens: number } | null;
  /** De `opportunisticCompactionWorthIt`. */
  opportunisticWorthIt: boolean;
  explicitRequest: { by: 'user' | 'model'; focus: string | null } | null;
  userCommand: UserContextCommand;
  /** De `speculativeStillValid`. */
  speculativeValid: boolean;
}

export type ContextAction =
  | { type: 'none' }
  | { type: 'clear_tool_results' }
  | { type: 'compact'; strategy: CompactionStrategy; trigger: CompactionTrigger }
  | { type: 'start_speculative_summary' }
  | { type: 'apply_speculative_summary' }
  | { type: 'evict_oversized'; ref: string }
  | { type: 'notify_memory_pressure' }
  | { type: 'cancel_compaction' }
  | { type: 'block_and_ask'; reason: BlockReason }
  | { type: 'stop_and_report'; reason: BlockReason };

export interface ContextDecision {
  action: ContextAction;
  next: CompactionState;
}

/** Passos de resfriamento depois de uma compactação que deu certo. */
export const COOLDOWN_STEPS = 3;
/** Disjuntor de laço: 3 compactações dentro de 12 passos, ou mais de 10 na mesma tarefa. */
export const LOOP_WINDOW_STEPS = 12;
export const LOOP_MAX_IN_WINDOW = 3;
export const MAX_COMPACTIONS_PER_TASK = 10;
export const MAX_RECENT_COMPACTION_STEPS = 8;
/** Falhas seguidas do resumo por LLM até a sessão ficar só na compactação determinística. */
export const LLM_FAILURES_TO_DETERMINISTIC = 3;
/** Compactação eficaz: depois dela, o uso fica em até 60% de L. */
export const EFFECTIVE_AFTER_BP = 6_000;
/** Abaixo deste L, resumir com LLM não compensa: usa a compactação determinística. */
export const DETERMINISTIC_BELOW_LIMIT = 32_768;
/** Uma nova limpeza só depois de o uso crescer 10% de L desde a última. */
export const CLEAR_REARM_BP = 1_000;
/** Alvo da compactação feita por troca de modelo. */
export const SWITCH_TARGET_BP = 3_000;

const NO_SPECULATIVE: SpeculativeSummaryState = { status: 'none', coversThroughSeq: null };

export function initialCompactionState(): CompactionState {
  return {
    phase: 'armed',
    trippedReason: null,
    lastClearAfterTokens: null,
    lastCompactionStep: null,
    recentCompactionSteps: [],
    compactionsThisTask: 0,
    consecutiveRefills: 0,
    consecutiveLlmFailures: 0,
    deterministicOnly: false,
    forceDeterministic: false,
    warnedThisCycle: false,
    modelRequestUsedThisCycle: false,
    speculative: NO_SPECULATIVE,
  };
}

function chooseStrategy(state: CompactionState, obs: ContextObservation): CompactionStrategy {
  const llm =
    obs.summarizerAffordable &&
    !state.deterministicOnly &&
    !state.forceDeterministic &&
    obs.summarizerLocal !== true &&
    obs.limit >= DETERMINISTIC_BELOW_LIMIT;
  if (!llm) return 'deterministic';
  return obs.summarizerFits === false ? 'hierarchical' : 'llm';
}

/**
 * Decide a próxima ação de contexto. Ordem (seção 5.8): comando do usuário; compactação em curso; rodada de
 * ferramentas aberta; limite técnico; disjuntor; reenchimento no resfriamento; compactação automática; pedido
 * explícito; oportunista; limpeza; resumo antecipado; aviso de pressão; nada.
 */
export function decideContextAction(state: CompactionState, obs: ContextObservation): ContextDecision {
  let s = state;

  // 0. Comandos do usuário. "Pare" cancela a compactação ou o resumo antecipado sem aplicar nada.
  if (obs.userCommand === 'stop' && (s.phase === 'compacting' || s.speculative.status !== 'none')) {
    return {
      action: { type: 'cancel_compaction' },
      next: { ...s, phase: s.phase === 'compacting' ? 'armed' : s.phase, speculative: NO_SPECULATIVE },
    };
  }
  if (obs.userCommand === 'new_session') {
    const fresh = initialCompactionState();
    if (s.phase === 'compacting' || s.speculative.status !== 'none') {
      return { action: { type: 'cancel_compaction' }, next: fresh };
    }
    s = fresh;
  } else if (obs.userCommand === 'continue' && s.phase === 'tripped') {
    // Só o usuário destrava; trocar de modelo ou reiniciar o app não destrava.
    s = { ...s, phase: 'armed', trippedReason: null, consecutiveRefills: 0, recentCompactionSteps: [] };
  }

  // Fim do resfriamento.
  if (s.phase === 'cooldown' && (s.lastCompactionStep === null || obs.step - s.lastCompactionStep >= COOLDOWN_STEPS)) {
    s = { ...s, phase: 'armed', consecutiveRefills: 0 };
  }

  const t = obs.thresholds;
  const u = usageBp(obs.usedTokens, obs.limit);
  const atTechnicalLimit = obs.usedTokens + obs.fixedTokens >= obs.inputMax;
  const strategy = chooseStrategy(s, obs);
  const stay = (action: ContextAction): ContextDecision => ({ action, next: s });
  const block = (reason: BlockReason): ContextAction =>
    obs.presence === 'present' ? { type: 'block_and_ask', reason } : { type: 'stop_and_report', reason };
  const compact = (trigger: CompactionTrigger, chosen: CompactionStrategy = strategy, extra: Partial<CompactionState> = {}) => ({
    action: { type: 'compact', strategy: chosen, trigger } as const,
    next: { ...s, ...extra, phase: 'compacting' as const },
  });
  const oversizedTail =
    obs.largestTailItem !== null && obs.largestTailItem.tokens > t.toolResultCap ? obs.largestTailItem : null;

  // 1. Compactação em curso: pedidos do usuário vão para a fila.
  if (s.phase === 'compacting') return stay({ type: 'none' });

  // 2. Rodada de ferramentas aberta: o histórico não pode ser editado.
  if (obs.midToolRound) {
    if (!atTechnicalLimit) return stay({ type: 'none' });
    return stay(
      obs.newestOversizedResult !== null
        ? { type: 'evict_oversized', ref: obs.newestOversizedResult.ref }
        : block('hard_limit'),
    );
  }

  // 3. No limite técnico, nada é enviado antes de abrir espaço.
  if (atTechnicalLimit) {
    if (s.phase === 'tripped') return stay(block('hard_limit'));
    if (oversizedTail !== null) return stay({ type: 'evict_oversized', ref: oversizedTail.ref });
    return compact('hard');
  }

  // 4. Disjuntor aberto: só o usuário destrava.
  if (s.phase === 'tripped') return stay(u >= t.compactBp ? block('loop_guard') : { type: 'none' });

  // 5. Encheu de novo logo depois de compactar: despeja o item grande ou compacta uma vez; na segunda, trava.
  if (s.phase === 'cooldown' && u >= t.compactBp) {
    if (oversizedTail !== null) return stay({ type: 'evict_oversized', ref: oversizedTail.ref });
    if (s.consecutiveRefills >= 1) {
      return { action: block('loop_guard'), next: { ...s, phase: 'tripped', trippedReason: 'refill' } };
    }
    return compact('refill', strategy, { consecutiveRefills: s.consecutiveRefills + 1 });
  }

  // 6. Compactação automática (usa o resumo antecipado, se estiver pronto e válido).
  if (s.phase === 'armed' && u >= t.compactBp) {
    if (s.speculative.status === 'ready' && obs.speculativeValid) {
      return { action: { type: 'apply_speculative_summary' }, next: { ...s, phase: 'compacting' } };
    }
    return compact('auto');
  }

  // 7. Pedido explícito. Do usuário, vale em qualquer fase que chegou aqui; do modelo, só armado, acima da
  //    limpeza e uma vez por ciclo.
  if (obs.explicitRequest !== null) {
    if (obs.explicitRequest.by === 'user') return compact('requested');
    if (s.phase === 'armed' && u >= t.microBp && !s.modelRequestUsedThisCycle) {
      return compact('requested', strategy, { modelRequestUsedThisCycle: true });
    }
  }

  // 8. Oportunista: o cache já esfriou (ou invalidar sai barato), então limpar ou compactar agora sai quase de graça.
  //    Sem cache a poupar, a limpeza não espera a marca d'água.
  if (s.phase === 'armed' && obs.opportunisticWorthIt) {
    if (u >= t.warnBp && strategy !== 'hierarchical') return compact('opportunistic');
    if (u >= t.microBp && obs.clearPlanFreed >= t.clearAtLeast) return stay({ type: 'clear_tool_results' });
  }

  // 9. Limpeza em lotes: acima de micro, com 10% de L de crescimento desde a última e um plano que vale a pena.
  const clearRearmed =
    s.lastClearAfterTokens === null || (obs.usedTokens - s.lastClearAfterTokens) * FULL_BP >= CLEAR_REARM_BP * obs.limit;
  if (u >= t.microBp && clearRearmed && obs.clearPlanFreed >= t.clearAtLeast) return stay({ type: 'clear_tool_results' });

  // 10. Resumo antecipado em segundo plano: a compactação não trava a voz depois.
  if (
    u >= t.warnBp &&
    s.phase === 'armed' &&
    s.speculative.status === 'none' &&
    obs.costBand < 2 &&
    obs.summarizerAffordable &&
    strategy === 'llm'
  ) {
    return {
      action: { type: 'start_speculative_summary' },
      next: { ...s, speculative: { status: 'running', coversThroughSeq: null } },
    };
  }

  // 11. Aviso de pressão de memória, uma vez por ciclo.
  if (u >= t.warnBp && !s.warnedThisCycle) {
    return { action: { type: 'notify_memory_pressure' }, next: { ...s, warnedThisCycle: true } };
  }

  return stay({ type: 'none' });
}

export interface CompactionResult {
  ok: boolean;
  strategy: CompactionStrategy | 'speculative';
  beforeTokens: number;
  afterTokens: number;
  limit: number;
  step: number;
}

/** Atualiza o estado com o resultado de uma compactação (ou da troca pelo resumo antecipado). */
export function onCompactionResult(state: CompactionState, result: CompactionResult): CompactionState {
  const usedLlm = result.strategy !== 'deterministic';
  const base: CompactionState = { ...state, speculative: NO_SPECULATIVE };

  if (!result.ok) {
    // A primeira falha do LLM não trava: tenta a determinística no mesmo ciclo.
    if (!usedLlm) return { ...base, phase: 'tripped', trippedReason: 'failures' };
    const failures = state.consecutiveLlmFailures + 1;
    return {
      ...base,
      phase: 'armed',
      forceDeterministic: true,
      consecutiveLlmFailures: failures,
      deterministicOnly: state.deterministicOnly || failures >= LLM_FAILURES_TO_DETERMINISTIC,
    };
  }

  const recentCompactionSteps = [...state.recentCompactionSteps, result.step].slice(-MAX_RECENT_COMPACTION_STEPS);
  const compactionsThisTask = state.compactionsThisTask + 1;
  let next: CompactionState = { ...base, recentCompactionSteps, compactionsThisTask, lastCompactionStep: result.step };

  const effective = Math.max(0, result.afterTokens) * FULL_BP <= EFFECTIVE_AFTER_BP * Math.max(0, result.limit);
  if (effective) {
    next = {
      ...next,
      phase: 'cooldown',
      warnedThisCycle: false,
      modelRequestUsedThisCycle: false,
      lastClearAfterTokens: null,
      forceDeterministic: false,
      consecutiveLlmFailures: usedLlm ? 0 : state.consecutiveLlmFailures,
    };
  } else if (usedLlm) {
    next = { ...next, phase: 'armed', forceDeterministic: true };
  } else {
    return { ...next, phase: 'tripped', trippedReason: 'ineffective' };
  }

  const inWindow = recentCompactionSteps.filter((step) => result.step - step < LOOP_WINDOW_STEPS).length;
  if (inWindow >= LOOP_MAX_IN_WINDOW || compactionsThisTask > MAX_COMPACTIONS_PER_TASK) {
    return { ...next, phase: 'tripped', trippedReason: 'loop' };
  }
  return next;
}

/** Registra a marca d'água depois de uma limpeza. */
export function onToolResultsCleared(state: CompactionState, afterTokens: number): CompactionState {
  return { ...state, lastClearAfterTokens: Math.max(0, Math.round(afterTokens)) };
}

/** O resumo antecipado terminou. Só vale se ainda estiver em curso (pode ter sido descartado). */
export function onSpeculativeSummaryReady(state: CompactionState, coversThroughSeq: number): CompactionState {
  if (state.speculative.status !== 'running') return state;
  return { ...state, speculative: { status: 'ready', coversThroughSeq } };
}

export function discardSpeculativeSummary(state: CompactionState): CompactionState {
  return state.speculative.status === 'none' ? state : { ...state, speculative: NO_SPECULATIVE };
}

/**
 * Troca de modelo, modo ou orçamento: zera as marcas d'água e descarta o resumo antecipado, mas mantém o disjuntor
 * e o histórico de compactações (trocar de modelo não destrava).
 */
export function onBudgetChange(state: CompactionState): CompactionState {
  return { ...state, lastClearAfterTokens: null, speculative: NO_SPECULATIVE };
}

/** Nova tarefa: zera só a contagem de compactações da tarefa. */
export function onNewTask(state: CompactionState): CompactionState {
  return { ...state, compactionsThisTask: 0 };
}

/** Sem uso por este tempo (e com orçamento folgado), compactar ou limpar sai quase de graça. */
export const OPPORTUNISTIC_IDLE_MS = 10 * 60_000;
/** Invalidar o cache pode custar até esta fração do limite diário. */
export const OPPORTUNISTIC_MAX_DAILY_FRACTION = 0.01;

/** Seção 5.9: vale limpar ou compactar agora, aproveitando o cache frio? */
export function opportunisticCompactionWorthIt(input: {
  idleMs: number;
  cacheTtlMs?: number;
  usedTokens: number;
  fixedTokens: number;
  pUncachedPUsdPerToken: number;
  pCacheReadPUsdPerToken: number;
  dailyLimitPUsd: number;
  costBand: PressureBand;
}): boolean {
  if (input.cacheTtlMs !== undefined && input.cacheTtlMs > 0 && input.idleMs >= input.cacheTtlMs) return true;
  if (!(input.idleMs >= OPPORTUNISTIC_IDLE_MS) || input.costBand !== 0) return false;
  const tokens = Math.max(0, input.usedTokens) + Math.max(0, input.fixedTokens);
  const invalidationPUsd = tokens * Math.max(0, input.pUncachedPUsdPerToken - input.pCacheReadPUsdPerToken);
  return invalidationPUsd <= input.dailyLimitPUsd * OPPORTUNISTIC_MAX_DAILY_FRACTION;
}

export type SwitchStep =
  | 'clear_tool_results'
  | 'compact_with_old'
  | 'compact_deterministic'
  | 'compact_with_new'
  | 'compact_hierarchical_with_new';

export interface SwitchPlan {
  steps: readonly SwitchStep[];
  /** true: troca só depois dos passos (o histórico inteiro não vai ao novo provedor antes do resumo). */
  switchAfter: boolean;
  /** Uso alvo depois dos passos (tokens), ou null se nada precisa mudar. */
  targetTokens: number | null;
  /** Custo estimado da primeira chamada ao novo modelo, sem cache (pUSD; não inclui a compactação). */
  estimatedSwitchCostPUsd: number;
}

/**
 * Seção 5.10: o que fazer com o histórico ao trocar de modelo, modo ou orçamento. Para uma janela maior, nada é
 * desfeito. Quando precisa compactar, prefere o modelo antigo, para não mandar o histórico inteiro ao novo
 * provedor antes do resumo. Depois do plano, aplique `onBudgetChange` ao estado.
 */
export function planBudgetChange(input: {
  usedTokens: number;
  oldBudget: ContextBudget;
  newBudget: ContextBudget;
  oldModelAvailable: boolean;
  newModelIsLocalOrSmall: boolean;
  newUncachedPUsdPerToken: number;
}): SwitchPlan {
  const used = Math.max(0, Math.round(input.usedTokens));
  const { oldBudget, newBudget } = input;
  const t = newBudget.thresholds;
  const u = usageBp(used, newBudget.limit);
  const firstCall = (historyTokens: number) => (historyTokens + newBudget.fixedTokens) * Math.max(0, input.newUncachedPUsdPerToken);

  if (u < t.microBp) return { steps: [], switchAfter: false, targetTokens: null, estimatedSwitchCostPUsd: firstCall(used) };
  if (u < t.compactBp) {
    // O cache se perde na troca de qualquer jeito: limpar agora sai de graça.
    const target = Math.min(used, bpToTokens(t.postMicroBp, newBudget.limit));
    return { steps: ['clear_tool_results'], switchAfter: false, targetTokens: target, estimatedSwitchCostPUsd: firstCall(target) };
  }

  const target = Math.min(used, bpToTokens(SWITCH_TARGET_BP, newBudget.limit));
  if (input.oldModelAvailable && used + oldBudget.fixedTokens <= oldBudget.inputMax) {
    return { steps: ['compact_with_old'], switchAfter: true, targetTokens: target, estimatedSwitchCostPUsd: firstCall(target) };
  }
  if (input.newModelIsLocalOrSmall) {
    return { steps: ['compact_deterministic'], switchAfter: true, targetTokens: target, estimatedSwitchCostPUsd: firstCall(target) };
  }
  const fitsNew = used + newBudget.fixedTokens <= newBudget.inputMax;
  return {
    steps: [fitsNew ? 'compact_with_new' : 'compact_hierarchical_with_new'],
    switchAfter: false,
    targetTokens: target,
    estimatedSwitchCostPUsd: firstCall(used),
  };
}
