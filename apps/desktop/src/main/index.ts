import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog, Menu, MessageChannelMain, session, utilityProcess } from 'electron';
import type { BrowserWindow, UtilityProcess } from 'electron';
import { handleAppRequest } from './app-protocol';
import { APP_PARTITION, lockDownDefaultSession, setupAppSession } from './app-session';
import { createAppWindow, guardWebContents } from './app-window';
import type { Violation } from './app-window';
import { TEST_BUILD } from './build-flags';
import { buildChildEnv } from './child-env';
import { CookieJar } from './cookie-jar';
import { checkElevation } from './elevation';
import { APP_NAME, appPaths } from './paths';
import { phase1PermissionPolicy } from './policy/permissions';
import { APP_DISABLED_FEATURES, mergeFeatureList, unexpectedArguments } from './policy/switches';
import { APP_ORIGIN } from './policy/url';
import { startUiServer, statusPage } from './ui-server';
import type { UiServerEvent } from './ui-server';

/**
 * Processo principal do Jesus (fase 1, etapa 3; seção 3.12; decisões 0016 e 0017). Abre uma janela só, que carrega
 * `https://jesus.invalid/` numa sessão em memória; cada pedido dela vai ao servidor da interface (utilityProcess
 * `jesus-next`) pela ponte. Nenhuma porta é aberta e nada sai para a rede.
 */

const APP_HOME = `${APP_ORIGIN}/`;
const bundleDir = dirname(fileURLToPath(import.meta.url));

function log(message: string): void {
  process.stderr.write(`[jesus] ${message}\n`);
}

let window: BrowserWindow | null = null;
let jar: CookieJar | null = null;
let lastReset = 0;
const violations: Violation[] = [];
const serverEvents: UiServerEvent[] = [];

/**
 * Algo tentou sair do app. Navegação, janela nova e `webview` já foram barradas pela guarda; um quadro com outra
 * origem que chegou a carregar é tratado como invasão: a sessão cai e a janela volta para o início (bloqueada).
 */
function onViolation(violation: Violation): void {
  violations.push(violation);
  log(`recusado (${violation.kind}): ${violation.url.slice(0, 200)}`);
  if (violation.kind !== 'frame-origin') return;
  const now = Date.now();
  if (now - lastReset < 2_000) return;
  lastReset = now;
  jar?.clear();
  void window?.loadURL(APP_HOME);
}

/** Saída do servidor da interface: vai para o stderr do principal, marcada, cortada em linhas razoáveis. */
function forwardOutput(child: UtilityProcess): void {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim() !== '') process.stderr.write(`[jesus-next] ${line.slice(0, 2_000)}\n`);
      }
    });
  }
}

async function main(paths: ReturnType<typeof appPaths>): Promise<void> {
  await app.whenReady();
  if (process.platform === 'win32') {
    const elevation = await checkElevation(process.env['SystemRoot'] ?? process.env['SYSTEMROOT']);
    if (elevation !== 'not-elevated') {
      dialog.showErrorBox(
        APP_NAME,
        elevation === 'elevated'
          ? 'O Jesus não abre como administrador. Feche e abra de novo, sem "Executar como administrador".'
          : 'Não deu para conferir se o Jesus está rodando como administrador e, por segurança, ele não abre.',
      );
      app.exit(3);
      return;
    }
    app.setAppUserModelId('dev.jesus.desktop');
  }

  Menu.setApplicationMenu(null);
  app.on('web-contents-created', (_event, contents) => guardWebContents(contents, onViolation));
  await lockDownDefaultSession(session.defaultSession);
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });

  const cookies = new CookieJar();
  jar = cookies;
  // Ambiente por lista (sem segredos); a configuração vai por mensagem (decisão 0017).
  const childEnv = buildChildEnv(process.env, { fixed: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' } });
  let currentChild: UtilityProcess | null = null;
  const uiServer = startUiServer({
    fork: () => {
      const child = utilityProcess.fork(paths.nextHostEntry, [], { serviceName: 'jesus-next', stdio: 'pipe', env: childEnv });
      forwardOutput(child);
      currentChild = child;
      return child;
    },
    createChannel: () => new MessageChannelMain(),
    config: { uiDir: paths.uiDir, dataDir: paths.dataDir },
    onEvent: (event) => {
      serverEvents.push(event);
      log(`servidor da interface: ${JSON.stringify(event).slice(0, 500)}`);
      // O estado de acesso morreu com o processo: a sessão antiga não vale mais.
      if (event.type === 'exited') cookies.clear();
      // O servidor novo começa bloqueado: a janela volta para o início (que leva à tela de entrada).
      if (event.type === 'ready' && event.attempt > 1) void window?.loadURL(APP_HOME);
    },
  });

  const appSession = session.fromPartition(APP_PARTITION);
  await setupAppSession(
    appSession,
    async (request) => {
      try {
        return await handleAppRequest(request, uiServer.serve, cookies);
      } catch {
        return statusPage(500);
      }
    },
    phase1PermissionPolicy,
  );

  const win = createAppWindow({ session: appSession, title: APP_NAME });
  window = win;
  win.on('closed', () => {
    window = null;
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    log(`a página caiu (${details.reason}); recarregando o início`);
    setTimeout(() => void window?.loadURL(APP_HOME), 1_000);
  });
  app.on('second-instance', () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('before-quit', () => uiServer.stop());

  if (TEST_BUILD) {
    // Ganchos só do build de teste (somem do bundle de produção): os testes de ponta a ponta leem daqui.
    const consoleMessages: string[] = [];
    win.webContents.on('console-message', (event) => consoleMessages.push(`${event.level}: ${event.message}`));
    Object.assign(globalThis, {
      __jesusTest: {
        paths,
        violations,
        serverEvents,
        consoleMessages,
        cookieCount: () => cookies.size,
        uiServerPid: () => currentChild?.pid,
        killUiServer: () => currentChild?.kill(),
      },
    });
  }

  await uiServer.whenReady().catch(() => undefined);
  await win.loadURL(APP_HOME);
}

function start(): void {
  // O app de produção não aceita nenhum argumento (seção 3.13). Rodando pelo Electron de desenvolvimento, o segundo
  // argumento é o caminho do app.
  const argv = process.defaultApp === true ? [process.argv[0] ?? '', ...process.argv.slice(2)] : process.argv;
  const unexpected = unexpectedArguments(argv, { testBuild: TEST_BUILD });
  if (unexpected.length > 0) {
    log(`argumentos recusados: ${unexpected.join(' ').slice(0, 200)}`);
    app.exit(2);
    return;
  }

  const disabled = app.commandLine.getSwitchValue('disable-features').split(',');
  app.commandLine.appendSwitch('disable-features', mergeFeatureList(disabled, APP_DISABLED_FEATURES));

  app.setName(APP_NAME);
  const paths = appPaths({
    appData: app.getPath('appData'),
    bundleDir,
    testBuild: TEST_BUILD,
    e2eUserData: TEST_BUILD ? process.env['JESUS_E2E_USER_DATA'] : undefined,
  });
  // Antes da trava de instância única: a trava fica na pasta de dados.
  app.setPath('userData', paths.userData);
  if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('window-all-closed', () => app.quit());
  main(paths).catch((error: unknown) => {
    log(`falha ao abrir: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    app.exit(1);
  });
}

start();
