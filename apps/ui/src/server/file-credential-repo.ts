import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CredentialRecord, CredentialRepo } from '@jesus/auth';
import { isBcryptHash } from '@jesus/crypto/password';
import { z } from 'zod';

/**
 * Credencial local num arquivo JSON (decisão 0016): usada no desenvolvimento e na fase 1, até o PostgreSQL
 * embutido chegar (fase 4); com `JESUS_DATABASE_URL`, o servidor usa o repositório Prisma do `@jesus/db`.
 *
 * O arquivo guarda só hashes bcrypt e contadores. Cada gravação escreve um arquivo temporário e troca pelo
 * nome final (troca atômica): uma queda no meio nunca deixa o arquivo pela metade. As operações deste
 * processo passam por uma fila, então os contadores não se perdem. Arquivo ilegível ou com hash fora do
 * formato bcrypt faz a leitura falhar (falha fechada): ninguém desbloqueia com dados adulterados.
 */

const bcryptHash = z.string().refine(isBcryptHash, 'não é um hash bcrypt');
const timestamp = z.number().int().nonnegative();

const fileSchema = z
  .object({
    version: z.literal(1),
    passwordHash: bcryptHash,
    recoveryHash: bcryptHash,
    failedAttempts: z.number().int().nonnegative(),
    lastFailedAt: timestamp.nullable(),
    createdAt: timestamp,
    passwordChangedAt: timestamp,
  })
  .strict();

type StoredFile = z.infer<typeof fileSchema>;

export class CredentialFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialFileError';
  }
}

function toRecord(file: StoredFile): CredentialRecord {
  return {
    passwordHash: file.passwordHash,
    recoveryHash: file.recoveryHash,
    failedAttempts: file.failedAttempts,
    lastFailedAt: file.lastFailedAt,
    createdAt: file.createdAt,
    passwordChangedAt: file.passwordChangedAt,
  };
}

export function createFileCredentialRepo(path: string): CredentialRepo {
  let queue: Promise<unknown> = Promise.resolve();

  /** Uma operação por vez neste processo. */
  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  async function read(): Promise<StoredFile | null> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CredentialFileError('arquivo da senha ilegível');
    }
    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) throw new CredentialFileError('arquivo da senha com formato inválido');
    return parsed.data;
  }

  async function write(file: StoredFile): Promise<void> {
    const checked = fileSchema.parse(file);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(checked, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async function mustRead(): Promise<StoredFile> {
    const file = await read();
    if (file === null) throw new CredentialFileError('credencial inexistente');
    return file;
  }

  return {
    load: () => exclusive(async () => {
      const file = await read();
      return file === null ? null : toRecord(file);
    }),

    create: ({ passwordHash, recoveryHash, at }) =>
      exclusive(async () => {
        if ((await read()) !== null) return 'exists' as const;
        await write({
          version: 1,
          passwordHash,
          recoveryHash,
          failedAttempts: 0,
          lastFailedAt: null,
          createdAt: at,
          passwordChangedAt: at,
        });
        return 'created' as const;
      }),

    recordFailure: (at) =>
      exclusive(async () => {
        const file = await mustRead();
        const failedAttempts = file.failedAttempts + 1;
        await write({ ...file, failedAttempts, lastFailedAt: at });
        return failedAttempts;
      }),

    recordSuccess: () =>
      exclusive(async () => {
        const file = await read();
        if (file === null || (file.failedAttempts === 0 && file.lastFailedAt === null)) return;
        await write({ ...file, failedAttempts: 0, lastFailedAt: null });
      }),

    replaceSecrets: ({ passwordHash, recoveryHash, at }) =>
      exclusive(async () => {
        const file = await mustRead();
        await write({
          ...file,
          passwordHash: passwordHash ?? file.passwordHash,
          recoveryHash: recoveryHash ?? file.recoveryHash,
          passwordChangedAt: passwordHash === undefined ? file.passwordChangedAt : at,
          failedAttempts: 0,
          lastFailedAt: null,
        });
      }),
  };
}
