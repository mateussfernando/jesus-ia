// Empacota em JavaScript o processo principal, o servidor da interface e o Cérebro, para o Electron rodar (decisões
// 0017 e 0023).
//   node scripts/build.mjs          → dist/       (produção)
//   node scripts/build.mjs --test   → dist-test/  (build de teste, com os ganchos dos testes de ponta a ponta)
// O build de teste é decidido aqui, na compilação (constante __JESUS_TEST_BUILD__), nunca em tempo de execução. No de
// produção, o código de teste é removido e a busca abaixo confere que nada sobrou.
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';
import { GATEWAY_MARKERS } from './gateway-markers.mjs';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const testBuild = process.argv.includes('--test');
const outDir = join(desktopDir, testBuild ? 'dist-test' : 'dist');

/** Textos que só existem no código de teste: se aparecerem no build de produção, o build falha. */
const TEST_ONLY_MARKERS = ['__jesusTest', 'JESUS_E2E_USER_DATA', 'JESUS_E2E_IDLE_MS'];

rmSync(outDir, { recursive: true, force: true });
await build({
  cwd: desktopDir,
  input: { main: 'src/main/index.ts', 'next-host': 'src/next-host/main.ts', brain: 'src/brain-host/main.ts' },
  platform: 'node',
  external: ['electron'],
  resolve: { alias: { '@ai-sdk/gateway': join(desktopDir, 'src', 'brain-host', 'gateway-stub.ts') } },
  transform: { define: { __JESUS_TEST_BUILD__: JSON.stringify(testBuild) } },
  output: {
    dir: outDir,
    format: 'esm',
    entryFileNames: '[name].mjs',
    chunkFileNames: 'chunks/[name]-[hash].mjs',
    // Só remove código morto (como os ramos de teste); o resto fica legível para revisão.
    minify: 'dce-only',
    sourcemap: false,
  },
});

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const leaks = [];
for (const file of filesUnder(outDir)) {
  const text = readFileSync(file, 'utf8');
  for (const marker of GATEWAY_MARKERS) if (text.includes(marker)) leaks.push(`${file}: ${marker} (AI Gateway)`);
  if (!testBuild) for (const marker of TEST_ONLY_MARKERS) if (text.includes(marker)) leaks.push(`${file}: ${marker} (código de teste)`);
}
if (leaks.length > 0) {
  console.error('O build tem o que não pode ter:');
  for (const leak of leaks) console.error(`  - ${leak}`);
  process.exit(1);
}
console.log(`Build ${testBuild ? 'de teste' : 'de produção'} em ${outDir}: ${filesUnder(outDir).length} arquivos.`);
