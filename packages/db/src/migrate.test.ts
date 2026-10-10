import { describe, expect, it } from 'vitest';
import { defaultMigrationsDir, migrationChecksum, planMigrations, readMigrations } from './migrate';
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
