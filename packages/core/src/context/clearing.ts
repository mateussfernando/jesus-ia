import type { ContextItemMeta } from './items';
import { REF_PATTERN, TOOL_NAME_PATTERN } from './items';
import type { Thresholds } from './thresholds';
import { bpToTokens } from './thresholds';

/**
 * Nível 1 da compactação: limpar saídas antigas de ferramentas, sem LLM (seção 5.3).
 * Cada saída limpa vira um marcador gerado por código; o conteúdo completo continua no banco e volta com
 * `context.recall`. Limpar não descontamina: a contaminação e a origem dos valores vivem no banco.
 */

/** Saídas menores que isto não valem a limpeza. */
export const CLEAR_MIN_ITEM_TOKENS = 500;
/** As saídas mais recentes que nunca são limpas. */
export const CLEAR_KEEP_RECENT = 3;

export interface ClearPlan {
  /** Itens a trocar por marcadores, na ordem em que foram escolhidos. */
  itemIds: readonly string[];
  /** Tokens liberados (tamanho dos itens menos o dos marcadores). */
  freedTokens: number;
}

const EMPTY_PLAN: ClearPlan = { itemIds: [], freedTokens: 0 };

function bySeq(a: ContextItemMeta, b: ContextItemMeta): number {
  return a.seq - b.seq;
}

/**
 * Escolhe as saídas a limpar: só de turnos anteriores, sem aprovação pendente, com 500 tokens ou mais e fora das
 * 3 mais recentes. Primeiro as superadas (o mesmo recurso lido de novo depois), depois os erros já seguidos de
 * nova tentativa, depois as demais, da mais antiga para a mais nova. Libera até descer ao alvo da limpeza;
 * se der menos que `clearAtLeast`, devolve plano vazio (não vale invalidar o cache).
 */
export function selectToolResultsToClear(
  items: readonly ContextItemMeta[],
  ctx: { currentTurn: number; usedTokens: number; limit: number; thresholds: Thresholds; stubTokens: number },
): ClearPlan {
  const results = items.filter((item) => item.kind === 'tool_result').sort(bySeq);
  const live = results.filter((item) => item.cleared !== true);
  const protectedIds = new Set(live.slice(-CLEAR_KEEP_RECENT).map((item) => item.id));
  const candidates = live.filter(
    (item) =>
      item.turn < ctx.currentTurn &&
      item.pendingApproval !== true &&
      item.tokens >= CLEAR_MIN_ITEM_TOKENS &&
      !protectedIds.has(item.id),
  );

  const readLaterAgain = (item: ContextItemMeta, key: (other: ContextItemMeta) => string | undefined): boolean => {
    const mine = key(item);
    return mine !== undefined && results.some((other) => other.seq > item.seq && key(other) === mine);
  };
  const superseded = candidates.filter((item) => readLaterAgain(item, (other) => other.resourceKey));
  const retriedErrors = candidates.filter(
    (item) =>
      item.isError === true &&
      !superseded.includes(item) &&
      readLaterAgain(item, (other) => other.resourceKey ?? other.toolName),
  );
  const rest = candidates.filter((item) => !superseded.includes(item) && !retriedErrors.includes(item));
  const ordered = [...superseded, ...retriedErrors, ...rest];

  const { thresholds, limit } = ctx;
  const needed = Math.max(thresholds.clearAtLeast, ctx.usedTokens - bpToTokens(thresholds.postMicroBp, limit));
  const itemIds: string[] = [];
  let freedTokens = 0;
  for (const item of ordered) {
    if (freedTokens >= needed) break;
    itemIds.push(item.id);
    freedTokens += Math.max(0, item.tokens - ctx.stubTokens);
  }
  return freedTokens < thresholds.clearAtLeast ? EMPTY_PLAN : { itemIds, freedTokens };
}

const originLabels: Record<ContextItemMeta['origin'], string> = { external: 'externo', local: 'local', user: 'usuário' };
const probeLabels: Record<NonNullable<ContextItemMeta['probe']>, string> = {
  clean: 'limpa',
  flagged: 'marcada',
  unavailable: 'indisponível',
};

/** Marcador em pt-BR que fica no lugar de uma saída limpa. Gerado só por código, a partir de campos validados. */
export function renderClearedStub(item: Pick<ContextItemMeta, 'toolName' | 'origin' | 'probe' | 'toolCallId'>): string {
  const name = item.toolName !== undefined && TOOL_NAME_PATTERN.test(item.toolName) ? item.toolName : 'ferramenta';
  const probe = probeLabels[item.probe ?? 'unavailable'];
  const head = `[saída antiga de ${name} removida para liberar contexto · origem: ${originLabels[item.origin]} · sonda: ${probe}`;
  if (item.toolCallId === undefined || !REF_PATTERN.test(item.toolCallId)) return `${head} · ref: indisponível]`;
  return `${head} · ref: ${item.toolCallId} · use context.recall("${item.toolCallId}") se precisar]`;
}
