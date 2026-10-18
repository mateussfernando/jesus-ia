// Teste de adulteração do app.asar (Windows; decisão 0018).
//   node scripts/tamper-check.mjs <pasta win-unpacked do pacote de produção>
// Copia o pacote para uma pasta temporária e troca um byte dentro do dist/main.mjs no app.asar. Abre as duas cópias
// com um argumento que o app recusa: a intacta tem que sair com 2 (o código do app rodou e recusou); a adulterada
// não pode sair com 2, porque o Electron tem que barrar o asar antes de rodar qualquer código do app (integridade
// do asar embutida no executável). Se ela travar (por exemplo, num aviso de erro), o tempo esgota e ela é derrubada:
// também conta como barrada.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, openSync, readSync, rmSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import asar from '@electron/asar';

const source = process.argv[2];
if (source === undefined) {
  console.error('uso: node scripts/tamper-check.mjs <pasta win-unpacked>');
  process.exit(1);
}
const REFUSED_ARG = '--remote-debugging-port=9222';

function launch(dir) {
  const result = spawnSync(join(dir, 'Jesus.exe'), [REFUSED_ARG], { encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, signal: result.signal, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const workDir = mkdtempSync(join(tmpdir(), 'jesus-adulteracao-'));
const intact = join(workDir, 'intacto');
const tampered = join(workDir, 'adulterado');
try {
  cpSync(resolve(source), intact, { recursive: true });
  cpSync(resolve(source), tampered, { recursive: true });

  // Troca um byte do conteúdo do dist/main.mjs dentro do app.asar (não do cabeçalho).
  const archive = join(tampered, 'resources', 'app.asar');
  const { headerSize } = asar.getRawHeader(archive);
  const file = asar.statFile(archive, 'dist/main.mjs');
  const position = 8 + headerSize + Number(file.offset) + 16;
  const fd = openSync(archive, 'r+');
  const byte = Buffer.alloc(1);
  readSync(fd, byte, 0, 1, position);
  byte[0] = byte[0] ^ 0x20;
  writeSync(fd, byte, 0, 1, position);
  closeSync(fd);

  const control = launch(intact);
  const attack = launch(tampered);
  console.log(`intacto: saída ${String(control.status)}; adulterado: saída ${String(attack.status)} (${String(attack.signal)})`);
  const problems = [];
  if (control.status !== 2) problems.push(`a cópia intacta devia sair com 2 (argumento recusado) e saiu com ${String(control.status)}`);
  if (attack.status === 2 || attack.output.includes('argumentos recusados')) {
    problems.push('o app adulterado rodou o código do app (a integridade do asar não barrou)');
  }
  if (problems.length > 0) {
    console.error('Teste de adulteração falhou:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('Adulteração do app.asar barrada pelo Electron.');
  }
} finally {
  rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1_000 });
}
