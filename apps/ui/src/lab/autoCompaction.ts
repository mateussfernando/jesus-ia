import {
  bpToTokens,
  decideContextAction,
  DETERMINISTIC_BELOW_LIMIT,
  formatTokenCount,
  initialCompactionState,
  onBudgetChange,
  onCompactionResult,
  onSpeculativeSummaryReady,
  onToolResultsCleared,
  planBudgetChange,
  postCompactionSplit,
  renderHarnessNote,
  tripReasonLabels,
} from '@jesus/core';
import type {
  BlockReason,
  CompactionState,
  CompactionStrategy,
  CompactionTrigger,
  ContextBudget,
  ContextObservation,
  UserContextCommand,
} from '@jesus/core';
import type { HologramSnapshot, HologramState } from '@jesus/hologram';
import { labBudget, labCard, labModels, withAutoLimit } from './autoContext';
import type { LabModelKey } from './autoContext';
import { applyAction, initialSnapshot } from './scenarios';
import type { Scenario } from './scenarios';

/**
 * Compactação automática no laboratório: a mesma máquina de estados que o app vai usar (packages/core), sobre um
 * histórico simulado. Tudo aqui é puro; o store só agenda o fim de cada compactação.
 */

/** Parte de cada crescimento do contexto que vira saída antiga de ferramenta (o que a limpeza pode tirar). */
export const CLEARABLE_SHARE = 0.2;

export interface LabEngine {
  state: CompactionState;
  /** Passos simulados: cada aumento do contexto conta como uma chamada ao modelo. */
  step: number;
  /** Saídas antigas de ferramentas no histórico simulado (tokens). */
  clearableTokens: number;
}

export function initialEngine(snapshot: HologramSnapshot): LabEngine {
  return {
    state: initialCompactionState(),
    step: 0,
    clearableTokens: Math.round(CLEARABLE_SHARE * snapshot.context.usedTokens),
  };
}

/** Compactação em curso (o store agenda o fim depois de `COMPACTION_DURATION_MS`). */
export interface PendingCompaction {
  strategy: CompactionStrategy | 'speculative';
  beforeTokens: number;
  /** Alvo depois de compactar; ausente = divisão padrão da seção 5.5 (cerca de 30% de L). */
  targetTokens?: number;
  /** Estado do holograma antes de compactar, para voltar no fim. */
  resumeState: HologramState;
  /** Troca de modelo esperando a compactação terminar. */
  switchTo?: LabModelKey;
}

/** Quanto cada tipo de compactação demora na simulação (no app, o resumo por IA pode levar até 90 s). */
export const COMPACTION_DURATION_MS: Readonly<Record<PendingCompaction['strategy'], number>> = {
  llm: 2_400,
  hierarchical: 3_200,
  deterministic: 900,
  speculative: 600,
};

export interface EngineInput {
  command?: UserContextCommand;
  /** "/compactar": pedido explícito do usuário. */
  userRequest?: boolean;
}

export interface EngineResult {
  snapshot: HologramSnapshot;
  engine: LabEngine;
  caption: string | null;
  pending: PendingCompaction | null;
}

const strategyLabels: Record<CompactionStrategy, string> = {
  llm: 'resumo por IA',
  deterministic: 'sem IA: ficam os pedidos, as ações e o fim da conversa',
  hierarchical: 'resumo por partes',
};

function percent(tokens: number, limit: number): string {
  return `${Math.round((100 * tokens) / Math.max(1, limit))}%`;
}

function compactionCaption(trigger: CompactionTrigger, strategy: CompactionStrategy, used: number, limit: number): string {
  switch (trigger) {
    case 'auto':
      return `Contexto em ${percent(used, limit)}: compacta sozinho (${strategyLabels[strategy]}).`;
    case 'refill':
      return 'Encheu de novo logo depois de compactar: compacta mais uma vez. Se encher de novo, o disjuntor trava.';
    case 'hard':
      return 'No limite técnico do modelo: nada é enviado antes de compactar.';
    case 'requested':
      return `Você pediu: compactando agora (${strategyLabels[strategy]}).`;
    case 'opportunistic':
      return 'O cache já esfriou: compactar agora sai quase de graça.';
  }
}

function blockCaption(reason: BlockReason, state: CompactionState): string {
  if (reason === 'hard_limit') return 'No limite técnico e sem como abrir espaço: o Jesus para e pergunta o que fazer.';
  const why = tripReasonLabels[state.trippedReason ?? 'loop'];
  return `Disjuntor: ${why}. O Jesus para e pergunta: continuar ou começar uma nova sessão? Trocar de modelo não destrava.`;
}

export function observeLab(
  snapshot: HologramSnapshot,
  budget: ContextBudget,
  engine: LabEngine,
  input: EngineInput = {},
): ContextObservation {
  const used = snapshot.context.usedTokens;
  const t = budget.thresholds;
  const needed = Math.max(t.clearAtLeast, used - bpToTokens(t.postMicroBp, budget.limit));
  const freeable = Math.min(engine.clearableTokens, needed);
  return {
    usedTokens: used,
    fixedTokens: budget.fixedTokens,
    limit: budget.limit,
    inputMax: budget.inputMax,
    step: engine.step,
    thresholds: t,
    largestTailItem: null,
    clearPlanFreed: freeable >= t.clearAtLeast ? freeable : 0,
    summarizerAffordable: snapshot.spend.todayUsd < snapshot.spend.limitUsd,
    costBand: budget.pressureBand,
    presence: 'present',
    midToolRound: false,
    newestOversizedResult: null,
    opportunisticWorthIt: false,
    explicitRequest: input.userRequest === true ? { by: 'user', focus: null } : null,
    userCommand: input.command ?? 'none',
    // Na simulação, nada edita o trecho coberto pelo resumo antecipado.
    speculativeValid: engine.state.speculative.status === 'ready',
  };
}

const MAX_DECISIONS = 4;

/** Roda a máquina de estados até 'none', uma compactação ou um bloqueio (no máximo 4 decisões, como o orquestrador). */
export function runEngine(snapshot: HologramSnapshot, budget: ContextBudget, engine: LabEngine, input: EngineInput = {}): EngineResult {
  let snap = snapshot;
  let eng = engine;
  let once: EngineInput = input;
  const captions: string[] = [];
  const result = (pending: PendingCompaction | null = null): EngineResult => ({
    snapshot: snap,
    engine: eng,
    caption: captions.length > 0 ? captions.join(' ') : null,
    pending,
  });

  for (let i = 0; i < MAX_DECISIONS; i += 1) {
    const obs = observeLab(snap, budget, eng, once);
    once = {}; // o comando e o pedido valem uma vez só
    const wasTripped = eng.state.phase === 'tripped';
    const { action, next } = decideContextAction(eng.state, obs);
    eng = { ...eng, state: next };
    switch (action.type) {
      case 'none':
        return result();
      case 'clear_tool_results': {
        const freed = obs.clearPlanFreed;
        const after = Math.max(0, obs.usedTokens - freed);
        snap = applyAction(snap, { type: 'context', usedTokens: after }, 0);
        eng = { ...eng, state: onToolResultsCleared(eng.state, after), clearableTokens: Math.max(0, eng.clearableTokens - freed) };
        captions.push(
          `Limpeza automática (sem IA): ${formatTokenCount(freed)} tokens de saídas antigas de ferramentas viraram marcadores; dá para reler com context.recall.`,
        );
        break;
      }
      case 'notify_memory_pressure': {
        const note = renderHarnessNote({
          kind: 'memory_pressure',
          usedTokens: obs.usedTokens,
          limit: obs.limit,
          thresholds: obs.thresholds,
          channel: 'system_message',
          nonce: 'laboratorio',
        });
        // Na legenda, só a primeira frase da nota (a que traz os números).
        captions.push(`Nota ao modelo, gerada só de números: “${note.text.slice(0, note.text.indexOf('.') + 1)}”`);
        break;
      }
      case 'start_speculative_summary':
        // No app, o resumo roda em segundo plano enquanto a conversa continua; aqui fica pronto na hora.
        eng = { ...eng, state: onSpeculativeSummaryReady(eng.state, eng.step) };
        captions.push(
          `Resumo antecipado em segundo plano: ao passar de ${Math.floor(obs.thresholds.compactBp / 100)}%, a troca é instantânea, sem travar a voz.`,
        );
        break;
      case 'compact':
      case 'apply_speculative_summary': {
        const strategy = action.type === 'compact' ? action.strategy : 'speculative';
        captions.push(
          action.type === 'compact'
            ? compactionCaption(action.trigger, action.strategy, obs.usedTokens, obs.limit)
            : `Contexto em ${percent(obs.usedTokens, obs.limit)}: aplica o resumo antecipado (troca instantânea).`,
        );
        const resumeState = snap.state === 'compacting' ? 'idle' : snap.state;
        snap = applyAction(snap, { type: 'state', state: 'compacting' }, 0);
        return result({ strategy, beforeTokens: obs.usedTokens, resumeState });
      }
      case 'block_and_ask':
      case 'stop_and_report':
        // Já travado e esperando você: não repete o aviso a cada passo.
        if (!(wasTripped && snap.state === 'awaiting')) captions.push(blockCaption(action.reason, eng.state));
        snap = applyAction(snap, { type: 'state', state: 'awaiting' }, 0);
        return result();
      case 'evict_oversized':
      case 'cancel_compaction':
        // Não acontecem na simulação: não há item grande na cauda nem "pare" no laboratório.
        return result();
    }
  }
  return result();
}

/** Aplica o limite automático, conta o passo e roda a máquina de estados depois de uma mudança no snapshot. */
export function settleLab(
  previous: HologramSnapshot,
  next: HologramSnapshot,
  key: LabModelKey,
  engine: LabEngine,
  input: EngineInput = {},
): EngineResult {
  const limited = withAutoLimit(next, key);
  const growth = limited.context.usedTokens - previous.context.usedTokens;
  let eng: LabEngine =
    growth > 0
      ? {
          ...engine,
          step: engine.step + 1,
          clearableTokens: Math.min(limited.context.usedTokens, engine.clearableTokens + Math.round(CLEARABLE_SHARE * growth)),
        }
      : { ...engine, clearableTokens: Math.min(limited.context.usedTokens, engine.clearableTokens) };
  // Mudou o limite (gasto do dia): as marcas d'água valiam para o L antigo.
  if (limited.context.limitTokens !== previous.context.limitTokens) eng = { ...eng, state: onBudgetChange(eng.state) };
  return runEngine(limited, labBudget(key, limited), eng, input);
}

/** Termina uma compactação: o uso cai para o alvo, o estado volta e o disjuntor registra o resultado. */
export function finishCompaction(snapshot: HologramSnapshot, budget: ContextBudget, engine: LabEngine, pending: PendingCompaction): EngineResult {
  const target = pending.targetTokens ?? postCompactionSplit(budget.limit).totalTokens;
  const after = Math.min(target, snapshot.context.usedTokens);
  const state = onCompactionResult(engine.state, {
    ok: true,
    strategy: pending.strategy,
    beforeTokens: pending.beforeTokens,
    afterTokens: after,
    limit: budget.limit,
    step: engine.step,
  });
  let snap = applyAction(snapshot, { type: 'context', usedTokens: after }, 0);
  if (snap.state === 'compacting') snap = applyAction(snap, { type: 'state', state: pending.resumeState }, 0);
  const caption =
    state.phase === 'tripped'
      ? `Compactado, mas foram compactações demais em pouco tempo: o disjuntor travou. Clique em “Continuar” para seguir.`
      : `Compactado: de ${formatTokenCount(pending.beforeTokens)} para ${formatTokenCount(after)} tokens (${percent(after, budget.limit)} do limite). Pedidos, ações e fatos ficaram; memórias deduzidas ficam pendentes até você revisar.`;
  return { snapshot: snap, engine: { ...engine, state, clearableTokens: 0 }, caption, pending: null };
}

/** pUSD por token de entrada sem cache (para estimar o custo da primeira chamada ao novo modelo). */
function uncachedPUsdPerToken(key: LabModelKey): number {
  const card = labCard(key);
  const perMTok = card.capabilities.cache === 'explicit' ? (card.price.cacheWrite5mPerMTok ?? 1.25 * card.price.inputPerMTok) : card.price.inputPerMTok;
  return Math.round(perMTok * 1_000_000);
}

export interface SwitchResult extends EngineResult {
  /** true: troca já; false: troca quando a compactação terminar (`pending.switchTo`). */
  switchNow: boolean;
}

/** Troca de modelo no meio da sessão (seção 5.10), com o histórico simulado. */
export function switchModel(snapshot: HologramSnapshot, from: LabModelKey, to: LabModelKey, engine: LabEngine): SwitchResult {
  const label = labModels.find((m) => m.key === to)?.label ?? to;
  const used = snapshot.context.usedTokens;
  const newBudget = labBudget(to, snapshot);
  const plan = planBudgetChange({
    usedTokens: used,
    oldBudget: labBudget(from, snapshot),
    newBudget,
    oldModelAvailable: true,
    newModelIsLocalOrSmall: newBudget.limit < DETERMINISTIC_BELOW_LIMIT,
    newUncachedPUsdPerToken: uncachedPUsdPerToken(to),
  });
  const step = plan.steps[0];
  if (engine.state.phase === 'tripped' && step !== undefined) {
    // Trocar de modelo não destrava: com o disjuntor travado, nada de limpar ou compactar por conta da troca.
    return {
      snapshot,
      engine,
      caption: `Disjuntor travado: clique em “continuar” antes de trocar para o ${label}, que tem limite menor.`,
      pending: null,
      switchNow: false,
    };
  }
  const eng: LabEngine = { ...engine, state: onBudgetChange(engine.state) };

  if (step === undefined) {
    return { snapshot, engine: eng, caption: `Trocou para ${label}: o histórico cabe no novo limite, nada a fazer.`, pending: null, switchNow: true };
  }
  if (step === 'clear_tool_results') {
    const after = plan.targetTokens ?? used;
    const freed = used - after;
    return {
      snapshot: applyAction(snapshot, { type: 'context', usedTokens: after }, 0),
      engine: { ...eng, state: onToolResultsCleared(eng.state, after), clearableTokens: Math.max(0, eng.clearableTokens - freed) },
      caption: `Trocou para ${label}: limpou saídas antigas antes (o cache se perde na troca de qualquer jeito).`,
      pending: null,
      switchNow: true,
    };
  }

  const strategy: CompactionStrategy =
    step === 'compact_deterministic' ? 'deterministic' : step === 'compact_hierarchical_with_new' ? 'hierarchical' : 'llm';
  const captions: Record<Exclude<typeof step, 'clear_tool_results'>, string> = {
    compact_with_old: `O histórico não cabe bem no ${label}: compacta com o modelo atual antes de trocar, para não mandar a conversa inteira ao novo.`,
    compact_deterministic: `O ${label} é pequeno: compacta sem IA antes de trocar.`,
    compact_with_new: `Trocou para ${label}: compacta com o novo modelo.`,
    compact_hierarchical_with_new: `Trocou para ${label}: compacta por partes (o histórico não cabe nele de uma vez).`,
  };
  const pending: PendingCompaction = {
    strategy,
    beforeTokens: used,
    ...(plan.targetTokens === null ? {} : { targetTokens: plan.targetTokens }),
    resumeState: snapshot.state === 'compacting' ? 'idle' : snapshot.state,
    ...(plan.switchAfter ? { switchTo: to } : {}),
  };
  return {
    snapshot: applyAction(snapshot, { type: 'state', state: 'compacting' }, 0),
    engine: { ...eng, state: { ...eng.state, phase: 'compacting' } },
    caption: captions[step],
    pending,
    switchNow: !plan.switchAfter,
  };
}

/**
 * Roda um cenário inteiro com a compactação automática, sem relógio (para testes): cada compactação termina no
 * tempo simulado dela, antes do passo seguinte do roteiro.
 */
export function replayScenario(
  scenario: Scenario,
  key: LabModelKey,
  start: HologramSnapshot = initialSnapshot,
): { snapshot: HologramSnapshot; engine: LabEngine; captions: readonly string[] } {
  let snapshot = withAutoLimit(start, key);
  let engine = initialEngine(snapshot);
  let pending: { endsAt: number; compaction: PendingCompaction } | null = null;
  const captions: string[] = [];
  const take = (r: EngineResult, now: number) => {
    snapshot = r.snapshot;
    engine = r.engine;
    if (r.caption !== null) captions.push(r.caption);
    if (r.pending !== null) pending = { endsAt: now + COMPACTION_DURATION_MS[r.pending.strategy], compaction: r.pending };
  };
  const finishDue = (now: number) => {
    while (pending !== null && pending.endsAt <= now) {
      const { endsAt, compaction } = pending;
      pending = null;
      const done = finishCompaction(snapshot, labBudget(key, snapshot), engine, compaction);
      take({ ...done, snapshot: withAutoLimit(done.snapshot, key) }, endsAt);
      take(runEngine(snapshot, labBudget(key, snapshot), engine), endsAt);
    }
  };
  for (const step of scenario.steps) {
    finishDue(step.at);
    const next = step.actions.reduce((s, action) => applyAction(s, action, step.at), snapshot);
    take(settleLab(snapshot, next, key, engine), step.at);
  }
  finishDue(Number.POSITIVE_INFINITY);
  return { snapshot, engine, captions };
}
