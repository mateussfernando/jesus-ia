// Confere um pacote gerado pelo electron-builder (fase 1, etapa 4; decisão 0018).
//   node scripts/check-package.mjs <pasta *-unpacked> [--test]
// - fusíveis: travados no build de produção; padrão no de teste;
// - app.asar: tem o bundle certo e a interface montada; nada de dist-test na produção, nenhum arquivo que o
//   stage-ui.mjs recusaria ou deixaria de fora, nenhum binário (.node, .dll, .exe, .so, .dylib), nenhum código de teste
//   no bundle de produção;
// - build de teste: nome próprio e nenhum instalador ao lado (ele nunca pode ocupar a instalação de verdade);
// - só na produção, quando dá para abrir o app aqui (mesmo sistema, sem ser root no Linux): ele recusa qualquer
//   argumento e as variáveis ELECTRON_* que mudam o executável (sai com 2) e ignora ELECTRON_RUN_AS_NODE.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import asar from '@electron/asar';
import fuses from '@electron/fuses';
import { classifyStagePath } from './stage-policy.mjs';

const { FuseV1Options, getCurrentFuseWire } = fuses;
// O @electron/fuses 1.8 não exporta os estados: no binário, cada fusível é o byte "0" (48) ou "1" (49).
const FuseState = { DISABLE: 48, ENABLE: 49 };
const [target, ...flags] = process.argv.slice(2);
if (target === undefined) {
  console.error('uso: node scripts/check-package.mjs <pasta *-unpacked> [--test]');
  process.exit(1);
}
const testBuild = flags.includes('--test');
const dir = resolve(target);
const problems = [];
/** Caminho de dentro do asar ("/dist/main.mjs") no formato que o @electron/asar espera (no Windows, com "\\"). */
const archivePath = (path) => path.slice(1).split('/').join(sep);

const executable = ['Jesus.exe', 'Jesus', 'jesus'].map((name) => join(dir, name)).find((path) => existsSync(path));
if (executable === undefined) {
  console.error(`executável não encontrado em ${dir}`);
  process.exit(1);
}

// Fusíveis.
const EXPECTED = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
};
const wire = await getCurrentFuseWire(executable);
for (const [name, enabled] of Object.entries(EXPECTED)) {
  const state = wire[FuseV1Options[name]];
  if (testBuild) continue;
  const want = enabled ? FuseState.ENABLE : FuseState.DISABLE;
  if (state !== want) problems.push(`fusível ${name}: esperado ${enabled ? 'ligado' : 'desligado'}, está ${String(state)}`);
}
if (testBuild && wire[FuseV1Options.EnableNodeCliInspectArguments] === FuseState.DISABLE) {
  problems.push('o build de teste precisa do --inspect (os testes de ponta a ponta usam o inspetor)');
}

// Variáveis ELECTRON_* que o app de produção aceita por serem só das ferramentas de build: o executável não pode
// lê-las (os nomes que ele lê aparecem no binário, em ASCII ou UTF-16).
const electronEnvironment = JSON.parse(readFileSync(new URL('../src/main/policy/electron-environment.json', import.meta.url), 'utf8'));
const binary = readFileSync(executable);
const readByExecutable = new Set(
  [binary.toString('latin1'), binary.toString('utf16le')].flatMap((text) => text.match(/ELECTRON_[A-Z0-9_]{3,}/g) ?? []),
);
for (const name of readByExecutable) {
  if (electronEnvironment.toolNames.includes(name) || electronEnvironment.toolPrefixes.some((prefix) => name.startsWith(prefix))) {
    problems.push(`o executável lê ${name}, que o app aceita como variável só de build (src/main/policy/electron-environment.json)`);
  }
}

// Conteúdo do app.asar.
const asarPath = join(dir, 'resources', 'app.asar');
if (!existsSync(asarPath)) problems.push(`falta ${asarPath}`);
else {
  const files = asar.listPackage(asarPath, { isPack: false }).map((path) => path.replaceAll('\\', '/'));
  const bundle = testBuild ? 'dist-test' : 'dist';
  for (const required of [`/${bundle}/main.mjs`, `/${bundle}/next-host.mjs`, '/package.json', '/stage/ui/apps/ui/.next/required-server-files.json']) {
    if (!files.includes(required)) problems.push(`falta no app.asar: ${required}`);
  }
  if (!testBuild && files.some((path) => path.startsWith('/dist-test/'))) problems.push('o build de teste foi parar no pacote de produção');
  if (files.some((path) => path.startsWith('/node_modules/'))) problems.push('node_modules do projeto no app.asar');
  // No pacote final, o que a montagem deixaria de fora (sharp, server.js) também é proibido: sinal de que ela foi pulada.
  for (const path of files.filter((file) => file.startsWith('/stage/ui/'))) {
    if (classifyStagePath(path.slice('/stage/ui/'.length)) !== 'keep') problems.push(`arquivo proibido no app.asar: ${path}`);
  }
  for (const path of files.filter((file) => /\.(node|dll|exe|so|dylib)$|\.so\.\d/i.test(file))) problems.push(`binário no app.asar: ${path}`);
  const manifest = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  if (manifest.main !== `${bundle}/main.mjs`) problems.push(`package.json do app aponta para ${String(manifest.main)}`);
  const productName = testBuild ? 'Jesus (teste)' : 'Jesus';
  if (manifest.productName !== productName) problems.push(`nome do app: esperado "${productName}", está "${String(manifest.productName)}"`);
  if (!testBuild) {
    for (const path of files.filter((file) => file.startsWith('/dist/') && file.endsWith('.mjs'))) {
      const text = asar.extractFile(asarPath, archivePath(path)).toString('utf8');
      for (const marker of ['__jesusTest', 'JESUS_E2E_USER_DATA']) if (text.includes(marker)) problems.push(`código de teste em ${path}: ${marker}`);
    }
  }
}

// O build de teste nunca vira instalador nem pacote (a configuração já recusa; aqui é a segunda barreira).
if (testBuild) {
  const installers = readdirSync(dirname(dir)).filter((name) => /\.(exe|msi|appx|msix|zip|7z|AppImage|deb|rpm|snap|dmg|pkg)$|\.tar\.\w+$/i.test(name));
  for (const name of installers) problems.push(`instalador ou pacote do build de teste: ${join(dirname(dir), name)}`);
}

// O app de produção recusa argumentos e ignora ELECTRON_RUN_AS_NODE.
const samePlatform = executable.endsWith('.exe') === (process.platform === 'win32');
const asRoot = process.getuid?.() === 0;
if (!testBuild && samePlatform && !asRoot) {
  // Sem as ELECTRON_* de quem roda a conferência, para cada recusa vir só do que está sendo testado.
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('ELECTRON_')));
  const run = (args, env) => {
    const result = spawnSync(executable, args, { env: { ...cleanEnv, ...env }, encoding: 'utf8', timeout: 60_000 });
    return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  };
  const debugging = run(['--remote-debugging-port=9222'], {});
  if (debugging.status !== 2 || !debugging.output.includes('argumentos recusados')) {
    problems.push(`com --remote-debugging-port o app devia sair com 2 e saiu com ${String(debugging.status)} (${String(debugging.signal)})`);
  }
  // A marca só aparece se o código rodar (o app registra os argumentos recusados, e lá ela vem partida).
  const asNode = run(['-e', "console.log('rodou' + '-como-node')"], { ELECTRON_RUN_AS_NODE: '1' });
  if (asNode.output.includes('rodou-como-node')) problems.push('ELECTRON_RUN_AS_NODE fez o app rodar como Node');
  if (asNode.status !== 2) problems.push(`com ELECTRON_RUN_AS_NODE o app devia sair com 2 e saiu com ${String(asNode.status)}`);
  // Variáveis que o executável lê sozinho (ELECTRON_DISABLE_SANDBOX desliga a sandbox de todas as páginas). No
  // Windows, o nome não diferencia maiúsculas.
  for (const name of ['ELECTRON_DISABLE_SANDBOX', 'electron_disable_sandbox', 'ELECTRON_ENABLE_LOGGING']) {
    const result = run([], { [name]: '1' });
    if (result.status !== 2 || !result.output.includes('variáveis de ambiente recusadas')) {
      problems.push(`com ${name} o app devia sair com 2 e saiu com ${String(result.status)} (${String(result.signal)})`);
    }
  }
} else if (!testBuild) {
  console.log('(abertura do app não conferida aqui: outro sistema ou root no Linux; o CI confere)');
}

if (problems.length > 0) {
  console.error(`Pacote recusado (${dir}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Pacote ${testBuild ? 'de teste' : 'de produção'} conferido: ${executable}`);
