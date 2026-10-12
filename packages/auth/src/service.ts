import { DEFAULT_PASSWORD_COST, hashPassword, needsRehash, verifyPassword } from '@jesus/crypto/password';
import { generateRecoveryCode, normalizeRecoveryCode } from '@jesus/crypto/random';
import type { CredentialRepo } from './credentials';
import { checkNewPassword } from './policy';
import type { PasswordProblem } from './policy';
import { defaultThrottlePolicy, delayAfterFailures, freeAttemptsLeft, needsFailureAnchor, remainingWaitMs } from './throttle';
import type { ThrottlePolicy } from './throttle';

/**
 * Serviço de login local do Jesus (decisão 0015). Roda no processo principal do Electron; a interface só manda a
 * senha pela ponte de IPC e recebe um destes resultados, nunca o hash.
 */

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

/** Hasher de produção: bcrypt com o custo padrão (12). Os testes injetam um custo menor. */
export function bcryptHasher(cost: number = DEFAULT_PASSWORD_COST): PasswordHasher {
  return {
    hash: (password) => hashPassword(password, { cost }),
    verify: verifyPassword,
    needsRehash: (hash) => needsRehash(hash, cost),
  };
}

/** Operação que conferiu a senha ou o código: a auditoria separa um erro de digitação de um chute no código. */
export type SecretCheckOp = 'unlock' | 'change_password' | 'recover';

export type AuthAuditEvent =
  | { readonly type: 'auth.setup'; readonly at: number }
  | { readonly type: 'auth.unlock_ok'; readonly at: number; readonly rehashed: boolean }
  /** Senha (em `unlock` e `change_password`) ou código de recuperação (em `recover`) errado. */
  | { readonly type: 'auth.check_failed'; readonly at: number; readonly op: SecretCheckOp; readonly failures: number }
  /** Tentativa barrada pela espera. Uma vez por espera e operação: repetir a tentativa não enche a auditoria. */
  | { readonly type: 'auth.throttled'; readonly at: number; readonly op: SecretCheckOp; readonly waitMs: number }
  | { readonly type: 'auth.password_changed'; readonly at: number }
  | { readonly type: 'auth.recovery_used'; readonly at: number };

export interface AuthPorts {
  readonly repo: CredentialRepo;
  readonly clock: { now(): number };
  readonly hasher: PasswordHasher;
  /** Gera o código de recuperação para mostrar (forma em grupos). Injetável para testes. */
  readonly newRecoveryCode?: () => string;
  /** Registro de auditoria (sem senha, sem hash, sem código). */
  readonly audit?: (event: AuthAuditEvent) => void;
  readonly throttle?: ThrottlePolicy;
}

export type SetupResult =
  | { readonly ok: true; readonly recoveryCode: string }
  | { readonly ok: false; readonly reason: 'weak_password'; readonly problems: readonly PasswordProblem[] }
  | { readonly ok: false; readonly reason: 'already_set' }
  /** Outra operação (por exemplo, o primeiro clique de um duplo clique) ainda está em andamento. */
  | { readonly ok: false; readonly reason: 'busy' };

export type UnlockResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'wrong_password'; readonly retryAfterMs: number; readonly freeAttemptsLeft: number }
  | { readonly ok: false; readonly reason: 'throttled'; readonly retryAfterMs: number }
  | { readonly ok: false; readonly reason: 'not_set' }
  | { readonly ok: false; readonly reason: 'busy' };

export type ChangePasswordResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'weak_password'; readonly problems: readonly PasswordProblem[] }
  | Exclude<UnlockResult, { ok: true }>;

export type RecoveryResult =
  | { readonly ok: true; readonly recoveryCode: string }
  | { readonly ok: false; readonly reason: 'weak_password'; readonly problems: readonly PasswordProblem[] }
  | { readonly ok: false; readonly reason: 'invalid_code'; readonly retryAfterMs: number; readonly freeAttemptsLeft: number }
  | { readonly ok: false; readonly reason: 'throttled'; readonly retryAfterMs: number }
  | { readonly ok: false; readonly reason: 'not_set' }
  | { readonly ok: false; readonly reason: 'busy' };

export interface AuthService {
  /** `'setup_required'` na primeira vez; `'ready'` quando já existe senha. */
  status(): Promise<'setup_required' | 'ready'>;
  setup(password: string): Promise<SetupResult>;
  unlock(password: string): Promise<UnlockResult>;
  changePassword(current: string, next: string): Promise<ChangePasswordResult>;
  /** Troca a senha esquecida com o código de recuperação. O código usado é trocado por um novo. */
  recover(recoveryCode: string, newPassword: string): Promise<RecoveryResult>;
}

export function createAuthService(ports: AuthPorts): AuthService {
  const throttle = ports.throttle ?? defaultThrottlePolicy;
  const newRecoveryCode = ports.newRecoveryCode ?? (() => generateRecoveryCode());
  const audit = ports.audit ?? (() => undefined);
  // Uma conferência por vez: duas tentativas simultâneas não podem passar juntas pela checagem de espera.
  let busy = false;
  // Última espera já registrada na auditoria (operação, erros e data do último erro).
  let lastThrottleAudit: string | null = null;

  async function exclusive<T>(busyResult: T, run: () => Promise<T>): Promise<T> {
    if (busy) return busyResult;
    busy = true;
    try {
      return await run();
    } finally {
      busy = false;
    }
  }

  async function hashRecovery(displayCode: string): Promise<string> {
    const compact = normalizeRecoveryCode(displayCode);
    if (compact === null) throw new Error('gerador de código de recuperação inválido');
    return ports.hasher.hash(compact);
  }

  /** Confere um segredo (senha ou código) respeitando a espera progressiva, que é a mesma para os dois. */
  async function checkSecret(
    op: SecretCheckOp,
    verify: (record: { passwordHash: string; recoveryHash: string }) => Promise<boolean>,
  ): Promise<
    | { ok: true; passwordHash: string }
    | { ok: false; reason: 'not_set' }
    | { ok: false; reason: 'throttled'; retryAfterMs: number }
    | { ok: false; reason: 'wrong'; retryAfterMs: number; freeAttemptsLeft: number }
  > {
    const record = await ports.repo.load();
    if (record === null) return { ok: false, reason: 'not_set' };
    const now = ports.clock.now();
    let lastFailedAt = record.lastFailedAt;
    if (needsFailureAnchor(record.failedAttempts, lastFailedAt, now)) {
      // O relógio voltou para antes do último erro: a espera passa a contar de agora (no máximo a exigida).
      await ports.repo.anchorFailureClock(now);
      lastFailedAt = now;
    }
    const wait = remainingWaitMs(record.failedAttempts, lastFailedAt, now, throttle);
    if (wait > 0) {
      const key = `${op}:${String(record.failedAttempts)}:${String(lastFailedAt)}`;
      if (key !== lastThrottleAudit) {
        lastThrottleAudit = key;
        audit({ type: 'auth.throttled', at: now, op, waitMs: wait });
      }
      return { ok: false, reason: 'throttled', retryAfterMs: wait };
    }
    if (await verify(record)) {
      if (record.failedAttempts > 0) await ports.repo.recordSuccess();
      return { ok: true, passwordHash: record.passwordHash };
    }
    const failures = await ports.repo.recordFailure(ports.clock.now());
    audit({ type: 'auth.check_failed', at: now, op, failures });
    return {
      ok: false,
      reason: 'wrong',
      retryAfterMs: delayAfterFailures(failures, throttle),
      freeAttemptsLeft: freeAttemptsLeft(failures, throttle),
    };
  }

  return {
    async status() {
      return (await ports.repo.load()) === null ? 'setup_required' : 'ready';
    },

    setup(password) {
      return exclusive<SetupResult>({ ok: false, reason: 'busy' }, async () => {
        if ((await ports.repo.load()) !== null) return { ok: false, reason: 'already_set' };
        const check = checkNewPassword(password);
        if (!check.ok) return { ok: false, reason: 'weak_password', problems: check.problems };
        const recoveryCode = newRecoveryCode();
        const at = ports.clock.now();
        const created = await ports.repo.create({
          passwordHash: await ports.hasher.hash(password),
          recoveryHash: await hashRecovery(recoveryCode),
          at,
        });
        if (created === 'exists') return { ok: false, reason: 'already_set' };
        audit({ type: 'auth.setup', at });
        return { ok: true, recoveryCode };
      });
    },

    unlock(password) {
      return exclusive<UnlockResult>({ ok: false, reason: 'busy' }, async () => {
        const result = await checkSecret('unlock', (r) => ports.hasher.verify(password, r.passwordHash));
        if (!result.ok) {
          if (result.reason === 'wrong') {
            return { ok: false, reason: 'wrong_password', retryAfterMs: result.retryAfterMs, freeAttemptsLeft: result.freeAttemptsLeft };
          }
          return result;
        }
        // Custo subiu desde que o hash foi feito: refaz agora, enquanto a senha está à mão.
        const rehashed = ports.hasher.needsRehash(result.passwordHash);
        if (rehashed) {
          await ports.repo.replaceSecrets({ passwordHash: await ports.hasher.hash(password), at: ports.clock.now() });
        }
        audit({ type: 'auth.unlock_ok', at: ports.clock.now(), rehashed });
        return { ok: true };
      });
    },

    changePassword(current, next) {
      return exclusive<ChangePasswordResult>({ ok: false, reason: 'busy' }, async () => {
        const check = checkNewPassword(next);
        if (!check.ok) return { ok: false, reason: 'weak_password', problems: check.problems };
        const result = await checkSecret('change_password', (r) => ports.hasher.verify(current, r.passwordHash));
        if (!result.ok) {
          if (result.reason === 'wrong') {
            return { ok: false, reason: 'wrong_password', retryAfterMs: result.retryAfterMs, freeAttemptsLeft: result.freeAttemptsLeft };
          }
          return result;
        }
        const at = ports.clock.now();
        await ports.repo.replaceSecrets({ passwordHash: await ports.hasher.hash(next), at });
        audit({ type: 'auth.password_changed', at });
        return { ok: true };
      });
    },

    recover(recoveryCode, newPassword) {
      return exclusive<RecoveryResult>({ ok: false, reason: 'busy' }, async () => {
        const check = checkNewPassword(newPassword);
        if (!check.ok) return { ok: false, reason: 'weak_password', problems: check.problems };
        const compact = normalizeRecoveryCode(recoveryCode);
        // Código malformado conta como erro (mesma espera), sem gastar um bcrypt.
        const result = await checkSecret('recover', (r) =>
          compact === null ? Promise.resolve(false) : ports.hasher.verify(compact, r.recoveryHash),
        );
        if (!result.ok) {
          if (result.reason === 'wrong') {
            return { ok: false, reason: 'invalid_code', retryAfterMs: result.retryAfterMs, freeAttemptsLeft: result.freeAttemptsLeft };
          }
          return result;
        }
        const fresh = newRecoveryCode();
        const at = ports.clock.now();
        await ports.repo.replaceSecrets({
          passwordHash: await ports.hasher.hash(newPassword),
          recoveryHash: await hashRecovery(fresh),
          at,
        });
        audit({ type: 'auth.recovery_used', at });
        audit({ type: 'auth.password_changed', at });
        return { ok: true, recoveryCode: fresh };
      });
    },
  };
}
