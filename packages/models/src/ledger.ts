import { P_USD_PER_USD, usdPerMTokToPUsdPerToken } from './cost';
import { priceAt } from './price';
import type { CacheMode, ModelPrice } from './types';

/**
 * Livro de gastos (docs/rascunhos/algoritmo-contexto.md, seções 8.2 a 8.4): estima o custo antes da chamada,
 * reserva o valor, liquida pelo custo real depois e vira o dia. Tudo em picodólares inteiros (1 US$ = 10¹² pUSD).
 * Lógica pura: sem relógio, sem rede e sem E/S; o orquestrador grava cada reserva (`model_usage.status = 'reserved'`)
 * antes da chamada e informa a liquidação depois.
 *
 * Falha fechada em todo lugar: valor inválido recusa a reserva, limite inválido recusa a chamada e custo real
 * inválido nunca deixa a chamada de graça.
 */

export type SpendKind = 'regular' | 'security';

/** Reserva em andamento: gravada antes da chamada e removida na liquidação. */
export interface SpendReservation {
  taskId: string | null;
  routineId: string | null;
  /** 'security': Porteiro e sonda, os únicos que podem usar a reserva de segurança. */
  kind: SpendKind;
  pUsd: number;
}

export interface SpendLedger {
  /** 'AAAA-MM-DD' no fuso do usuário (seção 8.4). */
  dayKey: string;
  /** Custo real já liquidado hoje. */
  settledPUsd: number;
  /** Reservas em andamento, por requestId. Atravessam a virada do dia e liquidam no dia novo. */
  reservations: Readonly<Record<string, SpendReservation>>;
  /** Idempotência da liquidação (só do dia; o banco garante o resto com `request_id` único). */
  settledRequestIds: readonly string[];
  /** Total liquidado por tarefa (atravessa a virada do dia). */
  byTaskPUsd: Readonly<Record<string, number>>;
  /** Total liquidado hoje por rotina (a fatia da rotina é diária). */
  byRoutinePUsd: Readonly<Record<string, number>>;
}

export interface SpendLimits {
  dailyPUsd: number;
  /** De `securityReservePUsd`: só chamadas de segurança podem ocupar. */
  securityReservePUsd: number;
  /** Limite por tarefa (padrão US$ 1, seção 2.3). */
  taskPUsd: number;
  /** Fatia da rotina (padrão 20% do limite diário, seção 8.3). */
  routinePUsd: number;
}

export interface ReserveSpendRequest {
  requestId: string;
  taskId: string | null;
  routineId: string | null;
  kind: SpendKind;
  estimatePUsd: number;
}

export type ReserveSpendFailureReason = 'daily_limit' | 'task_limit' | 'routine_limit' | 'duplicate_request' | 'invalid_estimate';

export type ReserveSpendResult = { ok: true; ledger: SpendLedger } | { ok: false; reason: ReserveSpendFailureReason };

export interface SpendSettlement {
  requestId: string;
  /** Custo real (de `computeCost`). */
  actualPUsd: number;
  /** Usados só quando não há reserva; com reserva, valem os da reserva. */
  taskId: string | null;
  routineId: string | null;
}

/** Linha de `model_usage` necessária para recuperar reservas órfãs na abertura. */
export interface UsageRecordMeta {
  requestId: string;
  status: 'reserved' | 'settled' | 'orphaned';
  reservedAtMs: number;
  reservedPUsd: number;
}

export interface OrphanedReservation {
  requestId: string;
  status: 'orphaned';
  chargedPUsd: number;
}

export interface HologramSpend {
  todayUsd: number;
  limitUsd: number;
}

/** Piso da reserva de segurança: US$ 0,05. */
export const SECURITY_RESERVE_MIN_PUSD = 50_000_000_000;
/** Reserva de segurança: 5% do limite diário, em pontos-base. */
export const SECURITY_RESERVE_BP = 500;
/** Limite padrão por tarefa: US$ 1 (seção 2.3). */
export const DEFAULT_TASK_LIMIT_PUSD = 1_000_000_000_000;
/** Fatia padrão de uma rotina: 20% do limite diário, em pontos-base (seção 8.3). */
export const DEFAULT_ROUTINE_SLICE_BP = 2_000;
/** Menor limite que o holograma mostra (o esquema exige positivo): US$ 0,0001. */
export const MIN_HOLOGRAM_LIMIT_USD = 0.0001;

const FULL_BP = 10_000;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Folga para o ponto flutuante em produtos de decimais (ex.: 0,57 × 100 = 56,999…). */
const FLOAT_EPSILON = 1e-6;

/** Valor em pUSD aceitável: inteiro seguro e não negativo. */
function isValidPUsd(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Soma saturada: o total nunca sai dos inteiros seguros (acima disso, o dia já está bloqueado de qualquer jeito). */
function addPUsd(a: number, b: number): number {
  return Math.min(a + b, Number.MAX_SAFE_INTEGER);
}

/** Lê só propriedades próprias: um id como '__proto__' ou 'constructor' não pode trazer nada do protótipo. */
function ownNumber(record: Readonly<Record<string, number>>, key: string): number {
  return Object.hasOwn(record, key) ? (record[key] ?? 0) : 0;
}

function ownReservation(record: Readonly<Record<string, SpendReservation>>, key: string): SpendReservation | null {
  return Object.hasOwn(record, key) ? (record[key] ?? null) : null;
}

function withAdded(record: Readonly<Record<string, number>>, key: string, pUsd: number): Readonly<Record<string, number>> {
  return { ...record, [key]: addPUsd(ownNumber(record, key), pUsd) };
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}

/** Contagem de tokens para estimativa: fracionário arredonda para cima; negativo, NaN ou infinito → null. */
function pessimisticTokens(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.ceil(value);
}

/**
 * Regra "nunca de graça" para um valor que deveria ser pUSD válido. Válido → ele mesmo, como veio. Inválido → o maior
 * entre `reservedPUsd` e o valor arredondado para cima, em que fracionário positivo sobe para o inteiro seguinte,
 * positivo gigante ou infinito satura em `Number.MAX_SAFE_INTEGER` (bloqueia o dia: falha fechada) e negativo ou
 * NaN vale 0.
 */
function neverFreePUsd(value: number, reservedPUsd: number): number {
  if (isValidPUsd(value)) return value;
  let upward = 0;
  if (value > 0) upward = Number.isFinite(value) ? Math.min(Math.ceil(value), Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  return Math.max(upward, reservedPUsd);
}

/** Soma das reservas em andamento (todas, ou só as que passam no filtro). */
function sumReservations(ledger: SpendLedger, filter?: (r: SpendReservation) => boolean): number {
  let total = 0;
  for (const reservation of Object.values(ledger.reservations)) {
    if (filter === undefined || filter(reservation)) total = addPUsd(total, reservation.pUsd);
  }
  return total;
}

/** Livro vazio para o dia `dayKey`. */
export function createSpendLedger(dayKey: string): SpendLedger {
  return { dayKey, settledPUsd: 0, reservations: {}, settledRequestIds: [], byTaskPUsd: {}, byRoutinePUsd: {} };
}

/**
 * Reserva de segurança (seção 8.3): `max(US$ 0,05; 5% do limite diário)`, sem passar do próprio limite diário.
 * Só Porteiro e sonda usam. Limite inválido (negativo, fracionário, NaN) → 0; nesse caso `reserveSpend` já recusa
 * tudo com 'daily_limit'.
 */
export function securityReservePUsd(dailyLimitPUsd: number): number {
  if (!isValidPUsd(dailyLimitPUsd)) return 0;
  // Uma divisão só (10.000 / 500 = 20): sem produto intermediário fora dos inteiros seguros.
  const share = Math.round(dailyLimitPUsd / (FULL_BP / SECURITY_RESERVE_BP));
  return Math.min(dailyLimitPUsd, Math.max(SECURITY_RESERVE_MIN_PUSD, share));
}

/**
 * Custo provável de uma chamada, em pUSD inteiros (seção 8.2), para a reserva antes do envio.
 * A faixa de preço é a da entrada inteira (`priceAt`). `expectedCacheHit` é limitado a [0, 1] (NaN → 0) e a parte em
 * cache é arredondada para baixo. A parte sem cache é cobrada de forma pessimista: escrita de 5 min com cache
 * 'explicit' (o prefixo novo será gravado), preço de entrada nos outros modos. `expectedOutput` já deve vir como
 * `min(R_call, 2 × EWMA da saída do papel)`.
 * Contagem de tokens negativa, NaN ou infinita → `Number.MAX_SAFE_INTEGER` (a reserva é recusada: falha fechada).
 */
export function estimatePreflightCost(i: {
  inputTokens: number;
  expectedCacheHit: number;
  expectedOutput: number;
  price: ModelPrice;
  cache: CacheMode;
}): number {
  const input = pessimisticTokens(i.inputTokens);
  const output = pessimisticTokens(i.expectedOutput);
  if (input === null || output === null) return Number.MAX_SAFE_INTEGER;

  const hit = i.expectedCacheHit > 0 ? Math.min(1, i.expectedCacheHit) : 0;
  const cached = Math.min(input, Math.floor(input * hit + FLOAT_EPSILON));
  const uncached = input - cached;

  const price = priceAt(i.price, i.cache, input);
  const uncachedPerMTok = i.cache === 'explicit' ? price.cacheWrite5mPerMTok : price.inputPerMTok;
  const total =
    uncached * usdPerMTokToPUsdPerToken(uncachedPerMTok) +
    cached * usdPerMTokToPUsdPerToken(price.cacheReadPerMTok) +
    output * usdPerMTokToPUsdPerToken(price.outputPerMTok);
  return Math.min(total, Number.MAX_SAFE_INTEGER);
}

/**
 * Saída máxima que o saldo paga (seção 8.2): `min(R, floor((saldo − custo de entrada) / preço de saída))`.
 * Devolve 0 (a chamada não sai) se o saldo não cobrir a entrada ou se o resultado ficar abaixo de `minUseful`.
 * Saída de graça (preço 0) → `outputReserve`. Qualquer número inválido (NaN, preço ou custo de entrada negativo) → 0.
 * Assim o limite de 100% nunca é ultrapassado por uma resposta longa.
 */
export function maxOutputForBudget(i: {
  remainingPUsd: number;
  inputCostPUsd: number;
  outputPUsdPerToken: number;
  outputReserve: number;
  minUseful: number;
}): number {
  const reserve = Number.isFinite(i.outputReserve) && i.outputReserve > 0 ? Math.floor(i.outputReserve) : 0;
  const available = i.remainingPUsd - i.inputCostPUsd;
  // Custo de entrada negativo somaria ao saldo: falha fechada.
  if (!(i.inputCostPUsd >= 0) || !(available >= 0) || !(i.outputPUsdPerToken >= 0)) return 0;
  const affordable = i.outputPUsdPerToken === 0 ? reserve : Math.floor(available / i.outputPUsdPerToken);
  const maxOutput = Math.min(reserve, affordable);
  return maxOutput >= i.minUseful ? maxOutput : 0;
}

/**
 * Reserva o custo estimado antes da chamada (seção 8.2). Puro: devolve um livro novo ou o motivo da recusa.
 *  - estimativa negativa, fracionária ou acima de 2⁵³ → 'invalid_estimate';
 *  - requestId já reservado ou já liquidado hoje → 'duplicate_request';
 *  - chamada comum: `liquidado + reservado + estimativa ≤ limite diário − reserva de segurança`; chamada de segurança:
 *    `≤ limite diário` → senão 'daily_limit';
 *  - tarefa: liquidado da tarefa + reservas da tarefa + estimativa ≤ `taskPUsd` → senão 'task_limit';
 *  - rotina: liquidado da rotina hoje + reservas da rotina + estimativa ≤ `routinePUsd` → senão 'routine_limit'.
 * Os limites de tarefa e de rotina valem também para chamadas de segurança (sem orçamento para o Porteiro, não há
 * veredito: o Jesus pergunta ou nega, seção 8.3). Limite inválido recusa (falha fechada).
 */
export function reserveSpend(ledger: SpendLedger, r: ReserveSpendRequest, limits: SpendLimits): ReserveSpendResult {
  if (!isValidPUsd(r.estimatePUsd)) return { ok: false, reason: 'invalid_estimate' };
  if (ownReservation(ledger.reservations, r.requestId) !== null || ledger.settledRequestIds.includes(r.requestId)) {
    return { ok: false, reason: 'duplicate_request' };
  }

  if (!isValidPUsd(limits.dailyPUsd) || !isValidPUsd(limits.securityReservePUsd)) return { ok: false, reason: 'daily_limit' };
  const dayCap = r.kind === 'security' ? limits.dailyPUsd : limits.dailyPUsd - limits.securityReservePUsd;
  const dayTotal = ledger.settledPUsd + sumReservations(ledger) + r.estimatePUsd;
  if (!(dayTotal <= dayCap)) return { ok: false, reason: 'daily_limit' };

  const taskId = r.taskId;
  if (taskId !== null) {
    const taskTotal =
      ownNumber(ledger.byTaskPUsd, taskId) + sumReservations(ledger, (res) => res.taskId === taskId) + r.estimatePUsd;
    if (!isValidPUsd(limits.taskPUsd) || !(taskTotal <= limits.taskPUsd)) return { ok: false, reason: 'task_limit' };
  }

  const routineId = r.routineId;
  if (routineId !== null) {
    const routineTotal =
      ownNumber(ledger.byRoutinePUsd, routineId) + sumReservations(ledger, (res) => res.routineId === routineId) + r.estimatePUsd;
    if (!isValidPUsd(limits.routinePUsd) || !(routineTotal <= limits.routinePUsd)) return { ok: false, reason: 'routine_limit' };
  }

  const reservation: SpendReservation = { taskId, routineId, kind: r.kind, pUsd: r.estimatePUsd };
  return { ok: true, ledger: { ...ledger, reservations: { ...ledger.reservations, [r.requestId]: reservation } } };
}

/**
 * Liquida uma chamada pelo custo real (seção 8.2): remove a reserva e soma o custo ao dia, à tarefa e à rotina.
 * Idempotente por requestId: um requestId já liquidado hoje devolve o mesmo objeto. Liquidação sem reserva também soma
 * (com os ids de `s`); com reserva, valem a tarefa e a rotina gravadas nela.
 * Nunca de graça: custo real inválido (negativo, NaN, fracionário, acima de 2⁵³) cobra o maior entre o valor
 * reservado e o real arredondado para cima (infinito ou gigante satura em `Number.MAX_SAFE_INTEGER` e bloqueia o dia).
 * Custo real válido é cobrado como veio, mesmo abaixo da reserva. As somas saturam em `Number.MAX_SAFE_INTEGER`.
 */
export function settleSpend(ledger: SpendLedger, s: SpendSettlement): SpendLedger {
  if (ledger.settledRequestIds.includes(s.requestId)) return ledger;

  const reservation = ownReservation(ledger.reservations, s.requestId);
  const charged = neverFreePUsd(s.actualPUsd, reservation?.pUsd ?? 0);
  const taskId = reservation === null ? s.taskId : reservation.taskId;
  const routineId = reservation === null ? s.routineId : reservation.routineId;

  return {
    dayKey: ledger.dayKey,
    settledPUsd: addPUsd(ledger.settledPUsd, charged),
    reservations: reservation === null ? ledger.reservations : withoutKey(ledger.reservations, s.requestId),
    settledRequestIds: [...ledger.settledRequestIds, s.requestId],
    byTaskPUsd: taskId === null ? ledger.byTaskPUsd : withAdded(ledger.byTaskPUsd, taskId, charged),
    byRoutinePUsd: routineId === null ? ledger.byRoutinePUsd : withAdded(ledger.byRoutinePUsd, routineId, charged),
  };
}

/**
 * Na abertura (seção 8.2): reservas sem liquidação mais antigas que `timeoutMs` viram 'orphaned' e são cobradas pelo
 * valor reservado. Um requestId que já tem linha 'settled' ou 'orphaned' é ignorado (nunca cobra duas vezes), e
 * requestIds repetidos entram uma vez só. Instante inválido (NaN) conta como antigo, e reserva com instante no futuro
 * (o relógio voltou entre uma execução e outra) também: o processo que a fez já morreu e ela nunca liquidaria. Valor
 * reservado inválido segue a regra "nunca de graça" (fracionário arredonda para cima): falha fechada.
 */
export function recoverOrphanedReservations(
  records: readonly UsageRecordMeta[],
  nowMs: number,
  timeoutMs: number,
): readonly OrphanedReservation[] {
  const closed = new Set(records.filter((rec) => rec.status !== 'reserved').map((rec) => rec.requestId));
  const seen = new Set<string>();
  const orphaned: OrphanedReservation[] = [];
  for (const rec of records) {
    if (rec.status !== 'reserved' || closed.has(rec.requestId) || seen.has(rec.requestId)) continue;
    const ageMs = nowMs - rec.reservedAtMs;
    if (ageMs >= 0 && ageMs <= timeoutMs) continue;
    seen.add(rec.requestId);
    orphaned.push({ requestId: rec.requestId, status: 'orphaned', chargedPUsd: neverFreePUsd(rec.reservedPUsd, 0) });
  }
  return orphaned;
}

/**
 * Dia local 'AAAA-MM-DD' no fuso IANA (seção 8.4), via `Intl.DateTimeFormat('en-CA', { timeZone })`.
 * Ex.: 02:30 UTC de 09/10/2026 em 'America/Sao_Paulo' é '2026-10-08'.
 * Lança `RangeError` para instante inválido ou fuso desconhecido.
 */
export function localDayKey(instantMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instantMs);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  const key = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  if (!DAY_KEY_PATTERN.test(key)) throw new RangeError(`dia local inválido: ${key}`);
  return key;
}

/**
 * `max(localDayKey(instante, fuso), lastDayKey)` comparando as strings 'AAAA-MM-DD' (seção 8.4): o dia só avança,
 * mesmo com troca de fuso ou relógio voltando. `lastDayKey` fora do formato é ignorado.
 */
export function effectiveDayKey(instantMs: number, timeZone: string, lastDayKey: string | null): string {
  const current = localDayKey(instantMs, timeZone);
  if (lastDayKey === null || !DAY_KEY_PATTERN.test(lastDayKey)) return current;
  return lastDayKey > current ? lastDayKey : current;
}

/**
 * Virada do dia (seção 8.4). Num dia novo: zera o liquidado e os settledRequestIds do dia, zera os totais por rotina
 * (a fatia da rotina é diária) e mantém as reservas em andamento (que liquidam no dia novo) e os totais por tarefa.
 * No mesmo dia, num dia anterior ou com `dayKey` fora do formato, devolve o mesmo objeto (o dia nunca volta e um
 * valor estranho nunca zera o gasto).
 */
export function rollDay(ledger: SpendLedger, dayKey: string): SpendLedger {
  if (!DAY_KEY_PATTERN.test(dayKey) || !(dayKey > ledger.dayKey)) return ledger;
  return {
    dayKey,
    settledPUsd: 0,
    reservations: ledger.reservations,
    settledRequestIds: [],
    byTaskPUsd: ledger.byTaskPUsd,
    byRoutinePUsd: {},
  };
}

/**
 * Gasto para o snapshot do holograma (seção 9), compatível com `hologramSnapshotSchema.spend`:
 * `todayUsd = (liquidado + reservado) / 10¹²`, arredondado a 4 casas, finito e nunca negativo;
 * `limitUsd` = limite diário, que precisa ser positivo e finito (senão vira US$ 0,0001: o anel aparece cheio).
 */
export function toHologramSpend(ledger: SpendLedger, dailyLimitUsd: number): HologramSpend {
  const total = addPUsd(ledger.settledPUsd, sumReservations(ledger));
  const totalPUsd = total > 0 ? total : 0;
  const todayUsd = Math.round(totalPUsd / (P_USD_PER_USD / FULL_BP)) / FULL_BP;
  const limitUsd = Number.isFinite(dailyLimitUsd) && dailyLimitUsd > 0 ? dailyLimitUsd : MIN_HOLOGRAM_LIMIT_USD;
  return { todayUsd, limitUsd };
}
