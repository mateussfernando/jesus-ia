import { z } from 'zod';
import type { NormalizedUsage } from './cost';
import { estimateTextTokens } from './tokens';
import type { TokenizerFamily } from './types';

/**
 * Uso informado pelo provedor, normalizado entre formatos (docs/rascunhos/algoritmo-contexto.md, seções 7.5 e 7.6).
 * O `usage` vem de fora (provedor, intermediário, servidor local): é dado não confiável, validado com Zod e, quando
 * vem incoerente, corrigido sempre para o lado que cobra mais, nunca para o que cobra menos.
 * Lógica pura: sem relógio, rede ou E/S.
 */

/**
 * - `cache_gt_input`: o cache (lido + gravado) passou da entrada total; o cache foi cortado.
 * - `negative`: algum número veio negativo e virou 0.
 * - `missing_fields`: o detalhamento não cobre o total (ou o contrário): parte da escrita de cache sem TTL
 *   informado, ou raciocínio maior que a saída. Vale a leitura que cobra mais.
 * - `reported_below_estimate`: entrada informada abaixo do piso de `checkReportedUsage`; cobra-se o piso.
 */
export type UsageAnomaly = 'cache_gt_input' | 'negative' | 'missing_fields' | 'reported_below_estimate';
/** 'provider': veio do provedor. 'estimated': não veio uso (ver `estimatedUsage`). 'floored': cobrado pelo piso. */
export type UsageSource = 'provider' | 'estimated' | 'floored';

export interface UsageReport extends NormalizedUsage {
  /** Parte de `outputTokens` gasta em raciocínio (já contada nela). */
  reasoningTokens: number;
  source: UsageSource;
  /** Sem repetição, na ordem em que apareceram. Uso com anomalia não calibra o estimador (seção 7.4). */
  anomalies: readonly UsageAnomaly[];
}

/** Formato do objeto `usage` cru de cada API. */
export type UsageFormat = 'anthropic' | 'deepseek' | 'openai_chat' | 'openai_responses';

// Adaptador do Vercel AI SDK ('ai_sdk' na especificação): fica para a fase 1. O SDK ainda não está instalado e os
// nomes dos campos de uso, cache e raciocínio mudam entre versões; o adaptador só entra depois de conferir os tipos
// da versão instalada (na dúvida, o `providerMetadata` cru passa por um dos formatos acima).

/**
 * Sanidade: nenhuma resposta tem 100 milhões de tokens (10 × a maior janela aceita no catálogo). Acima disso o
 * relatório é tratado como inválido (o chamador cai em `estimatedUsage`), e os custos em pUSD seguem inteiros seguros.
 */
const MAX_REPORTED_TOKENS = 100_000_000;

/** Contagem informada: inteiro seguro dentro da faixa; negativo passa aqui e vira 0 com anomalia depois. */
const tokenCount = z.number().int().min(-MAX_REPORTED_TOKENS).max(MAX_REPORTED_TOKENS);
const optionalCount = tokenCount.nullish();

// Um esquema por formato. `z.object` descarta campos desconhecidos; campo presente com tipo errado invalida o
// relatório inteiro (falha fechada: o chamador estima, e a estimativa nunca é grátis).

const anthropicSchema = z.object({
  /** Só a entrada SEM cache. */
  input_tokens: tokenCount,
  /** Já inclui o raciocínio (thinking). */
  output_tokens: tokenCount,
  cache_read_input_tokens: optionalCount,
  cache_creation_input_tokens: optionalCount,
  cache_creation: z
    .object({ ephemeral_5m_input_tokens: optionalCount, ephemeral_1h_input_tokens: optionalCount })
    .nullish(),
});

const deepseekSchema = z.object({
  /** Total do prompt (acerto + falta de cache). `prompt_cache_miss_tokens` é ignorado. */
  prompt_tokens: tokenCount,
  completion_tokens: tokenCount,
  prompt_cache_hit_tokens: optionalCount,
  completion_tokens_details: z.object({ reasoning_tokens: optionalCount }).nullish(),
});

const openAiChatSchema = z.object({
  prompt_tokens: tokenCount,
  completion_tokens: tokenCount,
  prompt_tokens_details: z.object({ cached_tokens: optionalCount }).nullish(),
  completion_tokens_details: z.object({ reasoning_tokens: optionalCount }).nullish(),
});

const openAiResponsesSchema = z.object({
  input_tokens: tokenCount,
  output_tokens: tokenCount,
  input_tokens_details: z.object({ cached_tokens: optionalCount }).nullish(),
  output_tokens_details: z.object({ reasoning_tokens: optionalCount }).nullish(),
});

/** Contagens já sem negativos, antes do corte do cache e da checagem do raciocínio. */
interface UsageCounts {
  input: number;
  cacheRead: number;
  write5m: number;
  write1h: number;
  output: number;
  reasoning: number;
}

type Adapter = (raw: unknown, anomalies: Set<UsageAnomaly>) => UsageCounts | null;

/** Ausente ou nulo → 0. Negativo → 0 com anomalia `negative`. */
function nonNegative(value: number | null | undefined, anomalies: Set<UsageAnomaly>): number {
  if (value === null || value === undefined) return 0;
  if (value < 0) anomalies.add('negative');
  return Math.max(0, value); // também troca -0 por 0
}

/**
 * Anthropic: total = `input_tokens` + leitura + escrita de cache. Sem o detalhamento `cache_creation`, toda a
 * escrita conta como 5 min (o TTL padrão). Detalhamento que não bate com `cache_creation_input_tokens` (anomalia
 * `missing_fields`), pela leitura que nunca cobra menos: a escrita vale o maior dos dois números, e a parte sem
 * TTL informado conta como 1 h (a escrita mais cara).
 */
const fromAnthropic: Adapter = (raw, anomalies) => {
  const parsed = anthropicSchema.safeParse(raw);
  if (!parsed.success) return null;
  const u = parsed.data;
  const uncached = nonNegative(u.input_tokens, anomalies);
  const cacheRead = nonNegative(u.cache_read_input_tokens, anomalies);
  const creation = nonNegative(u.cache_creation_input_tokens, anomalies);
  const breakdown = u.cache_creation;
  let write5m = creation;
  let write1h = 0;
  if (breakdown != null && (breakdown.ephemeral_5m_input_tokens != null || breakdown.ephemeral_1h_input_tokens != null)) {
    const reported5m = nonNegative(breakdown.ephemeral_5m_input_tokens, anomalies);
    const reported1h = nonNegative(breakdown.ephemeral_1h_input_tokens, anomalies);
    if (reported5m + reported1h !== creation) anomalies.add('missing_fields');
    write5m = reported5m;
    write1h = Math.max(creation, reported5m + reported1h) - reported5m;
  }
  return {
    input: uncached + cacheRead + write5m + write1h,
    cacheRead,
    write5m,
    write1h,
    output: nonNegative(u.output_tokens, anomalies),
    // A saída da Anthropic já inclui o raciocínio e a API não o separa.
    reasoning: 0,
  };
};

const fromDeepseek: Adapter = (raw, anomalies) => {
  const parsed = deepseekSchema.safeParse(raw);
  if (!parsed.success) return null;
  const u = parsed.data;
  return {
    input: nonNegative(u.prompt_tokens, anomalies),
    cacheRead: nonNegative(u.prompt_cache_hit_tokens, anomalies),
    write5m: 0,
    write1h: 0,
    output: nonNegative(u.completion_tokens, anomalies),
    reasoning: nonNegative(u.completion_tokens_details?.reasoning_tokens, anomalies),
  };
};

const fromOpenAiChat: Adapter = (raw, anomalies) => {
  const parsed = openAiChatSchema.safeParse(raw);
  if (!parsed.success) return null;
  const u = parsed.data;
  return {
    input: nonNegative(u.prompt_tokens, anomalies),
    cacheRead: nonNegative(u.prompt_tokens_details?.cached_tokens, anomalies),
    write5m: 0,
    write1h: 0,
    output: nonNegative(u.completion_tokens, anomalies),
    reasoning: nonNegative(u.completion_tokens_details?.reasoning_tokens, anomalies),
  };
};

const fromOpenAiResponses: Adapter = (raw, anomalies) => {
  const parsed = openAiResponsesSchema.safeParse(raw);
  if (!parsed.success) return null;
  const u = parsed.data;
  return {
    input: nonNegative(u.input_tokens, anomalies),
    cacheRead: nonNegative(u.input_tokens_details?.cached_tokens, anomalies),
    write5m: 0,
    write1h: 0,
    output: nonNegative(u.output_tokens, anomalies),
    reasoning: nonNegative(u.output_tokens_details?.reasoning_tokens, anomalies),
  };
};

const ADAPTERS: Record<UsageFormat, Adapter> = {
  anthropic: fromAnthropic,
  deepseek: fromDeepseek,
  openai_chat: fromOpenAiChat,
  openai_responses: fromOpenAiResponses,
};

interface CacheSplit {
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cut: boolean;
}

/**
 * Cache maior que a entrada: corta na ordem leitura → escrita 5 min → escrita 1 h (a mesma de `computeCost`).
 * O que sai do cache passa a contar como entrada sem cache, que nunca é mais barata.
 */
function fitCacheToInput(input: number, cacheRead: number, write5m: number, write1h: number): CacheSplit {
  if (cacheRead + write5m + write1h <= input) {
    return { cacheReadTokens: cacheRead, cacheWrite5mTokens: write5m, cacheWrite1hTokens: write1h, cut: false };
  }
  const read = Math.min(cacheRead, input);
  const w5 = Math.min(write5m, input - read);
  const w1 = Math.min(write1h, input - read - w5);
  return { cacheReadTokens: read, cacheWrite5mTokens: w5, cacheWrite1hTokens: w1, cut: true };
}

function toReport(c: UsageCounts, anomalies: Set<UsageAnomaly>): UsageReport {
  const cache = fitCacheToInput(c.input, c.cacheRead, c.write5m, c.write1h);
  if (cache.cut) anomalies.add('cache_gt_input');
  // O raciocínio faz parte da saída: se vier maior, a saída informada deixou algo de fora. Cobra-se o maior.
  if (c.reasoning > c.output) anomalies.add('missing_fields');
  return {
    inputTokens: c.input,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWrite5mTokens: cache.cacheWrite5mTokens,
    cacheWrite1hTokens: cache.cacheWrite1hTokens,
    outputTokens: Math.max(c.output, c.reasoning),
    reasoningTokens: c.reasoning,
    source: 'provider',
    anomalies: [...anomalies],
  };
}

/**
 * Normaliza o `usage` cru de uma resposta. `inputTokens` é sempre o TOTAL do prompt (com cache lido e gravado);
 * `outputTokens` inclui o raciocínio. Campos desconhecidos são ignorados. Sem os campos essenciais (entrada e
 * saída), com tipo errado ou fora da faixa de sanidade, devolve `null`: o chamador usa `estimatedUsage`.
 * Nunca lança exceção.
 */
export function normalizeUsage(format: UsageFormat, raw: unknown): UsageReport | null {
  try {
    const anomalies = new Set<UsageAnomaly>();
    const counts = ADAPTERS[format](raw, anomalies);
    return counts === null ? null : toReport(counts, anomalies);
  } catch {
    // Objeto hostil (getter que lança, proxy) ou formato inválido vindo de JavaScript sem tipos.
    return null;
  }
}

/**
 * Folga para o erro de ponto flutuante de produtos de decimais (1,1 × 1,1 × 1000 = 1210,0000000000002).
 * Relativa, para valer também em janelas de milhões de tokens; muito maior que o erro de um produto (~1e-16).
 */
function floatSlack(x: number): number {
  return Math.max(1e-9, Math.abs(x) * 1e-12);
}

function ceilTokens(x: number): number {
  return Math.max(0, Math.ceil(x - floatSlack(x)));
}

function floorTokens(x: number): number {
  return Math.max(0, Math.floor(x + floatSlack(x)));
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Uso de uma chamada que terminou sem `usage` (ex.: *stream* cancelado por "Jesus, pare") ou com `usage` inválido:
 * entrada = ⌈estimativa × k⌉, saída = estimativa do texto recebido, sem cache. Nunca grátis: a entrada é de pelo
 * menos 1 token. `k` inválido (não finito ou ≤ 0) vale 1.
 */
export function estimatedUsage(i: {
  inputEstimate: number;
  k: number;
  streamedText: string;
  family: TokenizerFamily;
}): UsageReport {
  const inputEstimate = isPositiveFinite(i.inputEstimate) ? i.inputEstimate : 0;
  const k = isPositiveFinite(i.k) ? i.k : 1;
  return {
    inputTokens: Math.max(1, ceilTokens(inputEstimate * k)),
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    outputTokens: estimateTextTokens(i.streamedText, i.family),
    reasoningTokens: 0,
    source: 'estimated',
    anomalies: [],
  };
}

/**
 * Checagem depois da resposta (seção 7.6, OWASP LLM10): um intermediário que informe entrada muito abaixo da
 * estimativa faria o orçamento subestimar o gasto. Se a entrada informada for menor que 0,5 × estimativa × k, a
 * entrada cobrada vira ⌊0,5 × estimativa × k⌋ (`source: 'floored'`, anomalia `reported_below_estimate`) e o cache
 * é cortado para caber nela. A amostra só calibra (`calibrate`) se o uso veio do provedor, sem nenhuma anomalia, e
 * com estimativa e k válidos (finitos e > 0); estimativa ou k inválidos também desligam o piso.
 */
export function checkReportedUsage(i: { usage: UsageReport; inputEstimate: number; k: number }): {
  billable: UsageReport;
  calibrate: boolean;
} {
  const { usage } = i;
  const estimateValid = isPositiveFinite(i.inputEstimate) && isPositiveFinite(i.k);
  /** 0,5 × estimativa × k, ainda sem arredondar. */
  const threshold = estimateValid ? (i.inputEstimate * i.k) / 2 : 0;
  // Entrada não finita conta como 0: cai no piso.
  const reported = isPositiveFinite(usage.inputTokens) ? usage.inputTokens : 0;

  if (reported < threshold - floatSlack(threshold)) {
    const inputTokens = Math.max(reported, floorTokens(threshold)); // nunca cobra menos que o informado
    const cache = fitCacheToInput(inputTokens, usage.cacheReadTokens, usage.cacheWrite5mTokens, usage.cacheWrite1hTokens);
    const anomalies = new Set<UsageAnomaly>(usage.anomalies);
    if (cache.cut) anomalies.add('cache_gt_input');
    anomalies.add('reported_below_estimate');
    return {
      billable: {
        ...usage,
        inputTokens,
        cacheReadTokens: cache.cacheReadTokens,
        cacheWrite5mTokens: cache.cacheWrite5mTokens,
        cacheWrite1hTokens: cache.cacheWrite1hTokens,
        source: 'floored',
        anomalies: [...anomalies],
      },
      calibrate: false,
    };
  }

  return {
    billable: usage,
    calibrate: estimateValid && usage.source === 'provider' && usage.anomalies.length === 0,
  };
}
