import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, readlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeChannel, FakeUtilityChild } from '../bridge/fake-ipc';
import { CookieJar } from '../main/cookie-jar';
import { startUiServer } from '../main/ui-server';
import type { UiServer } from '../main/ui-server';
import { runNextHost } from './host';
import { loadNextServer } from './next-server';

/**
 * O servidor do Next de verdade (build standalone montado, o mesmo que vai no app) atrás da ponte inteira: principal
 * → port → servidor da interface → adaptador → Next. Só o processo é falso (roda no processo do teste); a mensagem,
 * a cópia estruturada, os créditos e o pote de cookies são os do app.
 */

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(process.env['JESUS_UI_DIR'] ?? join(here, '..', '..', 'stage', 'ui', 'apps', 'ui'));
const APP = 'https://jesus.invalid';
const PASSWORD = 'cavalo bateria grampo correto 42';

interface ActionManifest {
  node: Record<string, { exportedName: string; workers: Record<string, unknown> }>;
}

let server: UiServer;
let dataDir: string;
let manifest: ActionManifest;
let actions: Record<string, string>;
const jar = new CookieJar();

/** O que o `protocol.handle` do principal faz (etapa 3): põe o cookie do pote e guarda o `Set-Cookie`. */
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${APP}${path}`;
  const headers = new Headers(init.headers);
  const cookie = jar.headerFor(url);
  if (cookie !== null) headers.set('cookie', cookie);
  const response = await server.serve(new Request(url, { ...init, headers }));
  jar.storeFromResponse(url, response.headers.getSetCookie());
  return response;
}

function callAction(path: string, name: string, args: unknown[]): Promise<Response> {
  const id = actions[name];
  if (id === undefined) throw new Error(`ação ${name} não está no manifesto`);
  return send(path, {
    method: 'POST',
    headers: { 'next-action': id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component' },
    body: JSON.stringify(args),
  });
}

function nonceOf(response: Response): string | null {
  return /'nonce-([A-Za-z0-9+/]+)'/.exec(response.headers.get('content-security-policy') ?? '')?.[1] ?? null;
}

beforeAll(async () => {
  if (!existsSync(join(uiDir, '.next', 'required-server-files.json'))) {
    throw new Error(
      `Falta o build da interface em ${uiDir}. Rode: JESUS_DESKTOP_BUILD=1 npm run build -w @jesus/ui && npm run stage:ui -w @jesus/desktop`,
    );
  }
  manifest = JSON.parse(
    await readFile(join(uiDir, '.next', 'server', 'server-reference-manifest.json'), 'utf8'),
  ) as ActionManifest;
  actions = Object.fromEntries(Object.entries(manifest.node).map(([id, entry]) => [entry.exportedName, id]));
  dataDir = await mkdtemp(join(tmpdir(), 'jesus-desktop-'));
  server = startUiServer({
    fork: () => new FakeUtilityChild((parent) => runNextHost(parent, loadNextServer)),
    createChannel: createFakeChannel,
    config: { uiDir, dataDir },
    timing: { readyTimeoutMs: 90_000, waitReadyMs: 90_000 },
  });
  await server.whenReady();
});

afterAll(async () => {
  server.stop();
  await rm(dataDir, { recursive: true, force: true });
});

describe('servidor do Next atrás da ponte, sem porta', () => {
  it('sem senha criada, o início manda para a tela de entrada', async () => {
    const response = await send('/');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/entrar/');
  });

  it('a tela de entrada sai com CSP de nonce novo a cada pedido e cabeçalhos de segurança', async () => {
    const first = await send('/entrar/');
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('Crie a senha do Jesus');
    expect(first.headers.get('x-frame-options')).toBe('DENY');
    const second = await send('/entrar/');
    await second.body?.cancel();
    expect(nonceOf(first)).not.toBeNull();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it('HEAD não traz corpo', async () => {
    const response = await send('/entrar/', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it('a Server Action cria a senha na pasta de dados recebida por mensagem, com cookie Secure', async () => {
    const response = await callAction('/entrar/', 'setupPassword', [PASSWORD]);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"ok":true');
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith('jesus_session='));
    expect(cookie).toMatch(/; Secure/i);
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; SameSite=Strict/i);
    expect(await readdir(dataDir)).toContain('credentials.json');
    const stored = await readFile(join(dataDir, 'credentials.json'), 'utf8');
    expect(stored).not.toContain(PASSWORD);
  });

  it('com a sessão, o início abre', async () => {
    const response = await send('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('/cenarios/');
  });

  it('a aba Cenários (a página mais pesada) chega inteira em streaming', async () => {
    const response = await send('/cenarios/');
    expect(response.status).toBe(200);
    let chunks = 0;
    let bytes = 0;
    const reader = response.body?.getReader();
    for (;;) {
      const next = await reader?.read();
      if (next === undefined || next.done) break;
      chunks += 1;
      bytes += next.value.byteLength;
    }
    expect(chunks).toBeGreaterThan(0);
    expect(bytes).toBeGreaterThan(1000);
  });

  it('ação chamada de uma página que não a contém é repassada em memória (shim de fetch)', async () => {
    // Pré-condição: a tela de entrada não importa o checkSession, então o Next precisa repassar.
    expect(Object.keys(manifest.node[actions['checkSession'] ?? '']?.workers ?? {})).not.toContain('app/entrar/page');
    const response = await callAction('/entrar/', 'checkSession', []);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"unlocked":true');
  });

  it('os estáticos do build saem com o tipo certo', async () => {
    const chunks = await readdir(join(uiDir, '.next', 'static', 'chunks'));
    const script = chunks.find((name) => name.endsWith('.js'));
    expect(script).toBeDefined();
    const response = await send(`/_next/static/chunks/${script ?? ''}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/javascript/);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('o servidor da interface não fala com a rede', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow('fetch recusado');
  });

  it('bloquear apaga a sessão: o início volta para a tela de entrada', async () => {
    const lock = await callAction('/', 'lockNow', []);
    expect(lock.status).toBe(200);
    await lock.body?.cancel();
    const response = await send('/');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/entrar/');
  });
  it('estático cancelado no meio fecha o arquivo (no Linux, conferido pelos descritores abertos)', async () => {
    const chunksDir = join(uiDir, '.next', 'static', 'chunks');
    // O maior pedaço de JS do build: vários pedaços de 64 KiB pela ponte.
    let largest = { name: '', size: 0 };
    for (const name of (await readdir(chunksDir)).filter((file) => file.endsWith('.js'))) {
      const { size } = await stat(join(chunksDir, name));
      if (size > largest.size) largest = { name, size };
    }
    expect(largest.size).toBeGreaterThan(256 * 1024);
    const openFiles = async () => {
      if (process.platform !== 'linux') return 0;
      let count = 0;
      for (const fd of await readdir('/proc/self/fd')) {
        try {
          if ((await readlink(`/proc/self/fd/${fd}`)).endsWith(largest.name)) count++;
        } catch {
          // Fechou enquanto a lista era lida.
        }
      }
      return count;
    };
    const before = await openFiles();
    for (let i = 0; i < 5; i++) {
      const response = await send(`/_next/static/chunks/${largest.name}`);
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      await reader?.read();
      await reader?.cancel();
    }
    const end = Date.now() + 3_000;
    while ((await openFiles()) !== before && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await openFiles()).toBe(before);
  });
});
