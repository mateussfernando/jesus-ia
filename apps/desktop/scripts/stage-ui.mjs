// Monta a pasta da interface que vai dentro do app (decisão 0017), a partir do build standalone do Next:
//   JESUS_DESKTOP_BUILD=1 npm run build -w @jesus/ui && npm run stage:ui -w @jesus/desktop
// Uso direto: node scripts/stage-ui.mjs [pasta do apps/ui] [destino]
//
// Copia o standalone, os estáticos (.next/static) e a pasta public, trocando cada link simbólico por uma cópia comum
// (o NSIS e o Windows sem modo de desenvolvedor não tratam links). Recusa (falha, sem pacote pela metade) arquivos de
// ambiente, credenciais, chaves, bancos, links para fora do build e módulos nativos; tira o sharp e o server.js.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyStagePath, isInsideRoot } from './stage-policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(process.argv[2] ?? join(here, '..', '..', 'ui'));
const dest = resolve(process.argv[3] ?? join(here, '..', 'stage', 'ui'));
const standalone = join(uiDir, '.next', 'standalone');

if (!existsSync(join(standalone, 'apps', 'ui', '.next', 'required-server-files.json'))) {
  console.error(`Falta o build standalone em ${standalone}. Rode: JESUS_DESKTOP_BUILD=1 npm run build -w @jesus/ui`);
  process.exit(1);
}

const refused = [];
let files = 0;
let bytes = 0;

/**
 * Copia `source` para `target`. `rel` é o caminho no destino (para as regras); `root` é a raiz real de onde os links
 * podem apontar.
 */
function copyEntry(source, target, rel, root) {
  const verdict = classifyStagePath(rel);
  if (verdict === 'drop') return;
  if (verdict === 'refuse') {
    refused.push(rel);
    return;
  }
  let real = source;
  const link = lstatSync(source);
  if (link.isSymbolicLink()) {
    real = realpathSync(source);
    if (!isInsideRoot(root, real, sep)) {
      refused.push(`${rel} (link para fora do build: ${real})`);
      return;
    }
  }
  const stat = statSync(real);
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(real)) copyEntry(join(real, name), join(target, name), join(rel, name), root);
    return;
  }
  if (!stat.isFile()) {
    refused.push(`${rel} (não é arquivo comum)`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(real, target);
  files += 1;
  bytes += stat.size;
}

rmSync(dest, { recursive: true, force: true });
const standaloneRoot = realpathSync(standalone);
for (const name of readdirSync(standaloneRoot)) {
  copyEntry(join(standaloneRoot, name), join(dest, name), name, standaloneRoot);
}
const staticDir = join(uiDir, '.next', 'static');
if (existsSync(staticDir)) {
  copyEntry(staticDir, join(dest, 'apps', 'ui', '.next', 'static'), join('apps', 'ui', '.next', 'static'), realpathSync(staticDir));
}
const publicDir = join(uiDir, 'public');
if (existsSync(publicDir)) {
  copyEntry(publicDir, join(dest, 'apps', 'ui', 'public'), join('apps', 'ui', 'public'), realpathSync(publicDir));
}

if (refused.length > 0) {
  rmSync(dest, { recursive: true, force: true });
  console.error('Montagem recusada. Estes arquivos não podem ir para o app:');
  for (const item of refused) console.error(`  - ${item}`);
  process.exit(1);
}
console.log(`Interface montada em ${relative(process.cwd(), dest) || dest}: ${String(files)} arquivos, ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
