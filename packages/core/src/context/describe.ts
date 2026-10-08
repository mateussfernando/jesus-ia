import type { ModelCard } from '@jesus/models';
import type { CapReason, ContextBudget } from './budget';

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
  return `${parts.join(' · ')}.`;
}
