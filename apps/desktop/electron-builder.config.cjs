'use strict';
// Empacotamento do app de desktop (fase 1, etapa 4; decisão 0018). Usado por scripts/package.mjs, que gera antes o
// bundle certo (dist/ ou dist-test/) e confere o pacote depois (scripts/check-package.mjs).
//
// Build de produção: fusíveis travados (sem RunAsNode, sem NODE_OPTIONS, sem --inspect; integridade do asar e só
// carregar o app de dentro do asar). Build de teste (JESUS_TEST_BUILD=1 na hora de empacotar): o bundle dist-test e
// os fusíveis padrão, porque os testes de ponta a ponta precisam do inspetor do Node. O build de teste nunca é
// publicado: ele sai em release-test/ e só serve ao CI.
const checksums = require('electron/checksums.json');

const testBuild = process.env.JESUS_TEST_BUILD === '1';
const bundleDir = testBuild ? 'dist-test' : 'dist';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.jesus.desktop',
  productName: 'Jesus',
  executableName: 'Jesus',
  copyright: 'Uso pessoal',
  directories: { output: testBuild ? 'release-test' : 'release' },
  // O app leva só o bundle (o código do principal e do servidor da interface, com as dependências dentro) e a
  // interface montada pelo stage-ui.mjs. Nenhum node_modules do projeto entra: tudo o que roda está no bundle ou no
  // standalone do Next.
  files: [
    'package.json',
    `${bundleDir}/**/*`,
    'stage/ui/**/*',
    // O electron-builder ignora pastas node_modules por padrão; as do standalone do Next são parte da interface.
    'stage/ui/**/node_modules/**/*',
  ],
  extraMetadata: { main: `${bundleDir}/main.mjs` },
  asar: true,
  // Nada de compilar módulo nativo no empacotamento: o app não tem nenhum (o stage-ui.mjs recusa .node).
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  // O zip do Electron é conferido com o checksums.json do pacote electron (fixado pelo package-lock.json), e não com
  // um SHASUMS256.txt baixado do mesmo lugar que o zip.
  electronDownload: { checksums },
  electronLanguages: ['pt-BR', 'en-US'],
  electronFuses: testBuild
    ? null
    : {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
        loadBrowserProcessSpecificV8Snapshot: false,
        grantFileProtocolExtraPrivileges: false,
      },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // Sem assinatura de código (uso pessoal; docs/10-roadmap.md, seção 10.3): o SmartScreen avisa na primeira vez.
    signExecutable: false,
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    // Instalação por usuário, sem administrador e sem escolha (%LOCALAPPDATA%\Programs\Jesus).
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    packElevateHelper: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    // Desinstalar não apaga a pasta de dados (a senha local e, depois, o banco): isso é decisão do dono.
    deleteAppDataOnUninstall: false,
    differentialPackage: false,
    artifactName: 'Jesus-Setup-${version}.${ext}',
  },
  linux: { target: ['dir'] },
  publish: null,
};
