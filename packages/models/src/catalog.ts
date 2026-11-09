import type { ModelCard, ModelKey, ProviderId } from './types';

/**
 * Tabela curada (docs/rascunhos/algoritmo-contexto.md, seção 3.4), revisada em PR.
 *
 * Claude 5.5: preços conferidos em 08/10/2026 na página oficial
 * (https://platform.claude.com/docs/en/about-claude/pricing). Janela de 1 milhão e saída máxima de 128 mil
 * (referência da Anthropic). A leitura de cache do Sonnet 5.5 é US$ 0,10 (0,05 × a entrada), não 0,20
 * como estava no rascunho.
 */

const ANTHROPIC_PRICING = 'https://platform.claude.com/docs/en/about-claude/pricing';

export const curatedCatalog: readonly ModelCard[] = [
  {
    key: 'anthropic:claude-haiku-5-5',
    provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    displayName: 'Claude Haiku 5.5',
    kind: 'chat',
    contextWindow: 1_000_000,
    windowIncludesOutput: true,
    maxOutputTokens: 128_000,
    price: {
      currency: 'USD',
      inputPerMTok: 0.1,
      cacheWrite5mPerMTok: 0.125,
      cacheWrite1hPerMTok: 0.2,
      cacheReadPerMTok: 0.01,
      outputPerMTok: 0.5,
      // Pedidos acima de 100 mil tokens pagam 5× (a faixa vale para a requisição inteira).
      tiers: [
        {
          aboveInputTokens: 100_000,
          inputPerMTok: 0.5,
          cacheWrite5mPerMTok: 0.625,
          cacheWrite1hPerMTok: 1,
          cacheReadPerMTok: 0.05,
          outputPerMTok: 2.5,
        },
      ],
      confidence: 'verified',
    },
    capabilities: { tools: true, vision: true, structuredOutput: true, reasoning: 'optional', cache: 'explicit' },
    tokenizer: 'claude',
    trustTier: 'basic',
    flags: [],
    verifiedAt: '2026-10-08',
    sourceUrl: ANTHROPIC_PRICING,
  },
  {
    key: 'anthropic:claude-sonnet-5-5',
    provider: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    displayName: 'Claude Sonnet 5.5',
    kind: 'chat',
    contextWindow: 1_000_000,
    windowIncludesOutput: true,
    maxOutputTokens: 128_000,
    price: {
      currency: 'USD',
      inputPerMTok: 2,
      cacheWrite5mPerMTok: 2.5,
      cacheWrite1hPerMTok: 4,
      cacheReadPerMTok: 0.1,
      outputPerMTok: 10,
      confidence: 'verified',
    },
    capabilities: { tools: true, vision: true, structuredOutput: true, reasoning: 'optional', cache: 'explicit' },
    tokenizer: 'claude',
    trustTier: 'frontier',
    flags: [],
    verifiedAt: '2026-10-08',
    sourceUrl: ANTHROPIC_PRICING,
  },
  {
    key: 'anthropic:claude-opus-5-5',
    provider: 'anthropic',
    modelId: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    kind: 'chat',
    contextWindow: 1_000_000,
    windowIncludesOutput: true,
    maxOutputTokens: 128_000,
    price: {
      currency: 'USD',
      inputPerMTok: 4,
      cacheWrite5mPerMTok: 5,
      cacheWrite1hPerMTok: 8,
      cacheReadPerMTok: 0.2,
      outputPerMTok: 20,
      confidence: 'verified',
    },
    // O raciocínio do Opus 5.5 não pode ser desligado.
    capabilities: { tools: true, vision: true, structuredOutput: true, reasoning: 'always', cache: 'explicit' },
    tokenizer: 'claude',
    trustTier: 'frontier',
    flags: [],
    verifiedAt: '2026-10-08',
    sourceUrl: ANTHROPIC_PRICING,
  },
];

// --- Modelo desconhecido: valores conservadores (seção 3.5) -------------------------------------

export const FALLBACK_CONTEXT_WINDOW = 32_768;
export const FALLBACK_MAX_OUTPUT = 4_096;

/** Preço pessimista: o anel de gasto superestima, nunca subestima. */
export const UNKNOWN_CLOUD_PRICE = {
  inputPerMTok: 15,
  outputPerMTok: 75,
  cacheReadPerMTok: 15,
  cacheWrite5mPerMTok: 18.75,
  cacheWrite1hPerMTok: 30,
} as const;

const LOCAL_PROVIDERS: readonly ProviderId[] = ['ollama', 'lmstudio'];

/** Cartão conservador para um modelo fora da tabela: sem ferramentas até alguém confirmar. */
export function fallbackModelCard(key: ModelKey, provider: ProviderId, modelId: string): ModelCard {
  const local = LOCAL_PROVIDERS.includes(provider);
  return {
    key,
    provider,
    modelId,
    displayName: modelId.slice(0, 80) || 'modelo desconhecido',
    kind: 'chat',
    contextWindow: FALLBACK_CONTEXT_WINDOW,
    windowIncludesOutput: true,
    maxOutputTokens: FALLBACK_MAX_OUTPUT,
    price: local
      ? { currency: 'USD', inputPerMTok: 0, outputPerMTok: 0, confidence: 'free_local' }
      : { currency: 'USD', ...UNKNOWN_CLOUD_PRICE, confidence: 'unknown_pessimistic' },
    capabilities: { tools: false, vision: false, structuredOutput: false, reasoning: 'none', cache: 'none' },
    tokenizer: 'unknown',
    trustTier: 'unrated',
    flags: ['unknown_model'],
    verifiedAt: '1970-01-01',
  };
}
