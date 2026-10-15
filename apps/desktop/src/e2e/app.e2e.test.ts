import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP, launchApp } from './harness';
import type { RunningApp } from './harness';

/**
 * O app de verdade (build de teste do processo principal + servidor do Next montado), aberto pelo Electron (seção
 * 3.12). Roda com `npm run test:e2e -w @jesus/desktop` sob um X (no Linux, `xvfb-run -a`). No CI a sandbox do Chromium
 * fica ligada; como root (contêiner da nuvem), o Chromium exige `--no-sandbox`.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainEntry = join(desktopDir, 'dist-test', 'main.mjs');
const uiDir = join(desktopDir, 'stage', 'ui', 'apps', 'ui');
const PASSWORD = 'cavalo bateria grampo correto 42';

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
  for (const [path, how] of [
    [mainEntry, 'npm run build:test -w @jesus/desktop'],
    [join(uiDir, '.next', 'required-server-files.json'), 'JESUS_DESKTOP_BUILD=1 npm run build -w @jesus/ui && npm run stage:ui -w @jesus/desktop'],
  ] as const) {
    if (!existsSync(path)) throw new Error(`Falta ${path}. Rode: ${how}`);
  }
  userData = await mkdtemp(join(tmpdir(), 'jesus-e2e-'));
  app = await launchApp({ mainEntry, userData });
  page = app.page;
});

afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

describe('app de desktop: janela sem porta', () => {
  it('abre na tela de entrada, servida pelo servidor da interface no utilityProcess', async () => {
    await page.waitForURL(`${APP}/entrar/`);
    await page.getByRole('heading', { name: 'Crie a senha do Jesus' }).waitFor();
    expect(await hooks<number>('h.uiServerPid()')).toBeGreaterThan(0);
    expect(await hooks<boolean>("h.serverEvents.some((e) => e.type === 'ready')")).toBe(true);
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
    // O holograma desenhou: nenhum erro de WebGL no console.
    expect((await hooks<string[]>('h.consoleMessages')).filter((line) => /WebGL/i.test(line))).toEqual([]);
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

  it('bloquear apaga a sessão e volta para a entrada', async () => {
    await page.goto(`${APP}/`);
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await unlock();
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

  it('nenhuma violação de CSP no caminho todo', async () => {
    const lines = await hooks<string[]>('h.consoleMessages');
    // As únicas recusas esperadas são as dos próprios testes (example.com e o quadro de fora).
    const unexpected = lines.filter((line) => /Content Security Policy|Refused to/i.test(line) && !/example\.com|srcdoc|about:/.test(line));
    expect(unexpected).toEqual([]);
  });
});
