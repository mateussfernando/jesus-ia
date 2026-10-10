import { createHash } from 'node:crypto';
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
  | { readonly ok: false; readonly error: 'checksum_mismatch' | 'unknown_applied' | 'out_of_order' | 'duplicate_name'; readonly name: string };

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;

/**
 * SHA-256 do SQL com as quebras de linha normalizadas para LF: o mesmo arquivo baixado no Windows com
 * `core.autocrlf` (CRLF) continua com a mesma soma.
 */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
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

/**
 * Aplica as migrações pendentes. Cada arquivo roda numa transação própria, junto com o registro em
 * `jesus_migrations`: ou entra inteiro, ou não entra. Devolve os nomes aplicados.
 */
export async function applyMigrations(client: ClientBase, files: readonly MigrationFile[]): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS jesus_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM jesus_migrations ORDER BY name',
    );
    const plan = planMigrations(files, rows);
    if (!plan.ok) throw new MigrationError(plan.error, plan.name);
    const done: string[] = [];
    for (const migration of plan.pending) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
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
