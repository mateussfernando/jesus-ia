import { computeContextBudget, describeContextBudget } from '@jesus/core';
import type { ContextBudget } from '@jesus/core';
import type { HologramSnapshot } from '@jesus/hologram';
import { getModelCard } from '@jesus/models';
import type { ModelCard } from '@jesus/models';
import { applyAction } from './scenarios';

/**
 * Limite de contexto automático no laboratório: o contorno tracejado vem do modelo escolhido e do gasto
 * do dia, pelo mesmo cálculo que o app vai usar (packages/core, orçamento de contexto).
 */

export const labModels = [
  { key: 'anthropic:claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { key: 'anthropic:claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { key: 'anthropic:claude-opus-5-5', label: 'Claude Opus 5.5' },
  { key: 'openai:modelo-desconhecido', label: 'Modelo desconhecido' },
] as const;

export type LabModelKey = (typeof labModels)[number]['key'];

/** O cérebro escolhido pelo dono do projeto (decisão 0011). */
export const DEFAULT_MODEL: LabModelKey = 'anthropic:claude-haiku-5-5';

/** Parte fixa simulada: prompt de sistema, JESUS.md, índice de memória e definições de ferramentas. */
export const LAB_FIXED_TOKENS = 10_000;

export function labCard(key: LabModelKey): ModelCard {
  const card = getModelCard(key);
  if (card === null) throw new Error(`modelo inválido no laboratório: ${key}`);
  return card;
}

export function labBudget(key: LabModelKey, snapshot: HologramSnapshot): ContextBudget {
  return computeContextBudget({
    card: labCard(key),
    fixedTokens: LAB_FIXED_TOKENS,
    spend: { dailyLimitUsd: snapshot.spend.limitUsd, spentTodayUsd: snapshot.spend.todayUsd },
  });
}

/** Aplica o limite automático ao snapshot. Devolve o mesmo objeto se nada mudou. */
export function withAutoLimit(snapshot: HologramSnapshot, key: LabModelKey): HologramSnapshot {
  const limit = Math.max(1, labBudget(key, snapshot).limit);
  if (limit === snapshot.context.limitTokens) return snapshot;
  return applyAction(snapshot, { type: 'contextLimit', limitTokens: limit }, 0);
}

export function describeLabBudget(key: LabModelKey, snapshot: HologramSnapshot): string {
  return describeContextBudget(labBudget(key, snapshot), labCard(key));
}
