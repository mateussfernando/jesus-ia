import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CredentialRecord, CredentialRepo } from '@jesus/auth';
import { isBcryptHash } from '@jesus/crypto/password';
import { z } from 'zod';

/**
 * Credencial local num arquivo JSON (decisão 0016): usada no desenvolvimento e na fase 1, até o PostgreSQL
 * embutido chegar (fase 4); com `JESUS_DATABASE_URL`, o servidor usa o repositório Prisma do `@jesus/db`.
 *
 * O arquivo guarda só hashes bcrypt e contadores. Cada gravação escreve um arquivo temporário, força a ida dele
 * ao disco (`fsync`) e troca pelo nome final (troca atômica): nem uma queda do processo nem uma queda de energia
 * deixam o arquivo pela metade. No Windows, a troca é tentada de novo por um instante se um antivírus ou o
 * indexador estiver segurando o arquivo. As operações deste processo passam por uma fila, então os contadores
 * não se perdem. Arquivo ilegível ou com hash fora do
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

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 10;

/** Troca o arquivo; no Windows, um antivírus segurando o destino dá EPERM/EBUSY por um instante. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (process.platform !== 'win32' || !RENAME_RETRY_CODES.has(code) || attempt >= RENAME_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

/** Grava no disco a troca de nome (fora do Windows, onde abrir uma pasta não é permitido). */
async function syncDirectory(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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
      const handle = await open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(checked, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await renameWithRetry(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    await syncDirectory(dirname(path));
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

    anchorFailureClock: (at) =>
      exclusive(async () => {
        const file = await read();
        if (file === null || file.failedAttempts === 0) return;
        if (file.lastFailedAt !== null && file.lastFailedAt <= at) return;
        await write({ ...file, lastFailedAt: at });
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
