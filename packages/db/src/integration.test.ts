import { randomBytes } from 'node:crypto';
import { bcryptHasher, createAuthService } from '@jesus/auth';
import { hashPassword } from '@jesus/crypto/password';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient } from './client';
import type { PrismaClient } from './client';
import { createCredentialRepo } from './credentials';
import { MigrationError, applyMigrations, defaultMigrationsDir, migrationChecksum, readMigrations } from './migrate';

/**
 * Testes contra um PostgreSQL de verdade (decisão 0014). Rodam só com `JESUS_TEST_DATABASE_URL` apontando para
 * um servidor de teste (no CI, um contêiner de serviço); cada execução cria um banco próprio e apaga no fim.
 */
const adminUrl = process.env['JESUS_TEST_DATABASE_URL'];
const suite = adminUrl === undefined || adminUrl === '' ? describe.skip : describe;

suite('banco de verdade', () => {
  const dbName = `jesus_test_${randomBytes(6).toString('hex')}`;
  let dbUrl = '';
  let admin: pg.Client;
  let client: pg.Client;
  let prisma: PrismaClient;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl ?? '');
    url.pathname = `/${dbName}`;
    dbUrl = url.toString();
    client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    prisma = createDbClient(dbUrl);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it('aplica as migrações uma vez só', async () => {
    const files = await readMigrations(defaultMigrationsDir());
    expect(await applyMigrations(client, files)).toEqual(files.map((f) => f.name));
    expect(await applyMigrations(client, files)).toEqual([]);
  });

  it('várias instâncias migrando um banco novo ao mesmo tempo: uma aplica, as outras esperam a trava', async () => {
    const name = `jesus_test_${randomBytes(6).toString('hex')}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(adminUrl ?? '');
    url.pathname = `/${name}`;
    const clients = Array.from({ length: 6 }, () => new pg.Client({ connectionString: url.toString() }));
    try {
      await Promise.all(clients.map((c) => c.connect()));
      const files = await readMigrations(defaultMigrationsDir());
      const results = await Promise.all(clients.map((c) => applyMigrations(c, files)));
      expect(results.filter((r) => r.length > 0)).toEqual([files.map((f) => f.name)]);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  });

  it('arquivo que fecha ou desfaz a transação do migrador não é registrado como aplicado', async () => {
    const files = await readMigrations(defaultMigrationsDir());
    const sneaky = (name: string, sql: string) => ({ name, sql, checksum: migrationChecksum(sql) });
    // A checagem do texto pega antes de rodar qualquer coisa.
    await expect(
      applyMigrations(client, [...files, sneaky('20990101000000_commit', 'CREATE TABLE half (id int); COMMIT;')]),
    ).rejects.toMatchObject({ code: 'transaction_control' });
    const half = await client.query("SELECT to_regclass('half') AS t");
    expect(half.rows[0]).toEqual({ t: null });
    const { rows } = await client.query('SELECT name FROM jesus_migrations ORDER BY name');
    expect(rows.map((r: { name: string }) => r.name)).toEqual(files.map((f) => f.name));

    // Se a checagem do texto deixasse passar, o id da transação acusa: simula um COMMIT que ela não viu.
    const marker = 'SELECT 1 AS escondido';
    const leaky = {
      query: (text: unknown, params?: unknown[]) =>
        client.query(text === marker ? 'CREATE TABLE half2 (id int); COMMIT;' : (text as string), params),
    } as unknown as pg.ClientBase;
    await expect(applyMigrations(leaky, [...files, sneaky('20990101000000_leak', marker)])).rejects.toMatchObject({
      code: 'transaction_control',
    });
    const after = await client.query('SELECT name FROM jesus_migrations ORDER BY name');
    expect(after.rows.map((r: { name: string }) => r.name)).toEqual(files.map((f) => f.name));
    await client.query('DROP TABLE IF EXISTS half2');
  });

  it('recusa abrir o banco se uma migração aplicada mudou', async () => {
    const files = await readMigrations(defaultMigrationsDir());
    const tampered = files.map((f, i) => (i === 0 ? { ...f, sql: `${f.sql}\n-- x`, checksum: migrationChecksum(`${f.sql}\n-- x`) } : f));
    await expect(applyMigrations(client, tampered)).rejects.toBeInstanceOf(MigrationError);
  });

  it('o banco só aceita uma credencial, com hashes bcrypt e contagem não negativa', async () => {
    const hash = await hashPassword('senha de teste comprida', { cost: 4 });
    const insert = (id: number, pw: string, rec: string, failed = 0) =>
      client.query(
        'INSERT INTO app_credentials (id, password_hash, recovery_hash, failed_attempts, password_changed_at) VALUES ($1, $2, $3, $4, now())',
        [id, pw, rec, failed],
      );
    await expect(insert(2, hash, hash)).rejects.toThrow(/app_credentials_single_row/);
    await expect(insert(1, 'senha em texto puro', hash)).rejects.toThrow(/app_credentials_password_is_bcrypt/);
    await expect(insert(1, hash, 'ABCDE-FGHJK')).rejects.toThrow(/app_credentials_recovery_is_bcrypt/);
    await expect(insert(1, hash, hash, -1)).rejects.toThrow(/failed_attempts_nonnegative/);
  });

  it('o papel do Cérebro e do Executor (jesus_app) não lê a credencial; jesus_config lê e grava, sem apagar', async () => {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE jesus_app');
      await expect(client.query('SELECT * FROM app_credentials')).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('ROLLBACK');
    }
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE jesus_config');
      await client.query('SELECT * FROM app_credentials');
      await expect(client.query('DELETE FROM app_credentials')).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('o repositório Prisma cria, conta erros de forma atômica e troca os hashes', async () => {
    const repo = createCredentialRepo(prisma);
    expect(await repo.load()).toBeNull();
    const hash = await hashPassword('senha de teste comprida', { cost: 4 });
    expect(await repo.create({ passwordHash: hash, recoveryHash: hash, at: 1_700_000_000_000 })).toBe('created');
    expect(await repo.create({ passwordHash: hash, recoveryHash: hash, at: 1_700_000_000_000 })).toBe('exists');

    const counts = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.recordFailure(1_700_000_000_000 + i)));
    expect([...counts].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await repo.load())?.failedAttempts).toBe(10);

    await repo.recordSuccess();
    expect(await repo.load()).toMatchObject({ failedAttempts: 0, lastFailedAt: null });

    // Relógio que voltou: a data do último erro vem para agora, só se estiver no futuro e houver erros.
    await repo.recordFailure(1_700_000_100_000);
    await repo.anchorFailureClock(1_700_000_200_000);
    expect(await repo.load()).toMatchObject({ failedAttempts: 1, lastFailedAt: 1_700_000_100_000 });
    await repo.anchorFailureClock(1_700_000_050_000);
    expect(await repo.load()).toMatchObject({ failedAttempts: 1, lastFailedAt: 1_700_000_050_000 });
    await repo.recordSuccess();
    await repo.anchorFailureClock(1_600_000_000_000);
    expect(await repo.load()).toMatchObject({ failedAttempts: 0, lastFailedAt: null });
    await client.query('UPDATE app_credentials SET failed_attempts = 7, last_failed_at = NULL');
    await repo.anchorFailureClock(1_700_000_300_000);
    expect(await repo.load()).toMatchObject({ failedAttempts: 7, lastFailedAt: 1_700_000_300_000 });
    await repo.recordSuccess();

    const other = await hashPassword('outra senha bem comprida', { cost: 4 });
    await repo.replaceSecrets({ passwordHash: other, at: 1_800_000_000_000 });
    expect(await repo.load()).toMatchObject({ passwordHash: other, recoveryHash: hash, passwordChangedAt: 1_800_000_000_000 });
  });

  it('o login completo guarda a contagem de erros entre aberturas do app', async () => {
    await client.query('DELETE FROM app_credentials');
    let now = 2_000_000_000_000;
    const ports = () => ({ repo: createCredentialRepo(prisma), clock: { now: () => now }, hasher: bcryptHasher(4) });

    const first = createAuthService(ports());
    const setup = await first.setup('girassol azul na janela');
    expect(setup.ok).toBe(true);
    for (let i = 0; i < 5; i++) await first.unlock('errada');

    // "Fecha e abre o app": um serviço novo lê a contagem do banco.
    const second = createAuthService(ports());
    expect(await second.unlock('girassol azul na janela')).toMatchObject({ ok: false, reason: 'throttled' });
    now += 30_000;
    expect(await second.unlock('girassol azul na janela')).toEqual({ ok: true });
    const { rows } = await client.query<{ password_hash: string }>('SELECT password_hash FROM app_credentials');
    expect(rows[0]?.password_hash).toMatch(/^\$2b\$04\$/);
  });
});
