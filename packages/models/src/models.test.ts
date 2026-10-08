import { describe, expect, it } from 'vitest';
import { curatedCatalog, FALLBACK_CONTEXT_WINDOW } from './catalog';
import { computeCost, pUsdToUsd } from './cost';
import { priceAt } from './price';
import { getModelCard, parseModelKey, validateCatalog } from './registry';
import { countCharClasses, estimateMessagesTokens, estimateTextTokens } from './tokens';
import type { ModelCard } from './types';

function card(key: string): ModelCard {
  const found = getModelCard(key);
  if (found === null) throw new Error(`sem cartão: ${key}`);
  return found;
}

const usage = (input: number, output: number, extra: Partial<{ read: number; w5: number; w1: number }> = {}) => ({
  inputTokens: input,
  cacheReadTokens: extra.read ?? 0,
  cacheWrite5mTokens: extra.w5 ?? 0,
  cacheWrite1hTokens: extra.w1 ?? 0,
  outputTokens: output,
});

describe('catálogo curado', () => {
  it('passa na validação estrita (Zod), sem chaves repetidas', () => {
    expect(() => validateCatalog(curatedCatalog)).not.toThrow();
  });

  it('rejeita cartão com campo desconhecido ou número fora da faixa', () => {
    const haiku = card('anthropic:claude-haiku-5-5');
    expect(() => validateCatalog([{ ...haiku, extra: 1 } as unknown as ModelCard])).toThrow();
    expect(() => validateCatalog([{ ...haiku, contextWindow: 100 }])).toThrow();
    expect(() => validateCatalog([haiku, haiku])).toThrow();
  });

  it('Claude Haiku 5.5: preços oficiais e degrau acima de 100 mil tokens', () => {
    const haiku = card('anthropic:claude-haiku-5-5');
    expect(haiku.contextWindow).toBe(1_000_000);
    expect(haiku.price.inputPerMTok).toBe(0.1);
    expect(haiku.price.cacheReadPerMTok).toBe(0.01);
    expect(haiku.price.outputPerMTok).toBe(0.5);
    expect(haiku.price.tiers?.[0]?.aboveInputTokens).toBe(100_000);
  });

  it('Claude Sonnet 5.5: leitura de cache é 0,05 × a entrada (US$ 0,10)', () => {
    expect(card('anthropic:claude-sonnet-5-5').price.cacheReadPerMTok).toBe(0.1);
  });
});

describe('registro', () => {
  it('separa a chave só no primeiro ":"', () => {
    expect(parseModelKey('ollama:qwen3-embedding:0.6b')).toEqual({ provider: 'ollama', modelId: 'qwen3-embedding:0.6b' });
    expect(parseModelKey('sem-provedor')).toBeNull();
    expect(parseModelKey('desconhecido:modelo')).toBeNull();
    expect(parseModelKey('anthropic:')).toBeNull();
  });

  it('modelo fora da tabela recebe o cartão conservador', () => {
    const unknown = card('openai:modelo-novo');
    expect(unknown.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW);
    expect(unknown.capabilities.tools).toBe(false);
    expect(unknown.flags).toContain('unknown_model');
    expect(unknown.price.confidence).toBe('unknown_pessimistic');
    expect(unknown.price.inputPerMTok).toBeGreaterThan(card('anthropic:claude-opus-5-5').price.inputPerMTok);
  });

  it('modelo local desconhecido é gratuito', () => {
    expect(card('ollama:llama3.1:8b').price.confidence).toBe('free_local');
    expect(card('ollama:llama3.1:8b').price.inputPerMTok).toBe(0);
  });

  it('chave inválida não vira cartão', () => {
    expect(getModelCard('qualquer coisa')).toBeNull();
  });
});

describe('preço por faixa', () => {
  it('a faixa vale só acima do limite, para a requisição inteira', () => {
    const haiku = card('anthropic:claude-haiku-5-5');
    expect(priceAt(haiku.price, 'explicit', 100_000).inputPerMTok).toBe(0.1);
    expect(priceAt(haiku.price, 'explicit', 100_001).inputPerMTok).toBe(0.5);
    expect(priceAt(haiku.price, 'explicit', 100_001).tierStart).toBe(100_000);
  });

  it('componente ausente usa o padrão pessimista', () => {
    const price = { currency: 'USD' as const, inputPerMTok: 2, outputPerMTok: 8, confidence: 'secondary' as const };
    expect(priceAt(price, 'explicit', 10).cacheWrite5mPerMTok).toBe(2.5);
    expect(priceAt(price, 'explicit', 10).cacheWrite1hPerMTok).toBe(4);
    expect(priceAt(price, 'automatic', 10).cacheReadPerMTok).toBe(2);
  });
});

describe('custo exato (picodólares)', () => {
  it('Haiku 5.5: 150 mil de entrada sem cache e mil de saída cai na faixa de cima', () => {
    const cost = computeCost(usage(150_000, 1_000), card('anthropic:claude-haiku-5-5'));
    expect(cost.totalPUsd).toBe(77_500_000_000);
    expect(pUsdToUsd(cost.totalPUsd)).toBeCloseTo(0.0775, 10);
    expect(cost.tierStart).toBe(100_000);
  });

  it('Opus 5.5: 10 mil tokens gravados no cache de 1 h custam US$ 0,08', () => {
    const cost = computeCost(usage(10_000, 0, { w1: 10_000 }), card('anthropic:claude-opus-5-5'));
    expect(cost.totalPUsd).toBe(80_000_000_000);
  });

  it('cache lido custa 10% no Haiku 5.5', () => {
    const haiku = card('anthropic:claude-haiku-5-5');
    const cached = computeCost(usage(20_000, 0, { read: 20_000 }), haiku).totalPUsd;
    const fresh = computeCost(usage(20_000, 0), haiku).totalPUsd;
    expect(cached * 10).toBe(fresh);
  });

  it('uso inconsistente é ajustado, nunca fica grátis nem negativo', () => {
    const haiku = card('anthropic:claude-haiku-5-5');
    const cost = computeCost(usage(1_000, -5, { read: 5_000 }), haiku);
    expect(cost.adjusted).toBe(true);
    expect(cost.totalPUsd).toBeGreaterThan(0);
    expect(cost.outputPUsd).toBe(0);
  });
});

describe('estimativa de tokens', () => {
  it('classifica os caracteres', () => {
    expect(countCharClasses('Marquei dentista sexta, dia 9, às 15h.')).toEqual({ word: 34, accent: 1, punct: 3, cjk: 0, other: 0 });
  });

  it('bate com os exemplos da especificação', () => {
    expect(estimateTextTokens('Marquei dentista sexta, dia 9, às 15h.', 'openai_o200k')).toBe(11);
    expect(estimateTextTokens('你好世界', 'deepseek')).toBe(3);
    expect(estimateTextTokens('', 'claude')).toBe(0);
  });

  it('tokenizador desconhecido estima para cima', () => {
    const text = 'Resume meus e-mails de hoje, por favor.';
    expect(estimateTextTokens(text, 'unknown')).toBeGreaterThanOrEqual(estimateTextTokens(text, 'claude'));
  });

  it('cada mensagem soma um custo fixo', () => {
    expect(estimateMessagesTokens(['', ''], 'claude')).toBe(8);
  });
});
