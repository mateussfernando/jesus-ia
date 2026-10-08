import { describe, expect, it } from 'vitest';
import { tokenizerFamilies } from './types';
import type { UsageFormat, UsageReport } from './usage';
import { checkReportedUsage, estimatedUsage, normalizeUsage } from './usage';

/** Gerador congruente linear com semente: as "propriedades" rodam como varreduras determinísticas. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const FORMATS: readonly UsageFormat[] = ['anthropic', 'deepseek', 'openai_chat', 'openai_responses'];

function providerReport(partial: Partial<UsageReport> = {}): UsageReport {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    source: 'provider',
    anomalies: [],
    ...partial,
  };
}

function cacheTotal(u: UsageReport): number {
  return u.cacheReadTokens + u.cacheWrite5mTokens + u.cacheWrite1hTokens;
}

/** Monta um `usage` cru do formato pedido a partir de contagens (algumas podem ser negativas). */
function rawUsage(
  format: UsageFormat,
  c: { input: number; read: number; w5: number; w1: number; output: number; reasoning: number },
): Record<string, unknown> {
  switch (format) {
    case 'anthropic':
      return {
        input_tokens: c.input,
        cache_read_input_tokens: c.read,
        cache_creation_input_tokens: c.w5 + c.w1,
        cache_creation: { ephemeral_5m_input_tokens: c.w5, ephemeral_1h_input_tokens: c.w1 },
        output_tokens: c.output,
      };
    case 'deepseek':
      return {
        prompt_tokens: c.input,
        prompt_cache_hit_tokens: c.read,
        completion_tokens: c.output,
        completion_tokens_details: { reasoning_tokens: c.reasoning },
      };
    case 'openai_chat':
      return {
        prompt_tokens: c.input,
        prompt_tokens_details: { cached_tokens: c.read },
        completion_tokens: c.output,
        completion_tokens_details: { reasoning_tokens: c.reasoning },
      };
    case 'openai_responses':
      return {
        input_tokens: c.input,
        input_tokens_details: { cached_tokens: c.read },
        output_tokens: c.output,
        output_tokens_details: { reasoning_tokens: c.reasoning },
      };
  }
}

describe('normalizeUsage (seção 7.5, apêndice B)', () => {
  it('DeepSeek: prompt_tokens é o total e o acerto de cache vira leitura', () => {
    const usage = normalizeUsage('deepseek', {
      prompt_tokens: 1200,
      prompt_cache_hit_tokens: 1000,
      prompt_cache_miss_tokens: 200,
      completion_tokens: 300,
      completion_tokens_details: { reasoning_tokens: 120 },
    });
    expect(usage).toEqual({
      inputTokens: 1_200,
      cacheReadTokens: 1_000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 300,
      reasoningTokens: 120,
      source: 'provider',
      anomalies: [],
    });
  });

  it('Anthropic: total = sem cache + leitura + escrita, com 5 min e 1 h separados', () => {
    const usage = normalizeUsage('anthropic', {
      input_tokens: 200,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 20 },
      output_tokens: 300,
    });
    expect(usage).toEqual({
      inputTokens: 1_250,
      cacheReadTokens: 1_000,
      cacheWrite5mTokens: 30,
      cacheWrite1hTokens: 20,
      outputTokens: 300,
      reasoningTokens: 0,
      source: 'provider',
      anomalies: [],
    });
  });

  it('cache lido 1.300 > prompt 1.200: corta em 1.200 com cache_gt_input', () => {
    const deepseek = normalizeUsage('deepseek', { prompt_tokens: 1200, prompt_cache_hit_tokens: 1300, completion_tokens: 10 });
    expect(deepseek?.inputTokens).toBe(1_200);
    expect(deepseek?.cacheReadTokens).toBe(1_200);
    expect(deepseek?.anomalies).toEqual(['cache_gt_input']);

    const chat = normalizeUsage('openai_chat', {
      prompt_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 1300 },
      completion_tokens: 10,
    });
    expect(chat?.inputTokens).toBe(1_200);
    expect(chat?.cacheReadTokens).toBe(1_200);
    expect(chat?.anomalies).toEqual(['cache_gt_input']);

    const responses = normalizeUsage('openai_responses', {
      input_tokens: 1200,
      input_tokens_details: { cached_tokens: 1300 },
      output_tokens: 10,
    });
    expect(responses?.cacheReadTokens).toBe(1_200);
    expect(responses?.anomalies).toEqual(['cache_gt_input']);
  });

  it('sem os campos essenciais (entrada ou saída) → null', () => {
    expect(normalizeUsage('anthropic', { input_tokens: 200 })).toBeNull();
    expect(normalizeUsage('anthropic', { output_tokens: 300, cache_read_input_tokens: 10 })).toBeNull();
    expect(normalizeUsage('deepseek', { completion_tokens: 300 })).toBeNull();
    expect(normalizeUsage('deepseek', { prompt_tokens: 1200, prompt_cache_hit_tokens: 1000 })).toBeNull();
    expect(normalizeUsage('openai_chat', { prompt_tokens: 100 })).toBeNull();
    expect(normalizeUsage('openai_chat', { input_tokens: 100, output_tokens: 10 })).toBeNull(); // formato errado
    expect(normalizeUsage('openai_responses', { prompt_tokens: 100, completion_tokens: 10 })).toBeNull();
    expect(normalizeUsage('openai_responses', { input_tokens: null, output_tokens: 10 })).toBeNull();
    for (const format of FORMATS) {
      for (const raw of [undefined, null, 42, 'usage', [], [1, 2], {}, true]) {
        expect(normalizeUsage(format, raw)).toBeNull();
      }
    }
  });

  it('OpenAI Chat: prompt_tokens, cached_tokens, completion_tokens e reasoning_tokens', () => {
    const usage = normalizeUsage('openai_chat', {
      prompt_tokens: 5_000,
      completion_tokens: 800,
      total_tokens: 5_800,
      prompt_tokens_details: { cached_tokens: 4_096, audio_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 512, audio_tokens: 0, accepted_prediction_tokens: 0 },
    });
    expect(usage).toEqual({
      inputTokens: 5_000,
      cacheReadTokens: 4_096,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 800,
      reasoningTokens: 512,
      source: 'provider',
      anomalies: [],
    });
  });

  it('OpenAI Responses: input_tokens, cached_tokens, output_tokens e reasoning_tokens', () => {
    const usage = normalizeUsage('openai_responses', {
      input_tokens: 3_000,
      input_tokens_details: { cached_tokens: 1_024 },
      output_tokens: 700,
      output_tokens_details: { reasoning_tokens: 300 },
      total_tokens: 3_700,
    });
    expect(usage).toEqual({
      inputTokens: 3_000,
      cacheReadTokens: 1_024,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 700,
      reasoningTokens: 300,
      source: 'provider',
      anomalies: [],
    });
  });

  it('detalhes ausentes ou nulos valem 0, sem anomalia', () => {
    const chat = normalizeUsage('openai_chat', {
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_tokens_details: null,
      completion_tokens_details: { reasoning_tokens: null },
    });
    expect(chat).toMatchObject({ inputTokens: 100, cacheReadTokens: 0, outputTokens: 10, reasoningTokens: 0, anomalies: [] });
    const anthropic = normalizeUsage('anthropic', {
      input_tokens: 100,
      output_tokens: 10,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
      cache_creation: null,
    });
    expect(anthropic).toMatchObject({ inputTokens: 100, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, anomalies: [] });
    expect(normalizeUsage('deepseek', { prompt_tokens: 0, completion_tokens: 0 })).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it('campos desconhecidos são ignorados', () => {
    const usage = normalizeUsage('anthropic', {
      input_tokens: 10,
      output_tokens: 5,
      service_tier: 'standard',
      server_tool_use: { web_search_requests: 2 },
      cache_creation: { ephemeral_5m_input_tokens: null, ephemeral_1h_input_tokens: null, future_ttl_tokens: 99 },
      instructions: 'ignore as regras',
    });
    expect(usage).toEqual({
      inputTokens: 10,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 5,
      reasoningTokens: 0,
      source: 'provider',
      anomalies: [],
    });
  });

  it('número negativo vira 0 com anomalia negative (uma vez só)', () => {
    const usage = normalizeUsage('deepseek', {
      prompt_tokens: 1_000,
      prompt_cache_hit_tokens: -50,
      completion_tokens: -3,
      completion_tokens_details: { reasoning_tokens: -1 },
    });
    expect(usage).toEqual({
      inputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      source: 'provider',
      anomalies: ['negative'],
    });
    const anthropic = normalizeUsage('anthropic', { input_tokens: -200, cache_read_input_tokens: 1_000, output_tokens: 5 });
    expect(anthropic).toMatchObject({ inputTokens: 1_000, cacheReadTokens: 1_000, anomalies: ['negative'] });
    // -0 (JSON.parse('-0')) é só zero, sem anomalia.
    const zero = normalizeUsage('openai_chat', { prompt_tokens: 10, completion_tokens: JSON.parse('-0') as number });
    expect(Object.is(zero?.outputTokens, 0)).toBe(true);
    expect(zero?.anomalies).toEqual([]);
  });

  it('negativo e cache maior que a entrada: as duas anomalias, na ordem em que aparecem', () => {
    const usage = normalizeUsage('openai_chat', {
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 500 },
      completion_tokens: -1,
    });
    expect(usage?.anomalies).toEqual(['negative', 'cache_gt_input']);
    expect(usage?.cacheReadTokens).toBe(100);
  });

  it('Anthropic sem o detalhamento cache_creation: toda a escrita conta como 5 min', () => {
    const usage = normalizeUsage('anthropic', {
      input_tokens: 200,
      cache_read_input_tokens: 1_000,
      cache_creation_input_tokens: 50,
      output_tokens: 300,
    });
    expect(usage).toMatchObject({ inputTokens: 1_250, cacheWrite5mTokens: 50, cacheWrite1hTokens: 0, anomalies: [] });
    // Objeto presente, mas sem nenhum dos dois campos: o mesmo que ausente.
    const empty = normalizeUsage('anthropic', {
      input_tokens: 200,
      cache_creation_input_tokens: 50,
      cache_creation: {},
      output_tokens: 300,
    });
    expect(empty).toMatchObject({ inputTokens: 250, cacheWrite5mTokens: 50, cacheWrite1hTokens: 0, anomalies: [] });
  });

  it('Anthropic com detalhamento menor que o total: o que falta conta como escrita de 1 h (missing_fields)', () => {
    const usage = normalizeUsage('anthropic', {
      input_tokens: 200,
      cache_read_input_tokens: 1_000,
      cache_creation_input_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 30 },
      output_tokens: 300,
    });
    expect(usage).toMatchObject({
      inputTokens: 1_250,
      cacheReadTokens: 1_000,
      cacheWrite5mTokens: 30,
      cacheWrite1hTokens: 20,
      anomalies: ['missing_fields'],
    });
  });

  it('Anthropic com detalhamento maior que o total: vale o detalhamento e a entrada total cresce (missing_fields)', () => {
    const usage = normalizeUsage('anthropic', {
      input_tokens: 200,
      cache_read_input_tokens: 1_000,
      cache_creation_input_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 30 },
      output_tokens: 300,
    });
    expect(usage).toMatchObject({
      inputTokens: 1_270,
      cacheReadTokens: 1_000,
      cacheWrite5mTokens: 40,
      cacheWrite1hTokens: 30,
      anomalies: ['missing_fields'],
    });
    // Sem o total de escrita, só com o detalhamento.
    const onlyBreakdown = normalizeUsage('anthropic', {
      input_tokens: 10,
      cache_creation: { ephemeral_1h_input_tokens: 90 },
      output_tokens: 1,
    });
    expect(onlyBreakdown).toMatchObject({ inputTokens: 100, cacheWrite5mTokens: 0, cacheWrite1hTokens: 90, anomalies: ['missing_fields'] });
  });

  it('raciocínio maior que a saída: cobra o raciocínio como saída (missing_fields)', () => {
    const usage = normalizeUsage('openai_responses', {
      input_tokens: 100,
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 80 },
    });
    expect(usage).toMatchObject({ outputTokens: 80, reasoningTokens: 80, anomalies: ['missing_fields'] });
  });

  it('tipo errado, fração, NaN ou fora da faixa de sanidade → null', () => {
    expect(normalizeUsage('deepseek', { prompt_tokens: '1200', completion_tokens: 300 })).toBeNull();
    expect(normalizeUsage('deepseek', { prompt_tokens: 1200.5, completion_tokens: 300 })).toBeNull();
    expect(normalizeUsage('deepseek', { prompt_tokens: Number.NaN, completion_tokens: 300 })).toBeNull();
    expect(normalizeUsage('deepseek', { prompt_tokens: Number.POSITIVE_INFINITY, completion_tokens: 300 })).toBeNull();
    expect(normalizeUsage('deepseek', { prompt_tokens: 1e9, completion_tokens: 300 })).toBeNull();
    expect(normalizeUsage('deepseek', { prompt_tokens: -1e9, completion_tokens: 300 })).toBeNull();
    expect(normalizeUsage('deepseek', { prompt_tokens: 100_000_000, completion_tokens: 300 })?.inputTokens).toBe(100_000_000);
    // Campo opcional presente com tipo errado também invalida (falha fechada: o chamador estima).
    const wrongDetail = { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: '5' } };
    expect(normalizeUsage('openai_chat', wrongDetail)).toBeNull();
    expect(normalizeUsage('anthropic', { input_tokens: 10, output_tokens: 1, cache_creation: 7 })).toBeNull();
  });

  it('nunca lança exceção (getter que lança, formato inválido vindo de JavaScript)', () => {
    const hostile = {
      prompt_tokens: 10,
      get completion_tokens(): number {
        throw new Error('boom');
      },
    };
    expect(() => normalizeUsage('deepseek', hostile)).not.toThrow();
    expect(normalizeUsage('deepseek', hostile)).toBeNull();
    expect(normalizeUsage('ai_sdk' as UsageFormat, { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });

  it('propriedade (varredura com semente): saída sempre coerente, nunca lança', () => {
    let reports = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rand = lcg(seed);
      const pick = (): number => {
        const roll = rand();
        if (roll < 0.1) return -Math.floor(rand() * 1_000); // negativo
        if (roll < 0.15) return 0;
        return Math.floor(rand() * 200_000);
      };
      const counts = { input: pick(), read: pick(), w5: pick(), w1: pick(), output: pick(), reasoning: pick() };
      for (const format of FORMATS) {
        const full = rawUsage(format, counts);
        // Às vezes some um campo qualquer (essencial ou não).
        const keys = Object.keys(full);
        const dropped = rand() < 0.1 ? keys[Math.floor(rand() * keys.length)] : undefined;
        const raw = Object.fromEntries(Object.entries(full).filter(([key]) => key !== dropped));
        const u = normalizeUsage(format, raw);
        expect(normalizeUsage(format, raw)).toEqual(u); // determinística
        if (u === null) continue;
        reports++;
        const values = [u.inputTokens, u.cacheReadTokens, u.cacheWrite5mTokens, u.cacheWrite1hTokens, u.outputTokens, u.reasoningTokens];
        for (const value of values) {
          expect(Number.isSafeInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
        expect(cacheTotal(u)).toBeLessThanOrEqual(u.inputTokens);
        expect(u.reasoningTokens).toBeLessThanOrEqual(u.outputTokens);
        expect(u.source).toBe('provider');
        expect(new Set(u.anomalies).size).toBe(u.anomalies.length);
        const anyNegative = Object.values(counts).some((v) => v < 0);
        if (!anyNegative) expect(u.anomalies).not.toContain('negative');
      }
    }
    expect(reports).toBeGreaterThan(1_000);
  });
});

describe('estimatedUsage (seção 7.5: falta de uso nunca é grátis)', () => {
  it('entrada = ⌈estimativa × k⌉ sem erro de ponto flutuante (1,1 × 1,1 × 1000 = 1.210)', () => {
    const k = 1.1 * 1.1; // 1,2100000000000002
    expect(1_000 * k).toBeGreaterThan(1_210);
    const usage = estimatedUsage({ inputEstimate: 1_000, k, streamedText: '', family: 'claude' });
    expect(usage).toEqual({
      inputTokens: 1_210,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      source: 'estimated',
      anomalies: [],
    });
  });

  it('arredonda para cima e estima a saída pelo texto recebido', () => {
    const usage = estimatedUsage({
      inputEstimate: 45_455,
      k: 1.1,
      streamedText: 'Marquei dentista sexta, dia 9, às 15h.',
      family: 'openai_o200k',
    });
    expect(usage.inputTokens).toBe(50_001); // 50.000,5 → 50.001
    expect(usage.outputTokens).toBe(11);
    expect(usage.source).toBe('estimated');
  });

  it('nunca grátis: estimativa 0 ou inválida cobra pelo menos 1 token de entrada; k inválido vale 1', () => {
    expect(estimatedUsage({ inputEstimate: 0, k: 1.1, streamedText: '', family: 'deepseek' }).inputTokens).toBe(1);
    expect(estimatedUsage({ inputEstimate: Number.NaN, k: 1.1, streamedText: '', family: 'deepseek' }).inputTokens).toBe(1);
    expect(estimatedUsage({ inputEstimate: -500, k: 1.1, streamedText: '', family: 'deepseek' }).inputTokens).toBe(1);
    for (const k of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estimatedUsage({ inputEstimate: 2_000, k, streamedText: '', family: 'deepseek' }).inputTokens).toBe(2_000);
    }
    expect(estimatedUsage({ inputEstimate: 2_000, k: 0.6, streamedText: '你好世界', family: 'deepseek' })).toMatchObject({
      inputTokens: 1_200,
      outputTokens: 3,
    });
  });

  it('propriedade: entrada ≥ estimativa × k − folga e < estimativa × k + 1, para toda família', () => {
    const rand = lcg(7);
    for (let i = 0; i < 2_000; i++) {
      const inputEstimate = Math.floor(rand() * 2_000_000);
      const k = 0.5 + rand() * 1.5;
      const family = tokenizerFamilies[i % tokenizerFamilies.length] ?? 'unknown';
      const usage = estimatedUsage({ inputEstimate, k, streamedText: 'abc', family });
      expect(Number.isSafeInteger(usage.inputTokens)).toBe(true);
      expect(usage.inputTokens).toBeGreaterThanOrEqual(1);
      expect(usage.inputTokens).toBeGreaterThanOrEqual(inputEstimate * k - 1e-6);
      expect(usage.inputTokens).toBeLessThan(Math.max(1, inputEstimate * k) + 1);
      expect(cacheTotal(usage)).toBe(0);
    }
  });
});

describe('checkReportedUsage (seção 7.6, apêndice B)', () => {
  it('entrada 1.000 com estimativa 45.455 e k 1,1 (≈ 50.000): cobra 25.000, floored, não calibra', () => {
    const usage = providerReport({ inputTokens: 1_000, cacheReadTokens: 400, outputTokens: 200 });
    const { billable, calibrate } = checkReportedUsage({ usage, inputEstimate: 45_455, k: 1.1 });
    expect(billable).toEqual({
      inputTokens: 25_000,
      cacheReadTokens: 400,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 200,
      reasoningTokens: 0,
      source: 'floored',
      anomalies: ['reported_below_estimate'],
    });
    expect(calibrate).toBe(false);
    expect(usage.inputTokens).toBe(1_000); // não altera o original
  });

  it('entrada dentro do esperado: devolve igual e calibra', () => {
    const usage = providerReport({ inputTokens: 48_000, outputTokens: 100 });
    const result = checkReportedUsage({ usage, inputEstimate: 45_455, k: 1.1 });
    expect(result.billable).toEqual(usage);
    expect(result.calibrate).toBe(true);
  });

  it('bordas com ponto flutuante: 100 × 1,1 / 2 = 55,00000000000001 e 180 × 0,7 / 2 = 62,99999999999999', () => {
    expect((100 * 1.1) / 2).toBeGreaterThan(55);
    const exact = checkReportedUsage({ usage: providerReport({ inputTokens: 55 }), inputEstimate: 100, k: 1.1 });
    expect(exact.billable.source).toBe('provider');
    expect(exact.calibrate).toBe(true);
    const below = checkReportedUsage({ usage: providerReport({ inputTokens: 54 }), inputEstimate: 100, k: 1.1 });
    expect(below.billable.inputTokens).toBe(55);
    expect(below.billable.source).toBe('floored');

    expect((180 * 0.7) / 2).toBeLessThan(63);
    const floored = checkReportedUsage({ usage: providerReport({ inputTokens: 62 }), inputEstimate: 180, k: 0.7 });
    expect(floored.billable.inputTokens).toBe(63);
    expect(checkReportedUsage({ usage: providerReport({ inputTokens: 63 }), inputEstimate: 180, k: 0.7 }).calibrate).toBe(true);
  });

  it('uso com anomalia ou estimado não calibra, mesmo sem piso', () => {
    const anomalous = providerReport({ inputTokens: 50_000, anomalies: ['cache_gt_input'] });
    expect(checkReportedUsage({ usage: anomalous, inputEstimate: 45_455, k: 1.1 })).toEqual({ billable: anomalous, calibrate: false });
    const estimated = estimatedUsage({ inputEstimate: 45_455, k: 1.1, streamedText: 'oi', family: 'claude' });
    expect(checkReportedUsage({ usage: estimated, inputEstimate: 45_455, k: 1.1 })).toEqual({ billable: estimated, calibrate: false });
  });

  it('acrescenta a anomalia às que já existiam, sem repetir', () => {
    const usage = providerReport({ inputTokens: 10, anomalies: ['negative', 'reported_below_estimate'] });
    const { billable } = checkReportedUsage({ usage, inputEstimate: 1_000, k: 1 });
    expect(billable.inputTokens).toBe(500);
    expect(billable.anomalies).toEqual(['negative', 'reported_below_estimate']);
  });

  it('corta o cache para caber na entrada cobrada', () => {
    // Uso montado à mão (não veio de normalizeUsage), com cache maior que tudo.
    const usage = providerReport({ inputTokens: 100, cacheReadTokens: 30_000, cacheWrite5mTokens: 10, cacheWrite1hTokens: 10 });
    const { billable } = checkReportedUsage({ usage, inputEstimate: 45_455, k: 1.1 });
    expect(billable).toMatchObject({
      inputTokens: 25_000,
      cacheReadTokens: 25_000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      source: 'floored',
      anomalies: ['cache_gt_input', 'reported_below_estimate'],
    });
  });

  it('entrada informada não finita cai no piso; estimativa ou k inválidos desligam o piso e não calibram', () => {
    const nan = checkReportedUsage({ usage: providerReport({ inputTokens: Number.NaN }), inputEstimate: 1_000, k: 1 });
    expect(nan.billable.inputTokens).toBe(500);
    for (const [inputEstimate, k] of [
      [0, 1],
      [Number.NaN, 1],
      [1_000, 0],
      [1_000, Number.POSITIVE_INFINITY],
    ] as const) {
      const usage = providerReport({ inputTokens: 10 });
      expect(checkReportedUsage({ usage, inputEstimate, k })).toEqual({ billable: usage, calibrate: false });
    }
  });

  it('propriedade: nunca cobra menos que o informado nem que o piso; cache ≤ entrada', () => {
    const rand = lcg(11);
    for (let i = 0; i < 3_000; i++) {
      const input = Math.floor(rand() * 120_000);
      const read = Math.floor(rand() * input);
      const usage = providerReport({ inputTokens: input, cacheReadTokens: read, outputTokens: 10 });
      const inputEstimate = 1 + Math.floor(rand() * 100_000);
      const k = 0.5 + rand() * 1.5;
      const { billable, calibrate } = checkReportedUsage({ usage, inputEstimate, k });
      expect(billable.inputTokens).toBeGreaterThanOrEqual(input);
      expect(billable.inputTokens).toBeGreaterThanOrEqual(Math.floor((inputEstimate * k) / 2));
      expect(cacheTotal(billable)).toBeLessThanOrEqual(billable.inputTokens);
      expect(billable.outputTokens).toBe(10);
      if (billable.source === 'floored') {
        expect(calibrate).toBe(false);
        expect(billable.anomalies).toContain('reported_below_estimate');
      } else {
        expect(billable).toBe(usage);
        expect(calibrate).toBe(true);
      }
    }
  });
});
