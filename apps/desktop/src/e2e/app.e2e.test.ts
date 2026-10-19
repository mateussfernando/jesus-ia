import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChain } from '@jesus/shared/audit';
import type { AuditAnchor } from '@jesus/shared/audit';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP, launchApp } from './harness';
import type { RunningApp } from './harness';

/**
 * O app de verdade (build de teste do processo principal + servidor do Next montado), aberto pelo Electron (seção
 * 3.12). Roda com `npm run test:e2e -w @jesus/desktop` sob um X (no Linux, `xvfb-run -a`). No CI a sandbox do Chromium
 * fica ligada; como root (contêiner da nuvem), o Chromium exige `--no-sandbox`. Com `JESUS_E2E_EXECUTABLE` apontando
 * para o executável do build de teste empacotado (`npm run package:test -w @jesus/desktop`), os mesmos testes rodam no
 * pacote de verdade, com a interface de dentro do `app.asar`.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainEntry = join(desktopDir, 'dist-test', 'main.mjs');
const executable = process.env['JESUS_E2E_EXECUTABLE'];
const packaged = executable !== undefined && executable !== '';
const uiDir = join(desktopDir, 'stage', 'ui', 'apps', 'ui');
const PASSWORD = 'cavalo bateria grampo correto 42';
// Chaves falsas, montadas por partes (nenhum padrão de token inteiro no código-fonte).
const FAKE_KEY = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu', 'e2eChaveFalsa'].join('');
const FAKE_ADMIN = ['sk-', 'ant-', 'admin01-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');
/**
 * No pacote, um módulo deixado em `resources/node_modules` (fora do `app.asar`) no caminho de um `require` opcional do
 * Next não pode rodar no servidor da interface. Se rodasse, ele deixaria esta marca na pasta de dados.
 */
const plantedModules = packaged ? join(dirname(executable ?? ''), 'resources', 'node_modules') : undefined;
const PLANTED_MARK = 'modulo-plantado-rodou';

let app: RunningApp;
let page: Page;
let userData: string;

/** Lê os ganchos do build de teste no processo principal. */
function hooks<T>(expression: string): Promise<T> {
  return app.mainEval<T>(`(() => { const h = globalThis.__jesusTest; return ${expression}; })()`);
}

async function unlock(): Promise<void> {
  await page.waitForURL(`${APP}/entrar/`);
  await page.getByRole('heading', { name: 'Desbloquear o Jesus' }).waitFor();
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await page.waitForURL(`${APP}/`);
}

beforeAll(async () => {
  const needed: (readonly [string, string])[] = packaged
    ? [[executable ?? '', 'npm run package:test -w @jesus/desktop']]
    : [
        [mainEntry, 'npm run build:test -w @jesus/desktop'],
        [join(uiDir, '.next', 'required-server-files.json'), 'JESUS_DESKTOP_BUILD=1 npm run build -w @jesus/ui && npm run stage:ui -w @jesus/desktop'],
      ];
  for (const [path, how] of needed) {
    if (!existsSync(path)) throw new Error(`Falta ${path}. Rode: ${how}`);
  }
  if (plantedModules !== undefined) {
    if (existsSync(plantedModules)) throw new Error(`${plantedModules} já existe no pacote de teste`);
    const moduleDir = join(plantedModules, '@opentelemetry', 'api');
    await mkdir(moduleDir, { recursive: true });
    await writeFile(join(moduleDir, 'package.json'), JSON.stringify({ name: '@opentelemetry/api', main: 'index.js' }));
    await writeFile(
      join(moduleDir, 'index.js'),
      `require('node:fs').writeFileSync(require('node:path').join(process.env.JESUS_DATA_DIR, '${PLANTED_MARK}'), 'rodou');\n` +
        // Se rodar, pelo menos o Next segue com a cópia embutida e o resto dos testes continua.
        "throw new Error('módulo plantado');\n",
    );
  }
  userData = await mkdtemp(join(tmpdir(), 'jesus-e2e-'));
  app = await launchApp({ mainEntry, userData, executable });
  page = app.page;
});

afterAll(async () => {
  await app?.close();
  // No Windows, arquivos recém-soltos ainda podem estar presos por um instante.
  await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  if (plantedModules !== undefined) await rm(plantedModules, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

describe('app de desktop: janela sem porta', () => {
  it('abre na tela de entrada, servida pelo servidor da interface no utilityProcess', async () => {
    await page.waitForURL(`${APP}/entrar/`);
    await page.getByRole('heading', { name: 'Crie a senha do Jesus' }).waitFor();
    expect(await hooks<number>('h.uiServerPid()')).toBeGreaterThan(0);
    expect(await hooks<boolean>("h.serverEvents.some((e) => e.type === 'ready')")).toBe(true);
    // O servidor já subiu (e o Next já tentou o módulo opcional): o plantado não rodou.
    if (plantedModules !== undefined) expect(existsSync(join(userData, 'data', PLANTED_MARK))).toBe(false);
    // No Windows, a conferência de administrador rodou de verdade (o build de teste só registra o resultado).
    if (process.platform === 'win32') expect(app.output.join('')).toMatch(/admin\.elevacao \{"elevacao":"(elevated|not-elevated)"/);
  });

  it('a página não tem Node; sandbox e isolamento ligados', async () => {
    expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    // Interno do Electron (sem tipo público): as preferências com que a página foi criada.
    const prefs = await app.mainEval<Record<string, unknown>>(`(() => {
      const { BrowserWindow } = require('electron');
      const web = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: web.sandbox, contextIsolation: web.contextIsolation, nodeIntegration: web.nodeIntegration };
    })()`);
    expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    // Sandbox do sistema (Linux): o processo da página roda com filtro seccomp. Como root, o Chromium não a liga.
    if (process.platform === 'linux' && process.getuid?.() !== 0) {
      const pid = await app.mainEval<number>(`require('electron').BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()`);
      expect(await readFile(`/proc/${String(pid)}/status`, 'utf8')).toMatch(/^Seccomp:\s+2$/m);
    }
  });

  it('cria a senha, mostra o código e entra; a sessão fica no principal, longe da página', async () => {
    const fields = page.locator('input[autocomplete="new-password"]');
    await fields.nth(0).fill(PASSWORD);
    await fields.nth(1).fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.getByRole('heading', { name: 'Anote o código de recuperação' }).waitFor({ timeout: 30_000 });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.waitForURL(`${APP}/`);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await hooks<number>('h.cookieCount()')).toBeGreaterThan(0);
    expect(await readdir(join(userData, 'data'))).toContain('credentials.json');
  });

  it('abre a aba Cenários', async () => {
    await page.locator('a[href="/cenarios/"]').first().click();
    await page.waitForURL(`${APP}/cenarios/`);
    await page.locator('canvas').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    // O holograma desenhou: nenhum erro de WebGL no console (avisos de desempenho do driver não contam).
    expect((await hooks<string[]>('h.consoleMessages')).filter((line) => /^error:.*WebGL/i.test(line))).toEqual([]);
  });

  it('navegação e janela para fora do app são barradas', async () => {
    await page.evaluate(() => {
      location.href = 'https://example.com/';
    });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(`${APP}/cenarios/`);
    expect(await page.evaluate(() => window.open('https://example.com/') === null)).toBe(true);
    expect(await app.mainEval<number>(`require('electron').BrowserWindow.getAllWindows().length`)).toBe(1);
    const kinds = await hooks<string[]>('h.violations.map((v) => v.kind)');
    expect(kinds).toContain('navigation');
    expect(kinds).toContain('window-open');
  });

  it('nada sai para a rede: outros endereços recebem 403 do próprio app, e o proxy é um proxy morto', async () => {
    const statuses = await app.mainEval<number[]>(`(async () => {
      const ses = require('electron').session.fromPartition('jesus');
      const out = [];
      for (const url of ['https://example.com/', 'http://jesus.invalid/', 'http://127.0.0.1:5173/']) out.push((await ses.fetch(url)).status);
      return out;
    })()`);
    expect(statuses).toEqual([403, 403, 403]);
    const proxies = await app.mainEval<string[]>(`(async () => {
      const { session } = require('electron');
      return Promise.all([
        session.fromPartition('jesus').resolveProxy('wss://example.com/'),
        session.defaultSession.resolveProxy('https://example.com/'),
      ]);
    })()`);
    for (const proxy of proxies) expect(proxy).toMatch(/SOCKS5? 0\.0\.0\.0:9/);
    expect(await page.evaluate(() => fetch('https://example.com/').then(() => 'saiu', () => 'barrado'))).toBe('barrado');
    // Nenhum nome resolve pelo Chromium: a pré-resolução de DNS da página (`<link rel="dns-prefetch">`) não passa pelo
    // proxy e iria direto ao DNS do sistema.
    const resolved = await app.mainEval<string[]>(`(async () => {
      const { session } = require('electron');
      return Promise.all([session.fromPartition('jesus'), session.defaultSession].map((ses) =>
        ses.resolveHost('example.com').then(() => 'resolveu', (error) => String(error.message))));
    })()`);
    expect(resolved).toEqual([expect.stringMatching(/ERR_NAME_NOT_RESOLVED/), expect.stringMatching(/ERR_NAME_NOT_RESOLVED/)]);
  });

  it('permissões negadas e sem ferramentas de desenvolvedor', async () => {
    const states = await page.evaluate(async () =>
      Promise.all(
        ['geolocation', 'notifications', 'camera', 'microphone'].map(async (name) => {
          try {
            return (await navigator.permissions.query({ name: name as PermissionName })).state;
          } catch {
            return 'denied';
          }
        }),
      ),
    );
    expect(states).toEqual(['denied', 'denied', 'denied', 'denied']);
    const devtools = await app.mainEval<boolean>(`(() => {
      const contents = require('electron').BrowserWindow.getAllWindows()[0].webContents;
      contents.openDevTools();
      return contents.isDevToolsOpened();
    })()`);
    expect(devtools).toBe(false);
  });

  it('quadro com outra origem: o vigia derruba a sessão e a janela volta bloqueada', async () => {
    // Um iframe `srcdoc` com sandbox tem origem opaca e não busca nada na rede: nem o `frame-src 'none'` nem a guarda
    // de navegação o pegam. O vigia de quadros pega depois que ele carrega.
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<iframe sandbox srcdoc="<p>de fora</p>"></iframe>');
    });
    await expect
      .poll(async () => hooks<string[]>("h.violations.filter((v) => v.kind === 'frame-origin').map((v) => v.url)"))
      .toEqual(['about:srcdoc']);
    await unlock();
  });

  it('página principal levada para about:blank (por script ou meta refresh): o vigia derruba a sessão', async () => {
    // about:blank herda a origem do app e não passa pela guarda de navegação: só o vigia pega.
    const blanks = () => hooks<number>("h.violations.filter((v) => v.kind === 'frame-origin' && v.url === 'about:blank').length");
    await page.evaluate(() => {
      location.href = 'about:blank';
    });
    await expect.poll(blanks).toBe(1);
    await unlock();
    await page.evaluate(() => {
      const meta = document.createElement('meta');
      meta.httpEquiv = 'refresh';
      meta.content = '0;url=about:blank';
      document.head.append(meta);
    });
    await expect.poll(blanks).toBe(2);
    await unlock();
  });

  it('um beforeunload da página não segura o vigia: a janela volta bloqueada mesmo assim', async () => {
    // Com ativação do usuário (a senha digitada já conta), o beforeunload cancelaria a navegação pedida pelo principal.
    await page.evaluate(() => {
      window.addEventListener('beforeunload', (event) => {
        event.preventDefault();
      });
    });
    await page.keyboard.press('a');
    const frames = () => hooks<number>("h.violations.filter((v) => v.kind === 'frame-origin').length");
    const before = await frames();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<iframe sandbox srcdoc="<p>de fora</p>"></iframe>');
    });
    await expect.poll(frames).toBe(before + 1);
    await unlock();
  });

  it('bloquear apaga a sessão e volta para a entrada', async () => {
    await page.goto(`${APP}/`);
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await unlock();
  });

  it('Windows bloqueou a sessão, suspendeu ou voltou da suspensão: o Jesus volta para a entrada', async () => {
    for (const event of ['lock-screen', 'suspend', 'resume']) {
      await page.goto(`${APP}/`);
      await page.waitForURL(`${APP}/`);
      await hooks(`h.emitPower(${JSON.stringify(event)})`);
      // O pote de cookies do principal já foi apagado; a página vai para a entrada.
      expect(await hooks<number>('h.cookieCount()')).toBe(0);
      await unlock();
    }
    // O servidor da interface confirmou cada bloqueio a tempo (sem confirmação em 2 s, ele seria reiniciado).
    await page.waitForTimeout(2_500);
    expect(await hooks<boolean>("h.serverEvents.some((e) => e.type === 'failed')")).toBe(false);
  });

  it('Configurações: a chave vai para o cofre do principal e nunca volta para a tela', async () => {
    await page.goto(`${APP}/configuracoes/`);
    await page.getByRole('heading', { name: 'Chave da API da Anthropic' }).waitFor();
    const state = page.locator('.settings-state');
    const field = page.locator('#anthropic-key');
    const message = page.getByRole('status');
    await field.fill(FAKE_ADMIN);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect.poll(() => message.textContent()).toContain('administrador');
    const vaultProblem = await hooks<string | null>('h.vaultProblem()');
    await field.fill(FAKE_KEY);
    await page.getByRole('button', { name: 'Guardar' }).click();
    if (vaultProblem === null) {
      // Windows (DPAPI) ou Linux com chaveiro: guardou.
      await expect.poll(() => state.textContent()).toBe('Guardada no cofre.');
      await page.getByRole('button', { name: 'Apagar chave' }).click();
      await expect.poll(() => state.textContent()).toBe('Nenhuma chave guardada.');
    } else {
      // Linux sem chaveiro (contêiner, CI): o cofre recusa (sem cifra, ou com a senha embutida) e não guarda nada.
      await expect.poll(() => message.textContent()).toMatch(/cofre do sistema não está disponível|chaveiro seguro/);
      expect(await state.textContent()).toBe('Nenhuma chave guardada.');
    }
    // A chave não aparece na tela, no registro de texto do principal nem nos arquivos de dados.
    expect(await page.content()).not.toContain(FAKE_KEY);
    expect(await field.inputValue()).toBe('');
    expect(app.output.join('')).not.toContain(FAKE_KEY);
    for (const name of await readdir(join(userData, 'data'))) {
      const content = await readFile(join(userData, 'data', name), 'utf8').catch(() => '');
      expect(content, name).not.toContain(FAKE_KEY);
      expect(content, name).not.toContain(FAKE_ADMIN);
    }
  });

  it('se o servidor da interface cair, ele volta sozinho e o Jesus volta bloqueado', async () => {
    const before = await hooks<number>('h.uiServerPid()');
    await hooks('h.killUiServer()');
    await expect
      .poll(async () => hooks<number>("h.serverEvents.filter((e) => e.type === 'ready').length"), { timeout: 30_000 })
      .toBe(2);
    expect(await hooks<number>('h.uiServerPid()')).not.toBe(before);
    await unlock();
  });

  it('o registro de auditoria fica encadeado, confere com a âncora e guarda os eventos de segurança', async () => {
    const auditFile = join(userData, 'data', 'audit.jsonl');
    // A âncora fica no cofre (Windows) ou, sem cofre, num arquivo ao lado: o principal diz qual é.
    const check = async () => verifyChain(await readFile(auditFile, 'utf8'), await hooks<AuditAnchor | null>('h.auditAnchor()')).status;
    await expect.poll(check).toBe('ok');
    const events = (await readFile(auditFile, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => (JSON.parse(line) as { event: { type: string; kind?: string } }).event);
    const types = events.map((event) => event.type);
    for (const type of ['app.opened', 'ui_server.ready', 'window.violation', 'app.locked', 'vault.key_refused', 'ui_server.exited']) {
      expect(types).toContain(type);
    }
    expect(events.some((event) => event.type === 'window.violation' && event.kind === 'frame-origin')).toBe(true);
  });

  it('nenhuma violação de CSP no caminho todo', async () => {
    const lines = await hooks<string[]>('h.consoleMessages');
    // As únicas recusas esperadas são as dos próprios testes (example.com e o quadro de fora).
    const unexpected = lines.filter((line) => /Content Security Policy|Refused to/i.test(line) && !/example\.com|srcdoc|about:/.test(line));
    expect(unexpected).toEqual([]);
  });
});
