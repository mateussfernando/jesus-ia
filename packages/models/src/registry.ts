import { curatedCatalog, fallbackModelCard } from './catalog';
import { modelCardSchema, providerIdSchema } from './types';
import type { ModelCard, ModelKey, ProviderId } from './types';

export interface ParsedModelKey {
  provider: ProviderId;
  modelId: string;
}

/** Separa a chave só no primeiro ':' ('ollama:qwen3-embedding:0.6b' → ollama + 'qwen3-embedding:0.6b'). */
export function parseModelKey(key: string): ParsedModelKey | null {
  const at = key.indexOf(':');
  if (at <= 0 || at === key.length - 1) return null;
  const provider = providerIdSchema.safeParse(key.slice(0, at));
  if (!provider.success) return null;
  return { provider: provider.data, modelId: key.slice(at + 1) };
}

export function isModelKey(key: string): key is ModelKey {
  return parseModelKey(key) !== null;
}

/** Valida a tabela curada inteira (usado nos testes e na abertura do app). Lança na primeira linha inválida. */
export function validateCatalog(catalog: readonly ModelCard[]): readonly ModelCard[] {
  const seen = new Set<string>();
  for (const card of catalog) {
    modelCardSchema.parse(card);
    if (seen.has(card.key)) throw new Error(`modelo repetido no catálogo: ${card.key}`);
    if (card.key !== `${card.provider}:${card.modelId}`) throw new Error(`chave incoerente: ${card.key}`);
    seen.add(card.key);
  }
  return catalog;
}

/**
 * Cartão do modelo: o curado, se existir; senão o conservador (janela pequena, preço pessimista, sem ferramentas).
 * Chave inválida devolve `null` (o chamador decide: na dúvida, não usa o modelo).
 */
export function getModelCard(key: string, catalog: readonly ModelCard[] = curatedCatalog): ModelCard | null {
  const parsed = parseModelKey(key);
  if (parsed === null) return null;
  const curated = catalog.find((card) => card.key === key);
  if (curated !== undefined) return curated;
  return fallbackModelCard(key as ModelKey, parsed.provider, parsed.modelId);
}
