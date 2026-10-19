import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

/**
 * Abre o build de teste do app e conecta nos dois lados (só o build de teste aceita essas chaves; o de produção recusa
 * qualquer argumento, seção 3.13):
 * - a página, pelo CDP (`--remote-debugging-port`), com o Playwright conectando depois que ela carregou: o
 *   `_electron.launch` conecta cedo demais e o Playwright marca a página como caída na troca inicial de processo da
 *   janela (que usa uma partição própria);
 * - o processo principal, pelo inspetor do Node (`--inspect`), para conferir sessão, proxy e os ganchos de teste.
 */

const electronPath = createRequire(import.meta.url)('electron') as string;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const APP = 'https://jesus.invalid';

export interface RunningApp {
  readonly child: ChildProcess;
  readonly browser: Browser;
  readonly page: Page;
  readonly output: string[];
  /** Avalia uma expressão no processo principal (com `require`); devolve o valor (JSON). */
  mainEval<T>(expression: string): Promise<T>;
  close(): Promise<void>;
}

function waitForLine(child: ChildProcess, pattern: RegExp, output: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`não apareceu ${String(pattern)}:\n${output.join('')}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const match = pattern.exec(buffer);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        child.stderr?.off('data', onData);
        resolve(match[1]);
      }
    };
    child.stderr?.on('data', onData);
    child.once('exit', (code) => reject(new Error(`o app saiu (${String(code)}):\n${output.join('')}`)));
  });
}

interface InspectorReply {
  id: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
  error?: { message: string };
}

async function connectInspector(url: string): Promise<{ evaluate: (expression: string) => Promise<unknown>; close: () => void }> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('não conectou no inspetor do processo principal')), { once: true });
  });
  let nextId = 1;
  const pending = new Map<number, (reply: InspectorReply) => void>();
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    const reply = JSON.parse(event.data) as InspectorReply;
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  return {
    evaluate: (expression) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, (reply) => {
          const details = reply.result?.exceptionDetails;
          if (reply.error !== undefined) reject(new Error(reply.error.message));
          else if (details !== undefined) reject(new Error(details.exception?.description ?? details.text ?? 'erro'));
          else resolve(reply.result?.result?.value);
        });
        socket.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true },
          }),
        );
      }),
    close: () => socket.close(),
  };
}

/** Variáveis do sistema que o app precisa para abrir (no Windows, sem `SystemRoot` nem a conferência de administrador roda). */
const WINDOWS_ENV = ['SystemRoot', 'windir', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'PATHEXT', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'COMPUTERNAME'];

function baseEnv(userData: string): Record<string, string> {
  if (process.platform === 'win32') {
    const env: Record<string, string> = { PATH: process.env['PATH'] ?? '' };
    for (const name of WINDOWS_ENV) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? userData,
    DISPLAY: process.env['DISPLAY'] ?? '',
    XAUTHORITY: process.env['XAUTHORITY'] ?? '',
  };
}

/** Espera a janela do app aparecer no CDP com uma página do app carregada. */
async function waitForAppPage(devtoolsUrl: string, timeoutMs: number): Promise<void> {
  const { host } = new URL(devtoolsUrl);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const targets = (await (await fetch(`http://${host}/json/list`)).json()) as { type: string; url: string }[];
      if (targets.some((target) => target.type === 'page' && target.url.startsWith(`${APP}/`))) return;
    } catch {
      // Ainda subindo.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('a janela do app não carregou a tempo');
}

/**
 * Abre o app. Com `executable` (o build de teste empacotado, `release-test/*-unpacked`), roda o pacote de verdade, com
 * a interface de dentro do `app.asar`; sem ele, o Electron de desenvolvimento com o bundle `dist-test/main.mjs`.
 */
export async function launchApp(options: {
  mainEntry: string;
  userData: string;
  executable?: string | undefined;
  /** Tempo sem uso até bloquear (só o build de teste aceita); sem ele, o padrão de 15 min. */
  idleMs?: number;
}): Promise<RunningApp> {
  const asRoot = process.getuid?.() === 0;
  const packaged = options.executable !== undefined && options.executable !== '';
  const child = spawn(
    packaged ? (options.executable ?? '') : electronPath,
    [
      ...(asRoot ? ['--no-sandbox'] : []),
      // Sem GPU (contêiner, CI), o WebGL do holograma só sobe com o renderizador por software.
      '--enable-unsafe-swiftshader',
      '--inspect=0',
      '--remote-debugging-port=0',
      ...(packaged ? [] : [options.mainEntry]),
    ],
    {
      env: {
        ...baseEnv(options.userData),
        JESUS_E2E_USER_DATA: options.userData,
        ...(options.idleMs === undefined ? {} : { JESUS_E2E_IDLE_MS: String(options.idleMs) }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const output: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));

  const [inspectorUrl, devtoolsUrl] = await Promise.all([
    waitForLine(child, /Debugger listening on (ws:\/\/\S+)/, output, 30_000),
    waitForLine(child, /DevTools listening on (ws:\/\/\S+)/, output, 30_000),
  ]);
  const inspector = await connectInspector(inspectorUrl);
  await waitForAppPage(devtoolsUrl, 60_000);
  const browser = await chromium.connectOverCDP(devtoolsUrl);
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (page === undefined) throw new Error('a página do app não apareceu no CDP');
  return {
    child,
    browser,
    page,
    output,
    mainEval: async <T>(expression: string) => (await inspector.evaluate(expression)) as T,
    async close() {
      await browser.close().catch(() => undefined);
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        // Saída normal: o Chromium fecha os processos auxiliares e solta os arquivos da pasta de dados (no Windows, um
        // kill derruba só o principal, e os auxiliares ainda seguram arquivos por um instante). Com o inspetor
        // conectado, o Node espera o depurador sair antes de encerrar: o inspetor fecha logo depois do pedido.
        await Promise.race([inspector.evaluate("require('electron').app.quit()"), sleep(2_000)]).catch(() => undefined);
        inspector.close();
        const fallback = setTimeout(() => child.kill(), 10_000);
        await exited;
        clearTimeout(fallback);
      } else {
        inspector.close();
      }
    },
  };
}
