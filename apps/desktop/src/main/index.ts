import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
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
import { checkElevation, systemWhoamiPath } from './elevation';
import { APP_ID, APP_NAME, appPaths, TEST_APP_ID } from './paths';
import { ViolationBreaker } from './policy/breaker';
import { phase1PermissionPolicy } from './policy/permissions';
import { APP_DISABLED_FEATURES, HOST_RESOLVER_RULES, mergeFeatureList, unexpectedArguments, unexpectedEnvironment } from './policy/switches';
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
// Mais de 8 quadros de fora em 10 s: algo está muito errado (ou em laço), e o app fecha.
const frameBreaker = new ViolationBreaker({ limit: 8, windowMs: 10_000 });
// Só o build de teste guarda as violações (para os testes lerem); a produção só registra no log, cortado.
const violations: Violation[] = [];
const serverEvents: UiServerEvent[] = [];

/**
 * Volta a janela para o início. O `loadURL` rejeita quando outra navegação interrompe esta (por exemplo, a página de
 * 503 se recarregando sozinha): isso não é erro do app, só fica registrado.
 */
function goHome(win: BrowserWindow | null, reason: string): Promise<void> {
  if (win === null || win.isDestroyed()) return Promise.resolve();
  return win.loadURL(APP_HOME).catch((error: unknown) => {
    log(`início não carregou (${reason}): ${error instanceof Error ? error.message : String(error)}`);
  });
}

/**
 * Algo tentou sair do app. Navegação, janela nova e `webview` já foram barradas pela guarda; um quadro de fora que
 * chegou a carregar é tratado como invasão: a sessão cai e a janela volta para o início (bloqueada), sempre. O
 * disjuntor fecha o app se isso se repetir demais (laço de recargas).
 */
function onViolation(violation: Violation): void {
  if (TEST_BUILD) violations.push({ kind: violation.kind, url: violation.url.slice(0, 200) });
  log(`recusado (${violation.kind}): ${violation.url.slice(0, 200)}`);
  if (violation.kind !== 'frame-origin') return;
  jar?.clear();
  if (frameBreaker.record()) {
    log('quadros de fora demais em pouco tempo: o app vai fechar');
    dialog.showErrorBox(APP_NAME, 'O Jesus encontrou várias vezes conteúdo que não é dele e fechou por segurança.');
    app.exit(4);
    return;
  }
  void goHome(window, 'quadro de fora');
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
    const elevation = await checkElevation(systemWhoamiPath());
    if (TEST_BUILD) {
      // Só no build de teste (nunca publicado): os runners Windows do GitHub rodam como administrador, e os testes de
      // ponta a ponta precisam abrir o app. Ele registra o resultado (os testes conferem que a conferência rodou); a
      // regra fica no build de produção e nos testes de unidade.
      log(`elevação: ${elevation} (o build de produção só abre com "not-elevated")`);
    } else if (elevation !== 'not-elevated') {
      dialog.showErrorBox(
        APP_NAME,
        elevation === 'elevated'
          ? 'O Jesus não abre como administrador. Feche e abra de novo, sem "Executar como administrador".'
          : 'Não deu para conferir se o Jesus está rodando como administrador e, por segurança, ele não abre.',
      );
      app.exit(3);
      return;
    }
    app.setAppUserModelId(TEST_BUILD ? TEST_APP_ID : APP_ID);
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
      if (event.type === 'ready' && event.attempt > 1) void goHome(window, 'servidor da interface reiniciado');
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
    setTimeout(() => void goHome(window, 'página caiu'), 1_000);
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
  await goHome(win, 'abertura');
}

/**
 * Onde fica a pasta de dados: no Windows, `%LOCALAPPDATA%` (por máquina, como o Chromium; a `Roaming` iria para o
 * servidor num perfil móvel), com a pasta do usuário como reserva; no Linux (testes), `~/.config`.
 */
function dataRoot(): string {
  if (process.platform !== 'win32') return app.getPath('appData');
  const local = process.env['LOCALAPPDATA'];
  return local !== undefined && isAbsolute(local) ? local : join(app.getPath('home'), 'AppData', 'Local');
}

function start(): void {
  // O app de produção não aceita nenhum argumento nem variável ELECTRON_* (seção 3.13). Rodando pelo Electron de
  // desenvolvimento, o segundo argumento é o caminho do app.
  const argv = process.defaultApp === true ? [process.argv[0] ?? '', ...process.argv.slice(2)] : process.argv;
  const refusals: [string, string[]][] = [
    ['argumentos recusados', unexpectedArguments(argv, { testBuild: TEST_BUILD })],
    ['variáveis de ambiente recusadas', unexpectedEnvironment(process.env, { testBuild: TEST_BUILD })],
    // Sem sandbox por algo que escapou das duas listas: a produção nunca abre assim.
    ['chave recusada', !TEST_BUILD && app.commandLine.hasSwitch('no-sandbox') ? ['--no-sandbox'] : []],
  ];
  for (const [what, items] of refusals) {
    if (items.length === 0) continue;
    log(`${what}: ${items.join(' ').slice(0, 200)}`);
    app.exit(2);
    return;
  }

  const disabled = app.commandLine.getSwitchValue('disable-features').split(',');
  app.commandLine.appendSwitch('disable-features', mergeFeatureList(disabled, APP_DISABLED_FEATURES));
  app.commandLine.appendSwitch('host-resolver-rules', HOST_RESOLVER_RULES);

  app.setName(APP_NAME);
  const paths = appPaths({
    dataRoot: dataRoot(),
    bundleDir,
    testBuild: TEST_BUILD,
    e2eUserData: TEST_BUILD ? process.env['JESUS_E2E_USER_DATA'] : undefined,
  });
  // Antes da trava de instância única: a trava fica na pasta de dados.
  app.setPath('userData', paths.userData);
  // Como root (contêiner), o Chromium exige --no-sandbox, que só o build de teste aceita.
  if (!TEST_BUILD || !app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
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
