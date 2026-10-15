import { priceAt } from './price';
import type { ModelCard } from './types';

/**
 * Uso de uma resposta, já normalizado entre provedores (docs/rascunhos/algoritmo-contexto.md, seção 7.5).
 * `inputTokens` é o TOTAL do prompt, incluindo o que foi lido do cache e o que foi gravado nele.
 */
export interface NormalizedUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  /** Inclui os tokens de raciocínio. */
  outputTokens: number;
}

export interface CostBreakdown {
  /** Picodólares inteiros (1 US$ = 10¹² pUSD), para somar sem erro de arredondamento. */
  totalPUsd: number;
  uncachedInputPUsd: number;
  cacheReadPUsd: number;
  cacheWritePUsd: number;
  outputPUsd: number;
  /** Início da faixa de preço aplicada (0 = preço base). */
  tierStart: number;
  /** O uso veio inconsistente (cache maior que a entrada, número negativo) e foi ajustado. */
  adjusted: boolean;
}

/**
 * US$ por milhão de tokens → picodólares por token (US$ 1/M = 10⁶ pUSD por token; seção 8.1).
 * Ex.: o cache do Flash, 0,0028 US$/M, dá 2.800 pUSD por token.
 * Falha fechada: lança `RangeError` se o preço for negativo ou se o resultado não for um inteiro seguro
 * (os catálogos já filtram antes; esta é a última barreira antes de qualquer soma).
 */
export function usdPerMTokToPUsdPerToken(usdPerMTok: number): number {
  const pUsd = Math.round(usdPerMTok * 1_000_000);
  if (usdPerMTok < 0 || pUsd < 0 || !Number.isSafeInteger(pUsd)) {
    throw new RangeError(`preço inválido: ${String(usdPerMTok)} US$ por milhão de tokens`);
  }
  return pUsd;
}

function nonNegativeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Custo exato de uma resposta, com a faixa de preço certa e o cache separado (seção 8.1). */
export function computeCost(usage: NormalizedUsage, card: ModelCard): CostBreakdown {
  const input = nonNegativeInt(usage.inputTokens);
  let cacheRead = nonNegativeInt(usage.cacheReadTokens);
  let write5m = nonNegativeInt(usage.cacheWrite5mTokens);
  let write1h = nonNegativeInt(usage.cacheWrite1hTokens);
  const output = nonNegativeInt(usage.outputTokens);

  let adjusted =
    input !== usage.inputTokens ||
    cacheRead !== usage.cacheReadTokens ||
    write5m !== usage.cacheWrite5mTokens ||
    write1h !== usage.cacheWrite1hTokens ||
    output !== usage.outputTokens;

  // Cache maior que a entrada: corta na ordem leitura → escrita 5 min → escrita 1 h e registra o ajuste.
  if (cacheRead + write5m + write1h > input) {
    adjusted = true;
    cacheRead = Math.min(cacheRead, input);
    write5m = Math.min(write5m, input - cacheRead);
    write1h = Math.min(write1h, input - cacheRead - write5m);
  }

  const price = priceAt(card.price, card.capabilities.cache, input);
  const uncached = input - cacheRead - write5m - write1h;
  const uncachedInputPUsd = uncached * usdPerMTokToPUsdPerToken(price.inputPerMTok);
  const cacheReadPUsd = cacheRead * usdPerMTokToPUsdPerToken(price.cacheReadPerMTok);
  const cacheWritePUsd =
    write5m * usdPerMTokToPUsdPerToken(price.cacheWrite5mPerMTok) + write1h * usdPerMTokToPUsdPerToken(price.cacheWrite1hPerMTok);
  const outputPUsd = output * usdPerMTokToPUsdPerToken(price.outputPerMTok);

  return {
    totalPUsd: uncachedInputPUsd + cacheReadPUsd + cacheWritePUsd + outputPUsd,
    uncachedInputPUsd,
    cacheReadPUsd,
    cacheWritePUsd,
    outputPUsd,
    tierStart: price.tierStart,
    adjusted,
  };
}

export const P_USD_PER_USD = 1_000_000_000_000;

export function pUsdToUsd(pUsd: number): number {
  return pUsd / P_USD_PER_USD;
}
