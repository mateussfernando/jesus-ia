import type { ModelCard } from '@jesus/models';
import type { CapReason, ContextBudget } from './budget';
import type { CompactionState, TripReason } from './compaction';

/** Texto em pt-BR que explica o limite automático (painel e leitores de tela). */

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) return 'sem limite';
  if (tokens >= 1_000_000) return `${integer.format(tokens / 1_000_000)} mi`;
  if (tokens >= 1_000) return `${integer.format(tokens / 1_000)} mil`;
  return integer.format(tokens);
}

export const capReasonLabels: Record<CapReason, string> = {
  technical: 'janela do modelo',
  quality: 'qualidade (contexto longo demais piora as respostas)',
  cost: 'orçamento do dia',
  price_tier: 'degrau de preço',
  user: 'teto escolhido por você',
};

export function describeContextBudget(budget: ContextBudget, card: ModelCard): string {
  const parts = [
    `Limite automático: ${formatTokenCount(budget.limit)} tokens`,
    card.displayName,
    `janela ${formatTokenCount(budget.window)}`,
    `teto: ${capReasonLabels[budget.capReason]}`,
  ];
  if (budget.capReason === 'price_tier' && budget.priceTierStart > 0) {
    parts.push(`acima de ${formatTokenCount(budget.priceTierStart)} tokens por pedido o preço sobe`);
  }
  parts.push(`parte fixa ${formatTokenCount(budget.fixedTokens)}`);
  const { microBp, compactBp } = budget.thresholds;
  parts.push(`limpa saídas antigas em ${Math.floor(microBp / 100)}% e compacta em ${Math.floor(compactBp / 100)}%`);
  return `${parts.join(' · ')}.`;
}

export const tripReasonLabels: Record<TripReason, string> = {
  refill: 'o contexto encheu de novo logo depois de compactar',
  ineffective: 'compactar não liberou espaço suficiente',
  loop: 'compactações demais em pouco tempo',
  failures: 'a compactação falhou',
};

/** Estado da compactação automática em pt-BR (painel e leitores de tela). */
export function describeCompactionState(state: CompactionState): string {
  switch (state.phase) {
    case 'armed':
      return state.deterministicOnly
        ? 'Compactação automática ligada (só sem IA: o resumo por IA falhou 3 vezes nesta sessão).'
        : 'Compactação automática ligada.';
    case 'compacting':
      return 'Compactando agora; seus pedidos esperam na fila.';
    case 'cooldown':
      return 'Compactou há pouco; esperando a conversa andar antes de compactar de novo.';
    case 'tripped':
      return `Compactação travada (disjuntor): ${tripReasonLabels[state.trippedReason ?? 'loop']}. Diga "continuar" ou comece uma nova sessão.`;
  }
}
