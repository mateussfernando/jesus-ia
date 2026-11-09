// Gera o cliente do Prisma sem baixar nada (decisão 0014).
//
// A CLI do Prisma baixa um binário nativo (o "schema engine") de binaries.prisma.sh na primeira vez que roda,
// por fora do package-lock.json. O `prisma generate` não usa esse binário: apontar a variável para um
// executável que já existe (o próprio Node) evita o download. Só o `prisma migrate dev`, na máquina de quem
// desenvolve, precisa do binário de verdade.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, '..');
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');

const result = spawnSync(process.execPath, [cli, 'generate'], {
  cwd: packageDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PRISMA_SCHEMA_ENGINE_BINARY: process.env.PRISMA_SCHEMA_ENGINE_BINARY ?? process.execPath,
    CHECKPOINT_DISABLE: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
  },
});
process.exit(result.status ?? 1);
