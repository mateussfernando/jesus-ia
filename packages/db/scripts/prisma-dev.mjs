// Roda a CLI do Prisma na máquina de quem desenvolve (decisão 0014), com a telemetria desligada: sem
// CHECKPOINT_DISABLE, a CLI manda versão, sistema e hashes do projeto para checkpoint.prisma.io a cada comando.
// Repassa os argumentos (ex.: `node scripts/prisma-dev.mjs migrate dev --create-only`). Variável de ambiente no
// próprio script do npm (`VAR=1 prisma …`) não funciona no cmd do Windows; por isso este arquivo.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, '..');
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: packageDir,
  stdio: 'inherit',
  env: { ...process.env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
});
process.exit(result.status ?? 1);
