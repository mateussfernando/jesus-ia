import { mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModelCard, localDayKey } from '@jesus/models';
import { createLogger, formatTextLine, maskSecrets } from '@jesus/shared';
import { AuditWriter } from '@jesus/shared/audit';
import type { AuditEvent } from '@jesus/shared/audit';
import { app, dialog, Menu, MessageChannelMain, powerMonitor, safeStorage, session, utilityProcess } from 'electron';
import type { BrowserWindow, UtilityProcess } from 'electron';
import { handleAppRequest } from './app-protocol';
import { APP_PARTITION, lockDownDefaultSession, setupAppSession } from './app-session';
import { createAppWindow, guardWebContents } from './app-window';
import type { Violation } from './app-window';
import { fileAnchorStore, sealedAnchorStore } from './audit-anchor';
import { startBrainProcess } from './brain-process';
import { createChatRelay } from './chat-relay';
import { TEST_BUILD } from './build-flags';
import { buildChildEnv } from './child-env';
import type { HostLockReason } from '../bridge/protocol';
import { CookieJar } from './cookie-jar';
import { readApiKey } from './egress/api-key';
import { BRAIN_MODEL_KEY, PHASE1_TOOL_NAMES } from './egress/api-policy';
import { createEgress } from './egress/egress';
import { carriedSpendEvent, createSpendScan, DailySpend, DEFAULT_DAILY_LIMIT_PUSD } from './egress/spend';
import { ANTHROPIC_TARGET, createTransport, ignoredEgressEnvironment } from './egress/transport';
import { checkElevation, systemWhoamiPath } from './elevation';
import { LockSignals } from './lock-signals';
import { APP_ID, APP_NAME, appPaths, TEST_APP_ID } from './paths';
import { ViolationBreaker } from './policy/breaker';
import { phase1PermissionPolicy } from './policy/permissions';
import { APP_DISABLED_FEATURES, HOST_RESOLVER_RULES, mergeFeatureList, unexpectedArguments, unexpectedEnvironment } from './policy/switches';
import { APP_ORIGIN } from './policy/url';
import type { Supervisor, SupervisorEvent } from './supervisor';
import { createTestApi } from './test-api';
import { startUiServer, statusPage } from './ui-server';
import type { UiServerEvent } from './ui-server';
import { Vault } from './vault';
import { handleSpendRequest } from './spend-requests';
import { createVaultRequests } from './vault-requests';

/**
 * Processo principal do Jesus (fase 1, etapa 3; seção 3.12; decisões 0016, 0017 e 0023). Abre uma janela só, que
 * carrega `https://jesus.invalid/` numa sessão em memória; cada pedido dela vai ao servidor da interface
 * (utilityProcess `jesus-next`) pela ponte. Nenhuma porta é aberta. A única saída para a rede é a da API da Anthropic,
 * feita aqui, para o Cérebro (utilityProcess `jesus-brain`), com a chave do cofre.
 */

const APP_HOME = `${APP_ORIGIN}/`;
const bundleDir = dirname(fileURLToPath(import.meta.url));

/** Registro de texto do principal, com redação (segredos mascarados): vai para o stderr. */
const log = createLogger({ sink: (record) => process.stderr.write(`${formatTextLine(record, 'jesus')}\n`) });

/** Registro de auditoria (decisão 0022). Aberto depois da conferência de administrador: elevado, nada se grava. */
let audit: AuditWriter | null = null;

/** Na fase 1 (ainda sem ferramentas), uma falha do registro de auditoria não derruba o app: fica no log. */
function record(event: AuditEvent): void {
  audit?.append(event).catch((error: unknown) => log.error('registro.falhou', { error }));
}

let window: BrowserWindow | null = null;
let jar: CookieJar | null = null;
// Mais de 8 quadros de fora em 10 s: algo está muito errado (ou em laço), e o app fecha.
const frameBreaker = new ViolationBreaker({ limit: 8, windowMs: 10_000 });
// Só o build de teste guarda as violações (para os testes lerem); a produção só registra no log, cortado.
const violations: Violation[] = [];
const serverEvents: UiServerEvent[] = [];
const brainEvents: SupervisorEvent[] = [];

/**
 * Volta a janela para o início. O `loadURL` rejeita quando outra navegação interrompe esta (por exemplo, a página de
 * 503 se recarregando sozinha): isso não é erro do app, só fica registrado.
 */
function goHome(win: BrowserWindow | null, reason: string): Promise<void> {
  if (win === null || win.isDestroyed()) return Promise.resolve();
  return win.loadURL(APP_HOME).catch((error: unknown) => {
    log.warn('janela.inicio_nao_carregou', { motivo: reason, erro: error instanceof Error ? error.message : String(error) });
  });
}

/**
 * Algo tentou sair do app. Navegação, janela nova e `webview` já foram barradas pela guarda; um quadro de fora que
 * chegou a carregar é tratado como invasão: a sessão cai e a janela volta para o início (bloqueada), sempre. O
 * disjuntor fecha o app se isso se repetir demais (laço de recargas).
 */
function onViolation(violation: Violation): void {
  const url = violation.url.slice(0, 200);
  if (TEST_BUILD) violations.push({ kind: violation.kind, url });
  log.warn('janela.recusado', { tipo: violation.kind, url });
  record({ type: 'window.violation', kind: violation.kind, url });
  if (violation.kind !== 'frame-origin') return;
  jar?.clear();
  if (frameBreaker.record()) {
    log.error('janela.disjuntor', { motivo: 'quadros de fora demais em pouco tempo: o app vai fechar' });
    record({ type: 'window.breaker_tripped' });
    dialog.showErrorBox(APP_NAME, 'O Jesus encontrou várias vezes conteúdo que não é dele e fechou por segurança.');
    app.exit(4);
    return;
  }
  void goHome(window, 'quadro de fora');
}

/** Entrada de verdade na janela (do sistema, não de script da página) que conta como uso do Jesus (decisão 0019). */
const USER_INPUT: ReadonlySet<string> = new Set(['rawKeyDown', 'keyDown', 'char', 'mouseDown', 'mouseWheel', 'touchStart', 'gestureTap']);

/** De quanto em quanto tempo o principal pergunta ao sistema se a sessão está bloqueada (segunda barreira). */
const IDLE_STATE_EVERY_MS = 15_000;

/** Só no build de teste: tempo sem uso curto, para os testes de ponta a ponta não esperarem 15 min. */
function testIdleMs(): number | undefined {
  if (!TEST_BUILD) return undefined;
  const value = Number(process.env['JESUS_E2E_IDLE_MS']);
  return Number.isSafeInteger(value) && value >= 1_000 ? value : undefined;
}

/** Saída de um processo filho: vai para o stderr do principal, marcada, com segredos mascarados, cortada. */
function forwardOutput(child: UtilityProcess, label: string): void {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim() !== '') process.stderr.write(`[${label}] ${maskSecrets(line).text.slice(0, 2_000)}\n`);
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
      log.info('admin.elevacao', { elevacao: elevation, producao: 'só abre com "not-elevated"' });
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
  // Cofre (decisão 0020): a chave da API, cifrada pelo safeStorage (no Windows, DPAPI). Arquivo estragado vai para o
  // lado quando o dono guarda ou apaga a chave de novo.
  const vault = new Vault(join(paths.dataDir, 'vault.json'), safeStorage, {
    onReset: (quarantined) => {
      log.warn('cofre.recomecado', { separado: basename(quarantined) });
      record({ type: 'vault.reset', reason: 'corrupt', quarantined: basename(quarantined) });
    },
  });
  const vaultProblem = vault.problem();
  if (vaultProblem !== null) log.warn('cofre.indisponivel', { motivo: vaultProblem });
  // A âncora do registro fica num arquivo cifrado próprio (regravado a cada linha, longe do arquivo da chave); sem
  // cofre, num arquivo comum.
  const legacyAnchors = fileAnchorStore(join(paths.dataDir, 'audit-anchor.json'));
  const anchors =
    vaultProblem === null
      ? sealedAnchorStore({ path: join(paths.dataDir, 'audit-anchor.vault'), storage: safeStorage, previous: { vault, legacy: legacyAnchors } })
      : legacyAnchors;
  // O gasto do dia vem do registro (decisão 0023): reabrir o app não zera o teto.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const spendScan = createSpendScan(localDayKey(Date.now(), timeZone), timeZone);
  try {
    const opened = await AuditWriter.open({ path: join(paths.dataDir, 'audit.jsonl'), anchors, visit: (entry) => spendScan.add(entry) });
    audit = opened.writer;
    if (opened.verdict.status !== 'ok' || opened.verdict.tornTail || opened.anchorUnreadable) {
      log.warn('registro.conferencia', {
        status: opened.verdict.status,
        linhaIncompleta: opened.verdict.tornTail,
        ancoraIlegivel: opened.anchorUnreadable,
        separado: opened.quarantined,
      });
    }
    // O registro antigo foi para o lado: o novo começa com o gasto e o teto do dia que a conferência leu nele.
    if (opened.quarantined !== null) await opened.writer.append(carriedSpendEvent(spendScan.result()));
  } catch (error) {
    log.error('registro.nao_abriu', { error });
  }
  record({ type: 'app.opened', version: app.getVersion(), testBuild: TEST_BUILD });
  const ignoredEnv = ignoredEgressEnvironment(process.env);
  if (ignoredEnv.length > 0) log.info('saida.ambiente_ignorado', { variaveis: ignoredEnv.join(' ') });

  // Teto de gasto do dia (decisão 0023): o gasto e o teto vêm do registro (o último `spend.limit_set`, escolhido pelo
  // dono nas Configurações; sem nenhum, o padrão). Reabrir o app não zera nada.
  const card = getModelCard(BRAIN_MODEL_KEY);
  if (card === null) throw new Error('o modelo do Cérebro não está no catálogo');
  const scanned = spendScan.result();
  const spend = new DailySpend({ limitPUsd: scanned.limitPUsd ?? DEFAULT_DAILY_LIMIT_PUSD, timeZone, start: scanned });
  /** Grava no registro e espera: sem registro, nem gasto nem mudança do teto. */
  const appendAudit = (event: AuditEvent) =>
    audit === null ? Promise.reject(new Error('registro de auditoria indisponível')) : audit.append(event);

  const vaultRequests = createVaultRequests({ vault, record });
  // A conversa (decisão 0024) mora no Cérebro; o principal só repassa entre ele e o servidor da interface.
  let brainSupervisor: Supervisor | null = null;
  const chatRelay = createChatRelay({ postToBrain: (message) => brainSupervisor?.post(message) ?? false });

  const cookies = new CookieJar();
  jar = cookies;
  // Ambiente por lista (sem segredos); a configuração vai por mensagem (decisão 0017).
  const childEnv = buildChildEnv(process.env, { fixed: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' } });
  let currentChild: UtilityProcess | null = null;
  let lockSignals: LockSignals | null = null;
  const idleMs = testIdleMs();
  const uiServer = startUiServer({
    fork: () => {
      const child = utilityProcess.fork(paths.nextHostEntry, [], { serviceName: 'jesus-next', stdio: 'pipe', env: childEnv });
      forwardOutput(child, 'jesus-next');
      currentChild = child;
      return child;
    },
    createChannel: () => new MessageChannelMain(),
    config: { uiDir: paths.uiDir, dataDir: paths.dataDir, ...(idleMs === undefined ? {} : { idleMs }) },
    onLockAck: (seq) => lockSignals?.ack(seq),
    onVaultRequest: (request) => Promise.resolve(vaultRequests(request)),
    onSpendRequest: (request) => handleSpendRequest(request, spend, appendAudit),
    onChatRequest: (request, owner, reply) => chatRelay.fromUi(request, owner, reply),
    onServerGone: (owner) => chatRelay.uiGone(owner),
    onEvent: (event) => {
      serverEvents.push(event);
      log.info('servidor_interface', event);
      if (event.type === 'ready') record({ type: 'ui_server.ready', attempt: event.attempt, prepareMs: event.prepareMs });
      if (event.type === 'exited') record({ type: 'ui_server.exited', code: event.code, inflight: event.inflight });
      if (event.type === 'failed') record({ type: 'ui_server.failed', reason: event.reason, message: event.message.slice(0, 500) });
      if (event.type === 'gave-up') record({ type: 'ui_server.gave_up', failures: event.failures });
      if (event.type === 'invalid-response') record({ type: 'ui_server.invalid_response' });
      // O estado de acesso morreu com o processo: a sessão antiga não vale mais.
      if (event.type === 'exited') {
        cookies.clear();
        lockSignals?.reset();
      }
      // O servidor novo começa bloqueado: a janela volta para o início (que leva à tela de entrada).
      if (event.type === 'ready' && event.attempt > 1) void goHome(window, 'servidor da interface reiniciado');
    },
  });

  // Saída para a API da Anthropic e o Cérebro (decisão 0023). A chave sai do cofre só na hora de cada pedido; sem
  // registro de auditoria, nenhum pedido sai.
  const anthropic = createTransport(ANTHROPIC_TARGET);
  // Só no build de teste: os testes de ponta a ponta podem trocar o destino por um servidor local (some da produção).
  const testApi = TEST_BUILD ? createTestApi(anthropic, () => readApiKey(vault)) : null;
  const transport = testApi?.transport ?? anthropic;
  const egress = createEgress({
    transport,
    readKey: testApi?.readKey ?? (() => readApiKey(vault)),
    spend,
    card,
    audit: appendAudit,
    toolNames: PHASE1_TOOL_NAMES,
    userAgent: `Jesus/${app.getVersion()}`,
  });
  const brainEnv = buildChildEnv(process.env, { fixed: { NODE_ENV: 'production' } });
  let brainChild: UtilityProcess | null = null;
  const brain = startBrainProcess({
    fork: () => {
      const child = utilityProcess.fork(paths.brainEntry, [], { serviceName: 'jesus-brain', stdio: 'pipe', env: brainEnv });
      forwardOutput(child, 'jesus-brain');
      brainChild = child;
      return child;
    },
    egress,
    onChat: (message, violation) => chatRelay.fromBrain(message, violation),
    onGone: () => chatRelay.brainGone(),
    onEvent: (event) => {
      if (TEST_BUILD) brainEvents.push(event);
      log.info('cerebro', event);
      if (event.type === 'ready') record({ type: 'brain.ready', attempt: event.attempt, prepareMs: event.prepareMs });
      if (event.type === 'exited') record({ type: 'brain.exited', code: event.code });
      if (event.type === 'failed') record({ type: 'brain.failed', reason: event.reason, message: event.message.slice(0, 500) });
      if (event.type === 'gave-up') record({ type: 'brain.gave_up', failures: event.failures });
    },
  });

  brainSupervisor = brain;

  const signals = new LockSignals({
    notify: (message) => uiServer.notify(message),
    // Com o tempo sem uso curto do build de teste, o aviso de uso precisa ser mais frequente que o prazo.
    ...(idleMs === undefined ? {} : { activityEveryMs: Math.min(5_000, Math.floor(idleMs / 4)) }),
    unconfirmed: (seq) => {
      log.error('bloqueio.sem_confirmacao', { seq });
      record({ type: 'lock.unconfirmed', seq });
      uiServer.restartUnconfirmed();
    },
  });
  lockSignals = signals;

  /**
   * Bloqueio que vem do Windows (decisão 0019). Três camadas: o principal apaga o pote de cookies (a página perde a
   * sessão na hora), avisa o servidor da interface (que confirma em 2 s ou é reiniciado, já bloqueado) e volta a janela
   * para o início, que leva à tela de entrada.
   */
  let osLocked = false;
  const lockFromHost = (reason: HostLockReason, source: string) => {
    log.info('bloqueio.do_sistema', { motivo: reason, origem: source });
    record({ type: 'app.locked', reason, source });
    cookies.clear();
    // O que estava saindo para a API para aqui: o Cérebro recebe `locked`.
    egress.cancelAll('locked');
    signals.lock(reason);
    void goHome(window, 'bloqueio do sistema');
  };
  const powerHandlers: Readonly<Record<string, () => void>> = {
    'lock-screen': () => {
      osLocked = true;
      lockFromHost('os_locked', 'lock-screen');
    },
    'unlock-screen': () => {
      osLocked = false;
    },
    suspend: () => lockFromHost('suspend', 'suspend'),
    // A volta da suspensão bloqueia de novo: o aviso de suspensão pode não ter chegado a tempo.
    resume: () => lockFromHost('suspend', 'resume'),
  };
  for (const [name, handler] of Object.entries(powerHandlers)) powerMonitor.on(name as 'lock-screen', handler);
  // Segunda barreira: se o aviso de sessão bloqueada se perdeu, o estado do sistema ainda mostra.
  setInterval(() => {
    const state = powerMonitor.getSystemIdleState(60);
    if (state === 'locked' && !osLocked) {
      osLocked = true;
      lockFromHost('os_locked', 'idle-state');
    } else if (state !== 'locked') {
      osLocked = false;
    }
  }, IDLE_STATE_EVERY_MS).unref();

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
  // Uso de verdade: só a entrada que o sistema entrega à janela (um script da página não gera estes eventos).
  win.webContents.on('input-event', (_event, input) => {
    if (USER_INPUT.has(input.type)) signals.activity();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    log.warn('janela.pagina_caiu', { motivo: details.reason });
    record({ type: 'window.renderer_gone', reason: details.reason });
    setTimeout(() => void goHome(window, 'página caiu'), 1_000);
  });
  app.on('second-instance', () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('before-quit', () => {
    uiServer.stop();
    brain.stop();
    transport.close();
  });

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
        emitPower: (name: string) => powerHandlers[name]?.(),
        auditAnchor: () => anchors.read(),
        vaultProblem: () => vault.problem(),
        brainEvents,
        brainPid: () => brainChild?.pid,
        restartBrain: () => brain.restart(),
        spend: () => spend.snapshot(),
        useTestApi: (port: number, ca: string, key: string) => testApi?.useTestApi(port, ca, key),
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
    log.warn('inicio.recusado', { motivo: what, itens: items.join(' ').slice(0, 200) });
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
    log.error('inicio.falhou', { error });
    app.exit(1);
  });
}

start();
