import { join } from 'node:path';

/**
 * Onde fica a senha local do Jesus (decisão 0016):
 * - com `JESUS_DATABASE_URL`, na tabela `app_credentials` do PostgreSQL, pelo repositório Prisma do `@jesus/db`;
 * - sem ela, num arquivo JSON da pasta de dados (`JESUS_DATA_DIR`; no desenvolvimento, `.jesus-dev`).
 *
 * Falha fechada: URL presente e fora do formato faz a inicialização falhar (o servidor nunca cai calado para o
 * arquivo achando que usa o banco), e no app (`JESUS_HTTPS=1`) é preciso dizer onde fica a senha: uma pasta
 * errada faria o Jesus abrir pedindo uma senha nova. As mensagens de erro não repetem a URL, que traz a senha
 * do banco.
 */
export type CredentialStore =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'database'; readonly url: string };

export const DATABASE_URL_ENV = 'JESUS_DATABASE_URL';
export const DATA_DIR_ENV = 'JESUS_DATA_DIR';
export const CREDENTIAL_FILE = 'credentials.json';

export class CredentialStoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreConfigError';
  }
}

const POSTGRES_URL = /^postgres(?:ql)?:\/\/[^\s]+$/;

export function credentialStoreFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): CredentialStore {
  const url = env[DATABASE_URL_ENV];
  if (url !== undefined && url !== '') {
    if (!POSTGRES_URL.test(url)) {
      throw new CredentialStoreConfigError(`${DATABASE_URL_ENV} precisa ser uma URL postgresql:// sem espaços`);
    }
    return { kind: 'database', url };
  }
  const dir = env[DATA_DIR_ENV];
  if (dir !== undefined && dir !== '') return { kind: 'file', path: join(dir, CREDENTIAL_FILE) };
  if (env['JESUS_HTTPS'] === '1') {
    throw new CredentialStoreConfigError(`no app, defina ${DATA_DIR_ENV} ou ${DATABASE_URL_ENV}`);
  }
  return { kind: 'file', path: join(cwd, '.jesus-dev', CREDENTIAL_FILE) };
}
