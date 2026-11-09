import { z } from 'zod';

/**
 * Tipos do registro de modelos (docs/rascunhos/algoritmo-contexto.md, seção 3.1).
 * A tabela curada é validada com Zod estrito; nada daqui entra no contexto de um modelo.
 */

export const providerIds = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'groq',
  'deepseek',
  'xai',
  'openrouter',
  'fireworks',
  'deepinfra',
  'ollama',
  'lmstudio',
] as const;
export const providerIdSchema = z.enum(providerIds);
export type ProviderId = z.infer<typeof providerIdSchema>;

/** Ex.: 'anthropic:claude-haiku-5-5'. Separa-se só no primeiro ':' (ver `parseModelKey`). */
export type ModelKey = `${ProviderId}:${string}`;

export const tokenizerFamilies = ['claude', 'openai_o200k', 'deepseek', 'gemini', 'llama', 'qwen', 'mistral', 'unknown'] as const;
export type TokenizerFamily = (typeof tokenizerFamilies)[number];

export type TrustTier = 'frontier' | 'strong' | 'basic' | 'unrated';
export type CacheMode = 'none' | 'automatic' | 'explicit';
export type ReasoningMode = 'none' | 'optional' | 'always';
export type ModelFlag = 'unknown_model' | 'deprecated';
export type PriceConfidence = 'verified' | 'secondary' | 'conflicting' | 'unknown_pessimistic' | 'free_local';

/** Sanidade: faixas aceitas para qualquer número de catálogo. */
export const SANITY = {
  minWindow: 1_024,
  maxWindow: 10_000_000,
  minOutput: 256,
  maxOutput: 1_000_000,
  maxPricePerMTok: 1_000,
} as const;

const pricePerMTok = z.number().finite().min(0).max(SANITY.maxPricePerMTok);

const priceComponentsShape = {
  /** US$ por milhão de tokens de entrada sem cache. */
  inputPerMTok: pricePerMTok,
  outputPerMTok: pricePerMTok,
  /** Ausente → preço de entrada (pessimista). */
  cacheReadPerMTok: pricePerMTok.optional(),
  /** Ausente → 1,25 × entrada se o cache for explícito; senão, entrada. */
  cacheWrite5mPerMTok: pricePerMTok.optional(),
  /** Ausente → 2 × entrada se o cache for explícito; senão, entrada. */
  cacheWrite1hPerMTok: pricePerMTok.optional(),
};

export const priceTierSchema = z
  .object({
    ...priceComponentsShape,
    /** A faixa vale para a requisição inteira quando a entrada passa deste número de tokens. */
    aboveInputTokens: z.number().int().positive(),
  })
  .strict();
export type PriceTier = z.infer<typeof priceTierSchema>;

export const modelPriceSchema = z
  .object({
    ...priceComponentsShape,
    currency: z.literal('USD'),
    tiers: z.array(priceTierSchema).optional(),
    confidence: z.enum(['verified', 'secondary', 'conflicting', 'unknown_pessimistic', 'free_local']),
  })
  .strict()
  .refine(
    (price) => (price.tiers ?? []).every((tier, i, all) => i === 0 || (all[i - 1]?.aboveInputTokens ?? 0) < tier.aboveInputTokens),
    { message: 'faixas de preço precisam estar em ordem crescente' },
  );
export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const modelCapabilitiesSchema = z
  .object({
    tools: z.boolean(),
    vision: z.boolean(),
    structuredOutput: z.boolean(),
    reasoning: z.enum(['none', 'optional', 'always']),
    cache: z.enum(['none', 'automatic', 'explicit']),
  })
  .strict();
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const modelCardSchema = z
  .object({
    key: z.string().regex(/^[a-z]+:.+$/) as z.ZodType<ModelKey>,
    provider: providerIdSchema,
    modelId: z.string().min(1).max(200),
    /** Só para a interface; nunca entra num prompt. */
    displayName: z.string().min(1).max(80),
    kind: z.enum(['chat', 'embedding']),
    /** Janela total de contexto, em tokens. */
    contextWindow: z.number().int().min(SANITY.minWindow).max(SANITY.maxWindow),
    /** Quando o provedor informa um limite de entrada à parte. */
    maxInputTokens: z.number().int().min(SANITY.minWindow).max(SANITY.maxWindow).optional(),
    /** A saída conta dentro da janela? */
    windowIncludesOutput: z.boolean(),
    maxOutputTokens: z.number().int().min(SANITY.minOutput).max(SANITY.maxOutput),
    /** Teto de qualidade curado (opcional): acima disso a atenção piora. */
    qualityContextCap: z.number().int().positive().optional(),
    price: modelPriceSchema,
    capabilities: modelCapabilitiesSchema,
    tokenizer: z.enum(tokenizerFamilies),
    trustTier: z.enum(['frontier', 'strong', 'basic', 'unrated']),
    flags: z.array(z.enum(['unknown_model', 'deprecated'])),
    /** AAAA-MM-DD da última conferência na fonte. */
    verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sourceUrl: z.string().url().optional(),
  })
  .strict()
  .refine((card) => card.maxOutputTokens <= card.contextWindow, { message: 'saída máxima maior que a janela' });
export type ModelCard = z.infer<typeof modelCardSchema>;
