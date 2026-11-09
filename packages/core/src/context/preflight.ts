import { MAX_CALIBRATION_RATIO, MIN_CALIBRATION_RATIO } from '@jesus/models';
import type { ModelCard } from '@jesus/models';

/**
 * Checagem antes de cada envio (docs/rascunhos/algoritmo-contexto.md, seção 4.6). Falha fechada: só devolve 'send'
 * quando a entrada estimada cabe no limite de entrada do modelo e, se a janela inclui a saída, quando a entrada mais
 * `maxOutputTokens` cabe na janela. Lógica pura: sem relógio, rede ou banco.
 */

/** Menor saída que ainda vale uma chamada (tokens). O resumidor usa `summaryTokens` no lugar. */
export const MIN_USEFUL_OUTPUT = 1_024;

export interface PreflightInput {
  /** Entrada real da âncora (≥ 1 token), se ela vale (`isAnchorValid`, seção 7.2); `null` sem âncora válida. */
  anchorActualInput: number | null;
  /**
   * Estimativa crua (sem k) do que entrou depois da âncora: Σ itens novos + (F − F da âncora). O chamador limita a
   * ≥ 0 (assumir que nada saiu é conservador); valor negativo conta como inválido.
   */
  deltaEstimate: number;
  /** Estimativa crua (sem k) da entrada inteira: parte fixa + histórico. Usada sem âncora válida. */
  totalEstimate: number;
  /** Fator de calibração (seção 7.4); fora de [0,5; 2] é inválido (dado corrompido). */
  k: number;
  /** Margem do estimador (seção 7.4). Vale só para a parte estimada, nunca para o que o provedor já mediu. */
  m: number;
  /** Reserva de saída R do papel (seção 4.1). */
  outputReserve: number;
  /** Saída que o saldo paga (`maxOutputForBudget`, seção 8.2). */
  budgetMaxOutput: number;
  /** `MIN_USEFUL_OUTPUT`; no resumidor, `summaryTokens`. */
  minUsefulOutput: number;
  card: Pick<ModelCard, 'contextWindow' | 'maxInputTokens' | 'windowIncludesOutput'>;
}

export type PreflightResult =
  | { kind: 'send'; maxOutputTokens: number; inputEstimate: number }
  | { kind: 'block'; reason: 'budget' }
  | { kind: 'needs_context_action' };

const BLOCK_BUDGET: PreflightResult = { kind: 'block', reason: 'budget' };
const NEEDS_CONTEXT_ACTION: PreflightResult = { kind: 'needs_context_action' };

/**
 * Tolerância relativa para o erro de ponto flutuante: 1,1 × 1,1 × 1.000 dá 1.210,0000000000002, e o ceil puro daria
 * 1.211. Vale menos de um milionésimo de token na faixa de janelas do projeto (até 2 milhões).
 */
const FLOAT_TOLERANCE = 1e-12;

/** ceil(x) sem o erro de ponto flutuante de produtos com decimais subir um inteiro exato para o próximo. */
function ceilProduct(x: number): number {
  return Math.ceil(x - FLOAT_TOLERANCE * Math.max(1, Math.abs(x)));
}

function isNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * k só existe em [0,5; 2] (a calibração descarta razões fora dessa faixa). Fora dela é dado corrompido: um k minúsculo
 * encolheria a estimativa e deixaria passar uma entrada muitas vezes maior que a janela.
 */
function isCalibrationFactor(k: number): boolean {
  return Number.isFinite(k) && k >= MIN_CALIBRATION_RATIO && k <= MAX_CALIBRATION_RATIO;
}

/**
 * Entrada estimada, com a margem só na parte estimada:
 *   âncora válida → real + ceil((1 + m) × k × delta);  sem âncora → ceil((1 + m) × k × total).
 * Qualquer número inválido (NaN, infinito, negativo; k fora de [0,5; 2]; âncora abaixo de 1 token, que
 * `isAnchorValid` também recusa) → `null`.
 */
function estimateInput(i: PreflightInput): number | null {
  if (!isCalibrationFactor(i.k) || !isNonNegative(i.m) || !isNonNegative(i.deltaEstimate) || !isNonNegative(i.totalEstimate)) {
    return null;
  }
  const factor = (1 + i.m) * i.k;
  if (i.anchorActualInput === null) return ceilProduct(factor * i.totalEstimate);
  if (!(Number.isFinite(i.anchorActualInput) && i.anchorActualInput >= 1)) return null;
  return Math.ceil(i.anchorActualInput) + ceilProduct(factor * i.deltaEstimate);
}

/**
 * Decide se a chamada sai (seção 4.6):
 *   R_call = floor(min(outputReserve, budgetMaxOutput));  R_call < max(1, minUsefulOutput) → block 'budget'
 *   cabe   = entrada ≤ Win e entrada ≤ W e (windowIncludesOutput ? entrada + R_call ≤ W : true)
 *   cabe → 'send' com maxOutputTokens = R_call; senão → 'needs_context_action' (decideContextAction despeja ou
 *   compacta; sem saída, o orquestrador não envia).
 * Win = card.maxInputTokens ?? card.contextWindow; W = card.contextWindow (a janela total: a entrada nunca passa dela).
 *
 * Falha fechada: número inválido do lado da saída (R, saldo, mínimo útil) → block 'budget'; do lado da entrada (âncora,
 * estimativas, k, m, janela) → 'needs_context_action'. Nunca 'send'. `windowIncludesOutput` diferente de `false`
 * conta como verdadeiro (o caso mais apertado).
 */
export function preflight(i: PreflightInput): PreflightResult {
  if (!isNonNegative(i.outputReserve) || !isNonNegative(i.budgetMaxOutput) || !isNonNegative(i.minUsefulOutput)) {
    return BLOCK_BUDGET;
  }
  const maxOutputTokens = Math.floor(Math.min(i.outputReserve, i.budgetMaxOutput));
  if (maxOutputTokens < Math.max(1, i.minUsefulOutput)) return BLOCK_BUDGET;

  const totalWindow = i.card.contextWindow;
  const windowIn = i.card.maxInputTokens ?? totalWindow;
  const inputEstimate = estimateInput(i);
  if (inputEstimate === null || !isPositive(totalWindow) || !isPositive(windowIn)) return NEEDS_CONTEXT_ACTION;

  const includesOutput = i.card.windowIncludesOutput !== false;
  const fits =
    inputEstimate <= windowIn &&
    inputEstimate <= totalWindow &&
    (!includesOutput || inputEstimate + maxOutputTokens <= totalWindow);
  return fits ? { kind: 'send', maxOutputTokens, inputEstimate } : NEEDS_CONTEXT_ACTION;
}
