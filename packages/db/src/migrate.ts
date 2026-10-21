import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientBase } from 'pg';

/**
 * Migrador do Jesus (decisão 0014). No PC do usuário, quem aplica as migrações é o próprio app, sem a CLI do
 * Prisma: lê `prisma/migrations/<nome>/migration.sql` em ordem, aplica cada arquivo numa transação e guarda o
 * nome e a soma SHA-256 em `jesus_migrations`. Falha fechada: arquivo já aplicado que mudou, migração aplicada
 * que o app não conhece (versão mais antiga do app) ou migração nova fora de ordem impedem a abertura do banco.
 */

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
}

export type MigrationPlan =
  | { readonly ok: true; readonly pending: readonly MigrationFile[] }
  | {
      readonly ok: false;
      readonly error: 'checksum_mismatch' | 'unknown_applied' | 'out_of_order' | 'duplicate_name' | 'transaction_control';
      readonly name: string;
    };

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;

/**
 * SHA-256 do SQL com as quebras de linha normalizadas para LF: o mesmo arquivo baixado no Windows com
 * `core.autocrlf` (CRLF) continua com a mesma soma.
 */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
}

/** Caractere que continua um identificador no PostgreSQL (`ident_cont`: letras, dígitos, `_`, `$` e todo não ASCII). */
const IDENT_CONT = /[\w$\u0080-\uFFFF]/;
/** Marca de *dollar quote*: `$$` ou `$tag$`, com a tag começando por letra, `_` ou caractere não ASCII. */
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF]*)?\$/;

/**
 * Comandos do SQL, sem comentários e com strings, identificadores entre aspas e corpos `$tag$…$tag$` trocados
 * por marcadores: um `END` dentro de um `DO $$ … END $$` ou de uma string não conta como comando. Lê como o
 * analisador do PostgreSQL com `standard_conforming_strings = on`, que o migrador fixa antes de cada arquivo.
 */
export function sqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      // O comentário termina no primeiro \n ou \r, como no PostgreSQL.
      let end = i + 2;
      while (end < sql.length && sql[end] !== '\n' && sql[end] !== '\r') end++;
      i = end;
      current += ' ';
    } else if (c === '/' && next === '*') {
      // Comentários de bloco do PostgreSQL podem ser aninhados.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      current += ' ';
    } else if (c === "'") {
      // E'…' aceita \' dentro; nas strings comuns, só '' escapa a aspa.
      const prev = current.at(-1);
      const beforePrev = current.at(-2);
      const escapes = (prev === 'E' || prev === 'e') && (beforePrev === undefined || !IDENT_CONT.test(beforePrev));
      i++;
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      current += "''";
    } else if (c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') {
          i++;
          break;
        } else i++;
      }
      current += '""';
    } else if (c === '$' && !IDENT_CONT.test(current.at(-1) ?? ' ')) {
      const tag = DOLLAR_TAG.exec(sql.slice(i));
      if (tag === null) {
        current += c;
        i++;
      } else {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? sql.length : end + tag[0].length;
        current += ' $$ ';
      }
    } else if (c === ';') {
      if (current.trim() !== '') statements.push(current.trim());
      current = '';
      i++;
    } else {
      current += c;
      i++;
    }
  }
  if (current.trim() !== '') statements.push(current.trim());
  return statements;
}

const TRANSACTION_CONTROL =
  /^(?:BEGIN|COMMIT|ROLLBACK|ABORT|END|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/i;

/**
 * Primeiro comando de controle de transação do arquivo (`BEGIN`, `COMMIT`, `ROLLBACK`…), ou `null`. O migrador
 * já abre a transação de cada arquivo: um `COMMIT` no arquivo fecharia essa transação no meio, gravando metade
 * da migração sem registrá-la (o `prisma migrate dev` gera `BEGIN;`/`COMMIT;` para mudar enums). Corpos de
 * função com `BEGIN ATOMIC … END` também caem aqui: use o corpo entre `$$`.
 */
export function findTransactionControl(sql: string): string | null {
  for (const statement of sqlStatements(sql)) {
    const match = TRANSACTION_CONTROL.exec(statement);
    if (match !== null) return match[0].toUpperCase().replace(/\s+/g, ' ');
  }
  return null;
}

/** Decide o que aplicar. Lógica pura: não lê disco nem banco. */
export function planMigrations(available: readonly MigrationFile[], applied: readonly AppliedMigration[]): MigrationPlan {
  const sorted = [...available].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev !== undefined && cur !== undefined && prev.name === cur.name) {
      return { ok: false, error: 'duplicate_name', name: cur.name };
    }
  }
  const byName = new Map(sorted.map((m) => [m.name, m]));
  let lastApplied = '';
  for (const done of applied) {
    const file = byName.get(done.name);
    if (file === undefined) return { ok: false, error: 'unknown_applied', name: done.name };
    if (file.checksum !== done.checksum) return { ok: false, error: 'checksum_mismatch', name: done.name };
    if (done.name > lastApplied) lastApplied = done.name;
  }
  const appliedNames = new Set(applied.map((m) => m.name));
  const pending = sorted.filter((m) => !appliedNames.has(m.name));
  const early = pending.find((m) => m.name < lastApplied);
  if (early !== undefined) return { ok: false, error: 'out_of_order', name: early.name };
  const withControl = pending.find((m) => findTransactionControl(m.sql) !== null);
  if (withControl !== undefined) return { ok: false, error: 'transaction_control', name: withControl.name };
  return { ok: true, pending };
}

/** Lê as migrações de uma pasta (`<nome>/migration.sql`). Pastas com nome fora do padrão são recusadas. */
export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!MIGRATION_NAME.test(entry.name)) throw new Error(`nome de migração fora do padrão: ${entry.name}`);
    const sql = await readFile(join(dir, entry.name, 'migration.sql'), 'utf8');
    files.push({ name: entry.name, sql, checksum: migrationChecksum(sql) });
  }
  return files.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Pasta das migrações deste pacote, para testes e desenvolvimento. O app instalado leva as migrações como
 * recurso e passa o caminho de forma explícita.
 */
export function defaultMigrationsDir(): string {
  return fileURLToPath(new URL('../prisma/migrations', import.meta.url));
}

export class MigrationError extends Error {
  readonly code: Exclude<MigrationPlan, { ok: true }>['error'];
  readonly migration: string;

  constructor(code: Exclude<MigrationPlan, { ok: true }>['error'], migration: string) {
    super(`migração recusada (${code}): ${migration}`);
    this.name = 'MigrationError';
    this.code = code;
    this.migration = migration;
  }
}

/** Número fixo da trava consultiva: duas instâncias do app não migram ao mesmo tempo. */
const MIGRATION_LOCK_KEY = 0x4a_45_53_55; // "JESU"

/** Marca da transação do migrador: some se o arquivo fechar ou desfizer a transação. */
const TX_MARKER = 'jesus.migration_tx';

/**
 * Aplica as migrações pendentes. Cada arquivo roda numa transação própria, junto com o registro em
 * `jesus_migrations`: ou entra inteiro, ou não entra. Devolve os nomes aplicados.
 */
export async function applyMigrations(client: ClientBase, files: readonly MigrationFile[]): Promise<string[]> {
  // A trava vem antes de tudo, até da tabela de controle: dois `CREATE TABLE IF NOT EXISTS` ao mesmo tempo
  // num banco novo esbarram no catálogo do PostgreSQL e um deles falha em vez de esperar.
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS jesus_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM jesus_migrations ORDER BY name',
    );
    const plan = planMigrations(files, rows);
    if (!plan.ok) throw new MigrationError(plan.error, plan.name);
    const done: string[] = [];
    for (const migration of plan.pending) {
      await client.query('BEGIN');
      try {
        // Só SET aqui: um SELECT tiraria o primeiro snapshot, e um arquivo que começa com SET TRANSACTION falharia.
        // O SQL do arquivo é lido sempre com standard_conforming_strings ligado, como a checagem do texto supõe,
        // mesmo que um arquivo anterior tenha desligado na sessão.
        const token = randomBytes(16).toString('hex');
        await client.query('SET LOCAL standard_conforming_strings = on');
        await client.query(`SET LOCAL ${TX_MARKER} = '${token}'`);
        await client.query(migration.sql);
        // Segunda barreira, além da checagem do texto: se o arquivo fechou ou desfez a transação do migrador, a
        // marca local some e nada é registrado como aplicado.
        const { rows: marker } = await client.query<{ value: string | null }>(
          `SELECT current_setting('${TX_MARKER}', true) AS value`,
        );
        if (marker[0]?.value !== token) throw new MigrationError('transaction_control', migration.name);
        await client.query('INSERT INTO jesus_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      done.push(migration.name);
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}
