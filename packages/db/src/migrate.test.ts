import { describe, expect, it } from 'vitest';
import { defaultMigrationsDir, findTransactionControl, migrationChecksum, planMigrations, readMigrations, sqlStatements } from './migrate';
import type { MigrationFile } from './migrate';

function file(name: string, sql = `-- ${name}`): MigrationFile {
  return { name, sql, checksum: migrationChecksum(sql) };
}

const a = file('20261010000000_a');
const b = file('20261011000000_b');
const c = file('20261012000000_c');

describe('planMigrations', () => {
  it('aplica tudo num banco novo, em ordem de nome', () => {
    const plan = planMigrations([c, a, b], []);
    expect(plan).toEqual({ ok: true, pending: [a, b, c] });
  });

  it('aplica só o que falta', () => {
    const plan = planMigrations([a, b, c], [{ name: a.name, checksum: a.checksum }]);
    expect(plan.ok && plan.pending.map((m) => m.name)).toEqual([b.name, c.name]);
  });

  it('recusa arquivo já aplicado que mudou', () => {
    const changed = file(a.name, '-- mudou');
    expect(planMigrations([changed, b], [{ name: a.name, checksum: a.checksum }])).toEqual({
      ok: false,
      error: 'checksum_mismatch',
      name: a.name,
    });
  });

  it('recusa banco com migração que o app não conhece (app mais antigo que o banco)', () => {
    expect(planMigrations([a], [{ name: b.name, checksum: b.checksum }])).toMatchObject({
      ok: false,
      error: 'unknown_applied',
      name: b.name,
    });
  });

  it('recusa migração nova com nome anterior à última aplicada', () => {
    expect(planMigrations([a, b, c], [{ name: c.name, checksum: c.checksum }])).toMatchObject({
      ok: false,
      error: 'out_of_order',
    });
  });

  it('recusa nomes repetidos', () => {
    expect(planMigrations([a, file(a.name, '-- outra')], [])).toMatchObject({ ok: false, error: 'duplicate_name' });
  });
});

describe('controle de transação dentro do arquivo', () => {
  const enumFromPrisma = [
    '-- AlterEnum',
    'BEGIN;',
    'CREATE TYPE "Role_new" AS ENUM (\'A\', \'B\');',
    'ALTER TYPE "Role" RENAME TO "Role_old";',
    'COMMIT;',
  ].join('\n');

  it('acusa BEGIN, COMMIT, ROLLBACK e parentes no começo de um comando', () => {
    expect(findTransactionControl(enumFromPrisma)).toBe('BEGIN');
    expect(findTransactionControl('CREATE TABLE t (x int); COMMIT;')).toBe('COMMIT');
    expect(findTransactionControl('CREATE TABLE important (id int);\nROLLBACK;')).toBe('ROLLBACK');
    expect(findTransactionControl('select 1; start   transaction; select 2')).toBe('START TRANSACTION');
    expect(findTransactionControl('SAVEPOINT a; RELEASE a;')).toBe('SAVEPOINT');
    expect(findTransactionControl('/* x */ end;')).toBe('END');
    expect(findTransactionControl('abort')).toBe('ABORT');
  });

  it('não confunde com END de bloco DO, strings, identificadores nem comentários', () => {
    const roles = [
      'DO $$',
      'BEGIN',
      '  CREATE ROLE jesus_app NOLOGIN;',
      'EXCEPTION WHEN duplicate_object THEN NULL;',
      'END',
      '$$;',
      "COMMENT ON TABLE t IS 'BEGIN; COMMIT;';",
      "SELECT E'it\\'s; COMMIT;';",
      'SELECT "commit" FROM "x;y";',
      '-- COMMIT;',
      '/* outer /* ROLLBACK; */ still comment; COMMIT; */',
      'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $body$ BEGIN RETURN 1; END $body$;',
      'SELECT CASE WHEN true THEN 1 END;',
      'SELECT $1;',
    ].join('\n');
    expect(findTransactionControl(roles)).toBeNull();
  });

  it('lê como o PostgreSQL: comentário até \\r, identificador com acento e tag de dollar quote com acento', () => {
    // Comentário termina em \r sozinho (arquivo com quebras de linha do Mac antigo).
    expect(findTransactionControl('-- AlterEnum\rBEGIN;\rCREATE TABLE cr_a (id int);\rCOMMIT;\r')).toBe('BEGIN');
    // `café$x$` é um identificador só (o $ continua o identificador), não um dollar quote.
    expect(findTransactionControl('CREATE TABLE café$x$ (id int);\nCOMMIT;\nCREATE TABLE b$x$ (id int);')).toBe('COMMIT');
    // `ñE'x\'` é o identificador `ñe` seguido de uma string comum, não uma E-string.
    expect(findTransactionControl("SELECT ñE'x\\';\nCOMMIT;\nSELECT 1;")).toBe('COMMIT');
    // Tag com acento é válida no PostgreSQL: o END do corpo não conta.
    expect(
      findTransactionControl('CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $função$ BEGIN RETURN 1; END; $função$;'),
    ).toBeNull();
  });

  it('separa os comandos sem os trechos citados', () => {
    expect(sqlStatements("SELECT 'a;b'; -- c;\nSELECT 2;")).toEqual(["SELECT ''", 'SELECT 2']);
    expect(sqlStatements('DO $x$ BEGIN END $x$; SELECT 1')).toEqual(['DO  $$', 'SELECT 1']);
  });

  it('a migração pendente com controle de transação é recusada antes de aplicar qualquer coisa', () => {
    const ok = file('20260101000000_a');
    const bad = { ...file('20260102000000_b'), sql: enumFromPrisma };
    expect(planMigrations([ok, bad], [])).toEqual({ ok: false, error: 'transaction_control', name: bad.name });
  });

  it('as migrações do pacote não têm controle de transação', async () => {
    for (const f of await readMigrations(defaultMigrationsDir())) expect(findTransactionControl(f.sql), f.name).toBeNull();
  });
});

describe('migrationChecksum', () => {
  it('ignora a diferença entre CRLF e LF (git no Windows)', () => {
    expect(migrationChecksum('SELECT 1;\r\nSELECT 2;\r\n')).toBe(migrationChecksum('SELECT 1;\nSELECT 2;\n'));
    expect(migrationChecksum('SELECT 1;')).not.toBe(migrationChecksum('SELECT 2;'));
  });
});

describe('readMigrations', () => {
  it('lê as migrações do pacote com nomes no padrão e SQL não vazio', async () => {
    const files = await readMigrations(defaultMigrationsDir());
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.name).toMatch(/^\d{14}_[a-z0-9_]+$/);
      expect(f.sql.trim().length).toBeGreaterThan(0);
      expect(f.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(files.map((f) => f.name)).toContain('20261010000000_app_credentials');
  });
});
