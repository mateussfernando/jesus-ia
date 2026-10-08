import { priceAt, priceTierStarts } from '@jesus/models';
import type { ModelCard, ResolvedPrice } from '@jesus/models';

/**
 * Orçamento automático de contexto por modelo (docs/rascunhos/algoritmo-contexto.md, seção 4).
 *
 * O limite efetivo `L` (o contorno tracejado do holograma) sai do menor de quatro tetos:
 * técnico (janela − reserva de saída, com margem do estimador), qualidade (o modo escolhido),
 * custo (pressão do orçamento do dia, degraus de preço e ponto ótimo de compactação) e o do usuário.
 * Tudo aqui é lógica pura: sem relógio, rede ou banco. "Automático" só ajusta números; nenhuma regra muda.
 */

export const MIN_OPERATIONAL_CAP = 65_536;
export const MIN_BRAIN_LIMIT = 16_384;
export const QUALITY_CAP_DEFAULT = 262_144;
export const ECONOMY_QUALITY_CAP = 131_072;
export const PRESSURE_LOW = 0.5;
export const PRESSURE_HIGH = 0.9;
/** κ: fração do limite em que a compactação dispara (média usada no custo por passo). */
export const COMPACT_RATIO_NOMINAL = 0.85;
/** π: fração do limite que sobra depois de compactar. */
export const POST_COMPACT_RATIO = 0.3;
export const STEPS_PER_DAY_PRIOR = 120;
export const STEP_GROWTH_PRIOR = 3_000;
export const OUTPUT_EWMA_PRIOR = 1_500;
export const DEFAULT_MARGIN_RATIO = 0.1;
export const UNKNOWN_TOKENIZER_MARGIN_RATIO = 0.15;
/** Fração do início de uma faixa de preço usada como teto, para ficar abaixo do degrau com folga. */
export const PRICE_TIER_HEADROOM = 0.9;

export type ContextMode = 'economy' | 'balanced' | 'max';
export type ContextRole = 'brain' | 'subagent' | 'summarizer' | 'gate' | 'other';
export type PressureBand = 0 | 1 | 2;
export type CapReason = 'technical' | 'quality' | 'cost' | 'price_tier' | 'user';

export interface BudgetStats {
  /** Passos (chamadas ao modelo) por dia: EWMA de 7 dias, limitado a 30–1.000. */
  stepsPerDay: number;
  /** Crescimento médio do histórico por passo, em tokens. */
  stepGrowth: number;
  /** Saída média por resposta, em tokens. */
  outputEwma: number;
  /** Taxa de acerto de cache observada (0..1); ausente = valor a priori pelo tipo de cache. */
  cacheHitRate?: number;
}

export interface ContextBudgetInput {
  card: ModelCard;
  role?: ContextRole;
  mode?: ContextMode;
  /** Raciocínio ligado para o papel (ignorado se o modelo for 'always' ou 'none'). */
  reasoningOn?: boolean;
  /** Parte fixa: prompt de sistema, JESUS.md, índice de memória e definições de ferramentas (tokens). */
  fixedTokens: number;
  /** Margem do estimador; ausente = 0,10 (0,15 para tokenizador desconhecido). */
  marginRatio?: number;
  /** Teto escolhido pelo usuário na interface (tokens). */
  userCap?: number;
  /** Orçamento diário e gasto de hoje (liquidado + reservado), em US$. */
  spend: { dailyLimitUsd: number; spentTodayUsd: number };
  stats?: Partial<BudgetStats>;
  /** Banda já atingida hoje para o mesmo modelo e modo: no mesmo dia a banda só sobe. */
  previousBand?: PressureBand;
}

export interface ContextBudget {
  modelKey: string;
  window: number;
  outputReserve: number;
  marginRatio: number;
  /** Teto técnico de planejamento (entrada). */
  inputMax: number;
  qualityCap: number;
  /** Infinity quando o gasto não aperta. */
  costCap: number;
  operationalCap: number;
  capReason: CapReason;
  pressureBand: PressureBand;
  fixedTokens: number;
  /** Limite efetivo `L` = teto operacional − parte fixa. Vai para `context.limitTokens` do holograma. */
  limit: number;
  /** Limite técnico − parte fixa: decide se o modelo serve para o papel. */
  technicalLimit: number;
  /** Início da faixa de preço que limitou o teto (0 se nenhuma). */
  priceTierStart: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Liga o raciocínio conforme o modelo: 'always' sempre, 'none' nunca, 'optional' pelo papel. */
export function isReasoningOn(card: ModelCard, requested: boolean): boolean {
  if (card.capabilities.reasoning === 'always') return true;
  if (card.capabilities.reasoning === 'none') return false;
  return requested;
}

/** Reserva de saída da chamada, que também é o teto de `maxOutputTokens` (seção 4.1). */
export function computeOutputReserve(card: ModelCard, role: ContextRole, reasoningOn: boolean, summaryTokens = 4_096): number {
  const on = isReasoningOn(card, reasoningOn);
  let base: number;
  switch (role) {
    case 'brain':
    case 'subagent':
      base = on ? 32_768 : 16_384;
      break;
    case 'summarizer':
      base = summaryTokens + (on ? 8_192 : 0);
      break;
    case 'gate':
      base = 2_048 + (card.capabilities.reasoning === 'always' ? 8_192 : 0);
      break;
    case 'other':
      base = 4_096;
      break;
  }
  return clamp(base, 1_024, Math.min(card.maxOutputTokens, Math.floor(0.25 * card.contextWindow)));
}

export function pressureBand(rho: number): PressureBand {
  if (!(rho > PRESSURE_LOW)) return 0;
  return rho < PRESSURE_HIGH ? 1 : 2;
}

function defaultCacheHitRate(card: ModelCard): number {
  switch (card.capabilities.cache) {
    case 'automatic':
      return 0.8;
    case 'explicit':
      return 0.7;
    case 'none':
      return 0;
  }
}

/** Custo efetivo de entrada (US$/M), misturando acertos de cache e o que é pago sem cache (seção 4.2). */
function blendedInputPrice(card: ModelCard, price: ResolvedPrice, hitRate: number): { blend: number; uncached: number } {
  const uncached = card.capabilities.cache === 'explicit' ? price.cacheWrite5mPerMTok : price.inputPerMTok;
  return { blend: hitRate * price.cacheReadPerMTok + (1 - hitRate) * uncached, uncached };
}

/** Custo médio de um passo (US$) com teto de contexto `cap`, entre compactações. */
function stepCostUsd(card: ModelCard, cap: number, fixed: number, price: ResolvedPrice, hitRate: number, outputEwma: number): number {
  const { blend } = blendedInputPrice(card, price, hitRate);
  const meanHistory = ((POST_COMPACT_RATIO + COMPACT_RATIO_NOMINAL) / 2) * Math.max(0, cap - fixed);
  return ((meanHistory + fixed) * blend + outputEwma * price.outputPerMTok) / 1_000_000;
}

/**
 * Histórico que minimiza o custo médio por passo (lote econômico, seção 4.2):
 * (κ − π)² L² = (2g / p) × (π L (pSumIn + Δ) + S × pSumOut), resolvido para L.
 */
export function eoqHistoryLimit(params: {
  stepGrowth: number;
  blend: number;
  uncached: number;
  outputPrice: number;
  summaryTokens: number;
}): number {
  const { stepGrowth: g, blend, uncached, outputPrice, summaryTokens: s } = params;
  if (!(blend > 0)) return Infinity;
  const delta = uncached - blend;
  const a = (COMPACT_RATIO_NOMINAL - POST_COMPACT_RATIO) ** 2;
  const b = (2 * g * POST_COMPACT_RATIO * (blend + delta)) / blend;
  const c = (2 * g * s * outputPrice) / blend;
  return (b + Math.sqrt(b * b + 4 * a * c)) / (2 * a);
}

interface CostCapResult {
  cap: number;
  band: PressureBand;
  reason: 'cost' | 'price_tier';
  tierStart: number;
}

function costCapFor(input: ContextBudgetInput, qualityCap: number, inputMax: number, mode: ContextMode, stats: BudgetStats): CostCapResult {
  const { card, fixedTokens: fixed, spend } = input;
  const none: CostCapResult = { cap: Infinity, band: 0, reason: 'cost', tierStart: 0 };
  if (mode === 'max') return none;

  const hit = clamp(stats.cacheHitRate ?? defaultCacheHitRate(card), 0, 1);
  const basePrice = priceAt(card.price, card.capabilities.cache, 0);
  if (!(blendedInputPrice(card, basePrice, hit).blend > 0) && basePrice.outputPerMTok === 0) return none; // modelo local/gratuito
  if (!(spend.dailyLimitUsd > 0)) return none;

  const rhoStatic = (cap: number, price: ResolvedPrice) =>
    (stepCostUsd(card, cap, fixed, price, hit, stats.outputEwma) * stats.stepsPerDay) / spend.dailyLimitUsd;
  const rhoDyn = Math.max(0, spend.spentTodayUsd) / spend.dailyLimitUsd;

  let cap = Math.min(qualityCap, inputMax);
  let reducedByTier = false;
  let tierStart = 0;
  // Degrau de preço: se passar do início de uma faixa piora a banda, o teto fica logo abaixo do degrau.
  for (const start of priceTierStarts(card.price)) {
    if (start >= cap) break;
    const above = rhoStatic(cap, priceAt(card.price, card.capabilities.cache, cap));
    const below = rhoStatic(Math.floor(PRICE_TIER_HEADROOM * start), basePrice);
    if (pressureBand(above) > pressureBand(below)) {
      cap = Math.floor(PRICE_TIER_HEADROOM * start);
      reducedByTier = true;
      tierStart = start;
      break;
    }
  }

  const priceAtCap = priceAt(card.price, card.capabilities.cache, cap);
  let band = Math.max(pressureBand(Math.max(rhoStatic(cap, priceAtCap), rhoDyn)), input.previousBand ?? 0) as PressureBand;
  if (mode === 'economy') band = 2;

  const { blend, uncached } = blendedInputPrice(card, priceAtCap, hit);
  const summaryTokens = clamp(0.08 * (Math.min(qualityCap, inputMax) - fixed), 2_000, 12_000);
  const eoq = fixed + eoqHistoryLimit({ stepGrowth: stats.stepGrowth, blend, uncached, outputPrice: priceAtCap.outputPerMTok, summaryTokens });

  if (band === 0) {
    return reducedByTier ? { cap, band, reason: 'price_tier', tierStart } : { ...none, band };
  }
  const target = band === 1 ? Math.floor(Math.sqrt(cap * eoq)) : Math.round(eoq);
  const costCap = Math.max(MIN_OPERATIONAL_CAP, Math.min(cap, target));
  const reason = reducedByTier && costCap === cap ? 'price_tier' : 'cost';
  return { cap: costCap, band, reason, tierStart: reason === 'price_tier' ? tierStart : 0 };
}

/** Calcula o orçamento de contexto do modelo atual. Recalcule só em eventos (seção 4.5). */
export function computeContextBudget(input: ContextBudgetInput): ContextBudget {
  const { card } = input;
  const role = input.role ?? 'brain';
  const mode = input.mode ?? 'balanced';
  const fixed = Math.max(0, Math.round(input.fixedTokens));
  const stats: BudgetStats = {
    stepsPerDay: clamp(input.stats?.stepsPerDay ?? STEPS_PER_DAY_PRIOR, 30, 1_000),
    stepGrowth: Math.max(1, input.stats?.stepGrowth ?? STEP_GROWTH_PRIOR),
    outputEwma: Math.max(0, input.stats?.outputEwma ?? OUTPUT_EWMA_PRIOR),
    ...(input.stats?.cacheHitRate === undefined ? {} : { cacheHitRate: input.stats.cacheHitRate }),
  };
  const margin =
    input.marginRatio ?? (card.tokenizer === 'unknown' ? UNKNOWN_TOKENIZER_MARGIN_RATIO : DEFAULT_MARGIN_RATIO);

  const window = card.contextWindow;
  const windowIn = card.maxInputTokens ?? window;
  const outputReserve = computeOutputReserve(card, role, input.reasoningOn ?? true);
  const inputMax = Math.floor(Math.min(windowIn, card.windowIncludesOutput ? window - outputReserve : window) / (1 + margin));

  const qualityCap =
    mode === 'economy' ? ECONOMY_QUALITY_CAP : mode === 'balanced' ? (card.qualityContextCap ?? QUALITY_CAP_DEFAULT) : Infinity;
  const cost = costCapFor(input, qualityCap, inputMax, mode, stats);
  const userCap = input.userCap !== undefined && input.userCap > 0 ? Math.floor(input.userCap) : Infinity;

  // O menor teto vence; em empate, o motivo mais explicativo (usuário > custo > qualidade > técnico).
  const candidates: { cap: number; reason: CapReason }[] = [
    { cap: userCap, reason: 'user' },
    { cap: cost.cap, reason: cost.reason },
    { cap: qualityCap, reason: 'quality' },
    { cap: inputMax, reason: 'technical' },
  ];
  let chosen: { cap: number; reason: CapReason } = { cap: Infinity, reason: 'technical' };
  for (const candidate of candidates) {
    if (candidate.cap < chosen.cap) chosen = candidate; // estrito: em empate, fica o que veio antes
  }
  const operationalCap = Math.min(chosen.cap, inputMax);

  return {
    modelKey: card.key,
    window,
    outputReserve,
    marginRatio: margin,
    inputMax,
    qualityCap,
    costCap: cost.cap,
    operationalCap,
    capReason: chosen.reason,
    pressureBand: cost.band,
    fixedTokens: fixed,
    limit: Math.max(0, operationalCap - fixed),
    technicalLimit: Math.max(0, inputMax - fixed),
    priceTierStart: chosen.reason === 'price_tier' ? cost.tierStart : 0,
  };
}

/** Campos de contexto do snapshot do holograma (seção 9). */
export function toHologramContext(budget: ContextBudget, usedTokens: number): { usedTokens: number; limitTokens: number } {
  const limitTokens = Math.max(1, budget.limit);
  const used = Number.isFinite(usedTokens) ? Math.round(usedTokens) : 0;
  return { usedTokens: clamp(used, 0, limitTokens), limitTokens };
}
