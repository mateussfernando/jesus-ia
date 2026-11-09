// Roda a CLI do Next.js com a telemetria desligada (local primeiro, seção 1.5): o Next manda dados de uso
// para fora por padrão. Funciona igual no Windows e no Linux, sem depender da sintaxe do shell.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('next/package.json')), 'dist', 'bin', 'next');

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
process.exit(result.status ?? 1);
