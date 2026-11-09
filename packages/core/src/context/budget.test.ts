import { getModelCard } from '@jesus/models';
import type { ModelCard } from '@jesus/models';
import { describe, expect, it } from 'vitest';
import {
  computeContextBudget,
  computeOutputReserve,
  MIN_OPERATIONAL_CAP,
  pressureBand,
  QUALITY_CAP_DEFAULT,
  toHologramContext,
} from './budget';
import type { ContextBudgetInput } from './budget';
import { describeContextBudget } from './describe';

function card(key: string): ModelCard {
  const found = getModelCard(key);
  if (found === null) throw new Error(`sem cartão: ${key}`);
  return found;
}

const HAIKU = card('anthropic:claude-haiku-5-5');
const SONNET = card('anthropic:claude-sonnet-5-5');
const OPUS = card('anthropic:claude-opus-5-5');

/** Cenário da especificação: parte fixa de 10 mil, US$ 5 por dia, nada gasto. */
function budget(model: ModelCard, extra: Partial<ContextBudgetInput> = {}) {
  return computeContextBudget({ card: model, fixedTokens: 10_000, spend: { dailyLimitUsd: 5, spentTodayUsd: 0 }, ...extra });
}

describe('limite automático por modelo (exemplos da seção 4.4)', () => {
  it('janela de 1 milhão vira teto técnico de 879.301 (reserva de 32.768 e margem de 10%)', () => {
    expect(budget(HAIKU).inputMax).toBe(879_301);
    expect(budget(HAIKU).outputReserve).toBe(32_768);
  });

  it('Claude Haiku 5.5: fica abaixo do degrau de preço dos 100 mil → limite de 80 mil', () => {
    const b = budget(HAIKU);
    expect(b.operationalCap).toBe(90_000);
    expect(b.capReason).toBe('price_tier');
    expect(b.priceTierStart).toBe(100_000);
    expect(b.limit).toBe(80_000);
  });

  it('Claude Opus 5.5 com US$ 5 por dia: pressão alta → ponto ótimo de compactação (73.705)', () => {
    const b = budget(OPUS);
    expect(b.pressureBand).toBe(2);
    expect(b.capReason).toBe('cost');
    expect(b.operationalCap).toBe(73_705);
    expect(b.limit).toBe(63_705);
  });

  it('Sonnet 5.5 custa metade do Opus em tudo: o ponto ótimo é o mesmo', () => {
    expect(budget(SONNET).operationalCap).toBe(budget(OPUS).operationalCap);
  });

  it('modo "max" usa a janela inteira', () => {
    const b = budget(OPUS, { mode: 'max' });
    expect(b.capReason).toBe('technical');
    expect(b.limit).toBe(869_301);
  });

  it('modo "economia" força a pressão máxima', () => {
    const b = budget(HAIKU, { mode: 'economy' });
    expect(b.pressureBand).toBe(2);
    expect(b.limit).toBeLessThan(budget(HAIKU).limit);
    expect(b.operationalCap).toBeGreaterThanOrEqual(MIN_OPERATIONAL_CAP);
  });

  it('orçamento folgado: só o teto de qualidade vale', () => {
    const b = budget(OPUS, { spend: { dailyLimitUsd: 1_000, spentTodayUsd: 0 } });
    expect(b.capReason).toBe('quality');
    expect(b.operationalCap).toBe(QUALITY_CAP_DEFAULT);
  });

  it('teto do usuário vence quando é o menor', () => {
    const b = budget(HAIKU, { userCap: 32_000 });
    expect(b.capReason).toBe('user');
    expect(b.limit).toBe(22_000);
  });

  it('modelo desconhecido: janela conservadora, limite pela janela', () => {
    const b = budget(card('openai:modelo-novo'));
    expect(b.capReason).toBe('technical');
    expect(b.marginRatio).toBe(0.15);
    expect(b.limit).toBeLessThan(32_768);
  });
});

describe('estabilidade e segurança dos números', () => {
  it('gastar mais nunca aumenta o limite', () => {
    for (const model of [HAIKU, SONNET, OPUS]) {
      let previous = Infinity;
      for (const spent of [0, 1, 2, 3, 4, 4.5, 5, 6]) {
        const limit = budget(model, { spend: { dailyLimitUsd: 5, spentTodayUsd: spent } }).limit;
        expect(limit).toBeLessThanOrEqual(previous);
        previous = limit;
      }
    }
  });

  it('no mesmo dia a banda só sobe', () => {
    const relaxed = budget(HAIKU, { spend: { dailyLimitUsd: 1_000, spentTodayUsd: 0 } });
    const sticky = budget(HAIKU, { spend: { dailyLimitUsd: 1_000, spentTodayUsd: 0 }, previousBand: 2 });
    expect(sticky.pressureBand).toBe(2);
    expect(sticky.limit).toBeLessThan(relaxed.limit);
  });

  it('o limite nunca passa do teto técnico nem fica negativo', () => {
    const tiny = budget(card('openai:modelo-novo'), { fixedTokens: 1_000_000 });
    expect(tiny.limit).toBe(0);
    expect(tiny.technicalLimit).toBe(0);
    expect(budget(OPUS, { mode: 'max', userCap: 5_000_000 }).operationalCap).toBe(879_301);
  });

  it('bandas de pressão: até 50%, até 90%, acima', () => {
    expect(pressureBand(0.5)).toBe(0);
    expect(pressureBand(0.51)).toBe(1);
    expect(pressureBand(0.9)).toBe(2);
    expect(pressureBand(Number.NaN)).toBe(0);
  });

  it('reserva de saída respeita o modelo e o papel', () => {
    expect(computeOutputReserve(HAIKU, 'brain', false)).toBe(16_384);
    expect(computeOutputReserve(OPUS, 'brain', false)).toBe(32_768); // o raciocínio do Opus não desliga
    expect(computeOutputReserve(HAIKU, 'gate', true)).toBe(2_048);
    expect(computeOutputReserve(card('openai:modelo-novo'), 'brain', true)).toBe(4_096);
  });
});

describe('holograma e texto', () => {
  it('o snapshot recebe o limite automático e o uso limitado a ele', () => {
    const b = budget(HAIKU);
    expect(toHologramContext(b, 120_000)).toEqual({ usedTokens: 80_000, limitTokens: 80_000 });
    expect(toHologramContext(b, -3)).toEqual({ usedTokens: 0, limitTokens: 80_000 });
    expect(toHologramContext({ ...b, limit: 0 }, 10).limitTokens).toBe(1);
  });

  it('explica em pt-BR por que o limite é esse', () => {
    const text = describeContextBudget(budget(HAIKU), HAIKU);
    expect(text).toContain('Limite automático: 80 mil tokens');
    expect(text).toContain('Claude Haiku 5.5');
    expect(text).toContain('degrau de preço');
  });
});
