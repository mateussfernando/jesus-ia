/**
 * Espera progressiva depois de senhas erradas (decisão 0015): as primeiras tentativas são livres; depois, cada erro
 * dobra a espera, até um teto. Nunca há bloqueio permanente (você não pode ficar trancado fora do próprio Jesus).
 * A contagem fica no banco: fechar e abrir o app não zera.
 */

export interface ThrottlePolicy {
  /** Erros seguidos sem espera. */
  readonly freeAttempts: number;
  /** Espera depois do primeiro erro além das livres. */
  readonly baseDelayMs: number;
  /** Teto da espera. */
  readonly maxDelayMs: number;
}

export const defaultThrottlePolicy: ThrottlePolicy = {
  freeAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 15 * 60_000,
};

/**
 * Espera exigida depois de `failures` erros seguidos: 0 até `freeAttempts`; depois 30 s, 1 min, 2 min, 4 min…
 * até 15 min. Entrada inválida (negativa, fracionária, infinita) conta como o pior caso: o teto.
 */
export function delayAfterFailures(failures: number, policy: ThrottlePolicy = defaultThrottlePolicy): number {
  if (!Number.isInteger(failures) || failures < 0) return policy.maxDelayMs;
  if (failures < policy.freeAttempts) return 0;
  const exponent = failures - policy.freeAttempts;
  if (exponent >= 30) return policy.maxDelayMs;
  return Math.min(policy.baseDelayMs * 2 ** exponent, policy.maxDelayMs);
}

/**
 * Quanto falta para a próxima tentativa ser aceita (0 = pode tentar agora).
 * Se o relógio voltou para antes do último erro, a espera nunca passa da exigida (o relógio errado não tranca
 * ninguém por mais tempo); sem data do último erro, mas com erros contados, vale a espera inteira.
 */
export function remainingWaitMs(
  failures: number,
  lastFailedAt: number | null,
  now: number,
  policy: ThrottlePolicy = defaultThrottlePolicy,
): number {
  const delay = delayAfterFailures(failures, policy);
  if (delay === 0) return 0;
  if (lastFailedAt === null || !Number.isFinite(lastFailedAt) || !Number.isFinite(now)) return delay;
  const remaining = lastFailedAt + delay - now;
  if (remaining <= 0) return 0;
  return Math.min(remaining, delay);
}

/** Tentativas que ainda não geram espera (para a tela dizer "restam 2 antes de esperar"). */
export function freeAttemptsLeft(failures: number, policy: ThrottlePolicy = defaultThrottlePolicy): number {
  if (!Number.isInteger(failures) || failures < 0) return 0;
  return Math.max(0, policy.freeAttempts - failures);
}
