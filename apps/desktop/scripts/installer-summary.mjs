// Escreve o SHA-256 dos instaladores no resumo do job do CI (etapa 5; decisão 0018), para o dono conferir o arquivo
// que baixar do artefato.
//   node scripts/installer-summary.mjs [pasta, padrão: release]
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'release'));
const installers = readdirSync(dir).filter((name) => name.endsWith('.exe'));
if (installers.length === 0) {
  console.error(`nenhum instalador .exe em ${dir}`);
  process.exit(1);
}
const lines = ['### Instalador do Jesus (Windows x64)', '', '| Arquivo | SHA-256 |', '|---|---|'];
for (const name of installers) {
  const hash = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');
  lines.push(`| ${name} | \`${hash}\` |`);
  console.log(`${name}  ${hash}`);
}
const summary = process.env['GITHUB_STEP_SUMMARY'];
if (summary !== undefined && summary !== '') appendFileSync(summary, `${lines.join('\n')}\n`);
