/**
 * Credencial local do Jesus: uma linha só, com os hashes bcrypt da senha e do código de recuperação e a contagem
 * de erros seguidos. Nada aqui é segredo legível: são hashes e números (decisão 0015).
 */

export interface CredentialRecord {
  readonly passwordHash: string;
  readonly recoveryHash: string;
  /** Erros seguidos desde o último acerto (senha ou código de recuperação). */
  readonly failedAttempts: number;
  /** Instante do último erro, em ms desde 1970 (relógio de parede). */
  readonly lastFailedAt: number | null;
  readonly createdAt: number;
  readonly passwordChangedAt: number;
}

/**
 * Porta de persistência. A implementação de verdade fica no `@jesus/db` (Prisma, tabela `app_credentials`);
 * os testes e o modo de demonstração da interface usam `createMemoryCredentialRepo`.
 */
export interface CredentialRepo {
  load(): Promise<CredentialRecord | null>;
  /** Cria a credencial. Se já existe, não muda nada e devolve `'exists'`. */
  create(record: { passwordHash: string; recoveryHash: string; at: number }): Promise<'created' | 'exists'>;
  /** Soma um erro de forma atômica e devolve a nova contagem. */
  recordFailure(at: number): Promise<number>;
  /** Zera a contagem de erros. */
  recordSuccess(): Promise<void>;
  /** Troca os hashes (senha, código de recuperação ou os dois) e zera a contagem de erros. */
  replaceSecrets(change: { passwordHash?: string; recoveryHash?: string; at: number }): Promise<void>;
}

/** Repositório em memória, para testes e para a demonstração no navegador (nada é guardado). */
export function createMemoryCredentialRepo(initial: CredentialRecord | null = null): CredentialRepo & {
  snapshot(): CredentialRecord | null;
} {
  let record: CredentialRecord | null = initial;
  return {
    load: () => Promise.resolve(record),
    create: ({ passwordHash, recoveryHash, at }) => {
      if (record !== null) return Promise.resolve('exists' as const);
      record = { passwordHash, recoveryHash, failedAttempts: 0, lastFailedAt: null, createdAt: at, passwordChangedAt: at };
      return Promise.resolve('created' as const);
    },
    recordFailure: (at) => {
      if (record === null) return Promise.reject(new Error('credencial inexistente'));
      record = { ...record, failedAttempts: record.failedAttempts + 1, lastFailedAt: at };
      return Promise.resolve(record.failedAttempts);
    },
    recordSuccess: () => {
      if (record !== null) record = { ...record, failedAttempts: 0, lastFailedAt: null };
      return Promise.resolve();
    },
    replaceSecrets: ({ passwordHash, recoveryHash, at }) => {
      if (record === null) return Promise.reject(new Error('credencial inexistente'));
      record = {
        ...record,
        passwordHash: passwordHash ?? record.passwordHash,
        recoveryHash: recoveryHash ?? record.recoveryHash,
        passwordChangedAt: passwordHash === undefined ? record.passwordChangedAt : at,
        failedAttempts: 0,
        lastFailedAt: null,
      };
      return Promise.resolve();
    },
    snapshot: () => record,
  };
}
