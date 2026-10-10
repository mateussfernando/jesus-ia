import type { CredentialRecord, CredentialRepo } from '@jesus/auth';
import type { PrismaClient } from './generated/prisma/client';

/**
 * Repositório da senha local do Jesus (decisão 0015) sobre a tabela `app_credentials`. Implementa a porta
 * `CredentialRepo` do `@jesus/auth`. As operações que contam erros são atômicas no banco
 * (`failed_attempts = failed_attempts + 1`), então duas tentativas não se perdem uma na outra.
 */
const SINGLE_ROW = 1;

export function createCredentialRepo(prisma: PrismaClient): CredentialRepo {
  return {
    async load() {
      const row = await prisma.appCredential.findUnique({ where: { id: SINGLE_ROW } });
      if (row === null) return null;
      const record: CredentialRecord = {
        passwordHash: row.passwordHash,
        recoveryHash: row.recoveryHash,
        failedAttempts: row.failedAttempts,
        lastFailedAt: row.lastFailedAt === null ? null : row.lastFailedAt.getTime(),
        createdAt: row.createdAt.getTime(),
        passwordChangedAt: row.passwordChangedAt.getTime(),
      };
      return record;
    },

    async create({ passwordHash, recoveryHash, at }) {
      // ON CONFLICT DO NOTHING: se a credencial já existe, nada muda.
      const { count } = await prisma.appCredential.createMany({
        data: [
          {
            id: SINGLE_ROW,
            passwordHash,
            recoveryHash,
            createdAt: new Date(at),
            passwordChangedAt: new Date(at),
          },
        ],
        skipDuplicates: true,
      });
      return count === 1 ? 'created' : 'exists';
    },

    async recordFailure(at) {
      const row = await prisma.appCredential.update({
        where: { id: SINGLE_ROW },
        data: { failedAttempts: { increment: 1 }, lastFailedAt: new Date(at) },
        select: { failedAttempts: true },
      });
      return row.failedAttempts;
    },

    async recordSuccess() {
      await prisma.appCredential.updateMany({
        where: { id: SINGLE_ROW },
        data: { failedAttempts: 0, lastFailedAt: null },
      });
    },

    async replaceSecrets({ passwordHash, recoveryHash, at }) {
      await prisma.appCredential.update({
        where: { id: SINGLE_ROW },
        data: {
          ...(passwordHash === undefined ? {} : { passwordHash, passwordChangedAt: new Date(at) }),
          ...(recoveryHash === undefined ? {} : { recoveryHash }),
          failedAttempts: 0,
          lastFailedAt: null,
        },
      });
    },
  };
}
