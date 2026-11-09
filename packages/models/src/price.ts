import type { CacheMode, ModelPrice } from './types';

/** Componentes de preço de uma faixa (ou do preço base). */
interface PriceComponents {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number | undefined;
  cacheWrite5mPerMTok?: number | undefined;
  cacheWrite1hPerMTok?: number | undefined;
}

/** Preços já resolvidos (sem campos opcionais), em US$ por milhão de tokens. */
export interface ResolvedPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  /** Início da faixa aplicada; 0 = preço base. */
  tierStart: number;
}

/**
 * Preço que vale para uma requisição com `inputTokens` de entrada.
 * A faixa aplicada é a última cujo `aboveInputTokens` é menor que a entrada, e vale para a requisição inteira
 * (docs/rascunhos/algoritmo-contexto.md, seção 8.1). Componentes ausentes usam o padrão pessimista.
 */
export function priceAt(price: ModelPrice, cache: CacheMode, inputTokens: number): ResolvedPrice {
  let base: PriceComponents = price;
  let tierStart = 0;
  for (const tier of price.tiers ?? []) {
    if (tier.aboveInputTokens < inputTokens) {
      base = tier;
      tierStart = tier.aboveInputTokens;
    }
  }
  const input = base.inputPerMTok;
  const explicit = cache === 'explicit';
  return {
    inputPerMTok: input,
    outputPerMTok: base.outputPerMTok,
    cacheReadPerMTok: base.cacheReadPerMTok ?? input,
    cacheWrite5mPerMTok: base.cacheWrite5mPerMTok ?? (explicit ? 1.25 * input : input),
    cacheWrite1hPerMTok: base.cacheWrite1hPerMTok ?? (explicit ? 2 * input : input),
    tierStart,
  };
}

/** Início das faixas de preço, em ordem crescente (ex.: [100.000] no Claude Haiku 5.5). */
export function priceTierStarts(price: ModelPrice): readonly number[] {
  return (price.tiers ?? []).map((tier) => tier.aboveInputTokens);
}
