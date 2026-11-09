/**
 * Limiares da compactação (docs/rascunhos/algoritmo-contexto.md, seção 5.1).
 *
 * Tudo em pontos-base inteiros: 10.000 = 100% do limite efetivo L. Contas só com inteiros evitam o erro
 * de arredondamento da proposta 1 (lá, 0,82 − 0,25 dava 0,56).
 */

/** 100% em pontos-base. */
export const FULL_BP = 10_000;

/**
 * Nenhum resultado de ferramenta é cortado abaixo disto (tokens). Também é o piso de `stepResultCap`: com 256
 * (e não 512, como no rascunho), a folga de dois passos até o limite técnico vale para todo L ≥ 5.000.
 */
export const MIN_RESULT_CAP = 256;

export interface Thresholds {
  /** Compacta a partir daqui. */
  compactBp: number;
  /** Limpa saídas antigas de ferramentas a partir daqui (sem LLM). */
  microBp: number;
  /** Avisa (pressão de memória) e começa o resumo antecipado. */
  warnBp: number;
  /** Alvo da limpeza. */
  postMicroBp: number;
  /** Referência do que sobra depois de compactar. */
  postCompactBp: number;
  /** Limite técnico (inputMax − parte fixa) em pontos-base de L; sempre ≥ 10.000. Acima disso não envia. */
  hardBp: number;
  /** Teto de cada resultado de ferramenta (tokens). */
  toolResultCap: number;
  /** Teto da soma dos resultados de um passo (tokens). */
  stepResultCap: number;
  /** Crescimento por passo fora das ferramentas (tokens). */
  stepGrowth: number;
  /** Menor limpeza que vale invalidar o cache (tokens). */
  clearAtLeast: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** round(valor × num / den), com meio para cima, só com inteiros. */
function ratioRound(value: number, num: number, den: number): number {
  return Math.floor((2 * value * num + den) / (2 * den));
}

/** floor(valor × num / den), só com inteiros. */
function ratioFloor(value: number, num: number, den: number): number {
  return Math.floor((value * num) / den);
}

/** Uso em pontos-base de L (arredondado para baixo: `usageBp ≥ x` equivale a `U ≥ x·L/10.000`). */
export function usageBp(usedTokens: number, limit: number): number {
  const used = Math.max(0, Math.round(usedTokens));
  if (!(limit >= 1)) return used > 0 ? Number.MAX_SAFE_INTEGER : 0;
  return Math.floor((FULL_BP * used) / Math.floor(limit));
}

/** Tokens correspondentes a `bp` pontos-base de L (arredondado para baixo). */
export function bpToTokens(bp: number, limit: number): number {
  return Math.floor((bp * Math.max(0, Math.floor(limit))) / FULL_BP);
}

/** Limiares derivados do limite efetivo L, do teto técnico e da parte fixa. */
export function deriveThresholds(input: { limit: number; inputMax: number; fixedTokens: number }): Thresholds {
  const limit = Math.max(1, Math.floor(input.limit));
  const fixed = Math.max(0, Math.floor(input.fixedTokens));
  // Folga técnica (inputMax − F). Nunca abaixo de L, para que hardBp ≥ 10.000 mesmo com entrada incoerente.
  const headroom = Math.max(limit, Math.floor(input.inputMax) - fixed);

  const stepGrowth = Math.min(2_000, ratioFloor(limit, 1, 10));
  const toolResultCap0 = clamp(ratioRound(limit, 1, 20), Math.min(2_000, ratioFloor(limit, 15, 100)), 25_000);
  // Até 2 resultados cheios por passo (chamadas paralelas).
  const growthPerStep = 2 * toolResultCap0 + stepGrowth;
  const hardBp = Math.floor((FULL_BP * headroom) / limit);
  const compactBp = clamp(Math.min(8_500, hardBp - 2 * Math.ceil((FULL_BP * growthPerStep) / limit)), 6_000, 8_500);
  const microBp = Math.max(4_000, compactBp - 2_500);
  const stepResultCap = Math.min(
    2 * toolResultCap0,
    Math.max(MIN_RESULT_CAP, Math.floor(((hardBp - compactBp) * limit) / (2 * FULL_BP)) - stepGrowth),
  );

  return {
    compactBp,
    microBp,
    warnBp: compactBp - 1_000,
    postMicroBp: microBp - 1_500,
    postCompactBp: 3_000,
    hardBp,
    toolResultCap: Math.min(toolResultCap0, stepResultCap),
    stepResultCap,
    stepGrowth,
    clearAtLeast: Math.max(2_000, ratioRound(limit, 8, 100)),
  };
}

/** Menor `microBp` aceito num ajuste da interface. */
export const MIN_USER_MICRO_BP = 3_000;

/**
 * Ajustes da interface: `compactBp` em [5.000; 9.000] e com folga de dois passos até o limite técnico;
 * `microBp` pelo menos 1.500 abaixo; `warnBp` entre os dois. Fora disso, corta; se for impossível, usa os derivados.
 */
export function clampUserThresholds(
  requested: Partial<Pick<Thresholds, 'compactBp' | 'microBp' | 'warnBp'>>,
  derived: Thresholds,
  limit: number,
): Thresholds {
  const L = Math.max(1, Math.floor(limit));
  const maxCompact = Math.min(
    9_000,
    derived.hardBp - 2 * Math.ceil((FULL_BP * (derived.stepResultCap + derived.stepGrowth)) / L),
  );
  if (maxCompact < 5_000) return derived;

  const pick = (value: number | undefined): number | null =>
    value !== undefined && Number.isFinite(value) ? Math.round(value) : null;
  const compactBp = clamp(pick(requested.compactBp) ?? derived.compactBp, 5_000, maxCompact);
  const microMax = compactBp - 1_500;
  const microBp = clamp(pick(requested.microBp) ?? Math.max(4_000, compactBp - 2_500), MIN_USER_MICRO_BP, microMax);
  const warnBp = clamp(pick(requested.warnBp) ?? compactBp - 1_000, microBp, compactBp);
  return { ...derived, compactBp, microBp, warnBp, postMicroBp: microBp - 1_500 };
}

export interface PostCompactionSplit {
  summaryTokens: number;
  userRequestsTokens: number;
  actionLedgerTokens: number;
  tailTokens: number;
  /** Total esperado depois da compactação (cerca de 27% a 30% de L nos casos comuns). */
  totalTokens: number;
}

/** Divisão do contexto depois do resumo (seção 5.5). `summarizerReserve` é a reserva de saída do resumidor. */
export function postCompactionSplit(limit: number, summarizerReserve = Number.POSITIVE_INFINITY): PostCompactionSplit {
  const L = Math.max(0, Math.floor(limit));
  const summaryTokens = Math.min(clamp(ratioRound(L, 8, 100), 2_000, 12_000), summarizerReserve);
  const userRequestsTokens = clamp(ratioRound(L, 5, 100), 1_000, 16_000);
  const actionLedgerTokens = clamp(ratioRound(L, 2, 100), 500, 4_000);
  const tailTokens = clamp(ratioFloor(L, 30, 100) - summaryTokens - userRequestsTokens - actionLedgerTokens, 2_000, 40_000);
  return {
    summaryTokens,
    userRequestsTokens,
    actionLedgerTokens,
    tailTokens,
    totalTokens: summaryTokens + userRequestsTokens + actionLedgerTokens + tailTokens,
  };
}

/** Teto do que um subagente devolve ao pai (seção 5.11). */
export function subagentReturnCap(parentLimit: number): number {
  return clamp(ratioRound(Math.max(0, Math.floor(parentLimit)), 3, 100), 1_000, 8_000);
}

/**
 * Divide o teto do passo entre resultados de ferramenta em paralelo (seção 5.2): cada um fica ≤ `toolResultCap`
 * e a soma fica ≤ `stepResultCap`. O corte sai dos maiores (nivelamento por cima); os pequenos ficam inteiros.
 * Nenhum teto fica abaixo de `MIN_RESULT_CAP`, mesmo que a soma passe por isso.
 */
export function fitStepResults(
  results: readonly { ref: string; tokens: number }[],
  stepResultCap: number,
  toolResultCap: number,
): readonly { ref: string; capTokens: number }[] {
  const capped = results.map((r) => Math.min(Math.max(0, Math.ceil(r.tokens)), toolResultCap));
  const order = capped.map((tokens, index) => ({ tokens, index })).sort((a, b) => a.tokens - b.tokens || a.index - b.index);
  let remaining = Math.max(0, Math.floor(stepResultCap));
  let level = Number.POSITIVE_INFINITY;
  for (let i = 0; i < order.length; i += 1) {
    const entry = order[i];
    if (entry === undefined) break;
    const share = Math.floor(remaining / (order.length - i));
    if (entry.tokens > share) {
      level = Math.max(MIN_RESULT_CAP, share);
      break;
    }
    remaining -= entry.tokens;
  }
  return results.map((r, i) => ({ ref: r.ref, capTokens: Math.min(capped[i] ?? 0, level) }));
}
