// Empacota o app de desktop (fase 1, etapa 4; decisão 0018).
//   node scripts/package.mjs [--test] [--win | --linux] [--dir]
// Gera o bundle (dist/ ou dist-test/), confere que a interface montada existe (npm run stage:ui), chama o
// electron-builder e confere o pacote (check-package.mjs). Sem --win/--linux, empacota para o sistema atual: o
// instalador NSIS (.exe) só sai no Windows (no Linux o electron-builder precisaria do wine). Com --dir, só a pasta
// *-unpacked, sem instalador (o pacote de teste do CI).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const testBuild = args.includes('--test');
const platform = args.includes('--win') ? 'win' : args.includes('--linux') ? 'linux' : process.platform === 'win32' ? 'win' : 'linux';
const dirOnly = args.includes('--dir');

function run(script, scriptArgs) {
  const result = spawnSync(process.execPath, [join(desktopDir, 'scripts', script), ...scriptArgs], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(join(desktopDir, 'stage', 'ui', 'apps', 'ui', '.next', 'required-server-files.json'))) {
  console.error('Falta a interface montada. Rode: JESUS_DESKTOP_BUILD=1 npm run build -w @jesus/ui && npm run stage:ui -w @jesus/desktop');
  process.exit(1);
}
run('build.mjs', testBuild ? ['--test'] : []);

// A configuração lê JESUS_TEST_BUILD quando é carregada.
process.env['JESUS_TEST_BUILD'] = testBuild ? '1' : '0';
const require = createRequire(import.meta.url);
const config = require('../electron-builder.config.cjs');
const { Arch, Platform, build } = require('electron-builder');
const targets =
  platform === 'win'
    ? Platform.WINDOWS.createTarget([dirOnly ? 'dir' : 'nsis'], Arch.x64)
    : Platform.LINUX.createTarget(['dir'], Arch.x64);
await build({ projectDir: desktopDir, config, targets, publish: 'never' });

const outDir = join(desktopDir, testBuild ? 'release-test' : 'release');
const unpacked = readdirSync(outDir).find((name) => name.endsWith('-unpacked'));
if (unpacked === undefined) {
  console.error(`o electron-builder não gerou a pasta *-unpacked em ${outDir}`);
  process.exit(1);
}
run('check-package.mjs', [join(outDir, unpacked), ...(testBuild ? ['--test'] : [])]);
