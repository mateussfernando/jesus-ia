// Aplica as migrações do Jesus no banco de `JESUS_DATABASE_URL` (o mesmo que o servidor da interface usa), com o
// migrador próprio do pacote (decisão 0014), sem a CLI do Prisma. Só para desenvolvimento e testes: no app
// instalado, quem migra é o processo principal do Electron. A URL vem do ambiente, nunca de arquivo do repositório.
import pg from 'pg';

if (!process.features.typescript) {
  console.error('Este script lê o migrador em TypeScript direto: use o Node 22.18 ou mais novo (ou o 24).');
  process.exit(1);
}

const url = process.env.JESUS_DATABASE_URL;
if (url === undefined || !/^postgres(ql)?:\/\//.test(url)) {
  console.error('Defina JESUS_DATABASE_URL com uma URL postgresql:// (veja scripts/cloud-test-db.sh na raiz).');
  process.exit(1);
}

const { applyMigrations, defaultMigrationsDir, readMigrations } = await import('../src/migrate.ts');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const applied = await applyMigrations(client, await readMigrations(defaultMigrationsDir()));
  console.log(applied.length === 0 ? 'Nenhuma migração pendente.' : `Aplicadas: ${applied.join(', ')}`);
} finally {
  await client.end();
}
