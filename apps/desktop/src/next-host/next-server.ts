import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { z } from 'zod';
import type { ConfigMessage } from '../bridge/protocol';
import { APP_HOST, APP_ORIGIN, serveWithNodeHandler } from '../ui-server/adapter';
import type { NodeHandler } from '../ui-server/adapter';
import type { LoadedServer, Serve } from './host';

/**
 * Carrega o servidor do Next (build de produção do `apps/ui`) no processo atual, sem abrir porta (decisões 0016 e
 * 0017). Usa a mesma configuração gravada no build, como o `server.js` do build standalone: o `next.config.ts` não é
 * lido em tempo de execução, então o app não precisa transpilar TypeScript nem do compilador nativo do Next.
 */

const RequiredServerFilesSchema = z.object({ config: z.record(z.string(), z.unknown()) });

interface NextServer {
  prepare(): Promise<void>;
  getRequestHandler(): NodeHandler;
}

type CreateNextServer = (options: { dir: string; dev: boolean; hostname: string; port: number }) => NextServer;

/**
 * Ambiente que o servidor da interface precisa, montado aqui a partir da configuração recebida por mensagem.
 * `actionKey` é a chave (AES-256, base64) com que o Next cifra os valores capturados pelas Server Actions: sem ela, ele
 * usaria a do build, que vai igual dentro de todo `.exe` publicado. Uma por processo basta, porque a sessão cai junto
 * quando o servidor reinicia.
 */
export function serverEnv(config: ConfigMessage, nextConfig: Record<string, unknown>, actionKey: string): Record<string, string> {
  return {
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    // O app roda em https://jesus.invalid: cookie `Secure` e lista de Host só com esse nome (apps/ui/src/server).
    JESUS_HTTPS: '1',
    JESUS_DATA_DIR: config.dataDir,
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: actionKey,
    __NEXT_PRIVATE_STANDALONE_CONFIG: JSON.stringify(nextConfig),
    // O repasse de Server Action entre páginas vai para a própria origem, atendido em memória (installServerFetch).
    __NEXT_PRIVATE_ORIGIN: APP_ORIGIN,
  };
}

/**
 * O servidor da interface não fala com a rede: `fetch` falha fechado. A única exceção é o repasse de Server Action
 * que o próprio Next faz quando uma ação é chamada de uma página que não a contém (POST para a própria origem com
 * `x-action-forwarded: 1`); esse pedido é atendido em memória pelo mesmo servidor. O Next repassa para o caminho sem
 * a barra final, e com `trailingSlash: true` isso daria 308 (o repasse usa `redirect: 'manual'` e devolveria "{}"
 * sem rodar a ação): a barra é posta aqui.
 */
export function createServerFetch(serveLocal: Serve): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== APP_ORIGIN || request.method !== 'POST' || request.headers.get('x-action-forwarded') !== '1') {
      throw new TypeError('fetch recusado no servidor da interface');
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    const forwarded: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      duplex: 'half',
      redirect: 'manual',
      signal: request.signal,
    };
    return serveLocal(new Request(url, forwarded));
  };
}

export async function loadNextServer(config: ConfigMessage): Promise<LoadedServer> {
  const started = performance.now();
  const raw: unknown = JSON.parse(await readFile(join(config.uiDir, '.next', 'required-server-files.json'), 'utf8'));
  // A janela não aceita compressão (o adaptador tira o `accept-encoding`); desligar evita o trabalho à toa.
  const nextConfig = { ...RequiredServerFilesSchema.parse(raw).config, compress: false };
  Object.assign(process.env, serverEnv(config, nextConfig, randomBytes(32).toString('base64')));

  let serve: Serve | null = null;
  globalThis.fetch = createServerFetch((request) => {
    if (serve === null) return Promise.reject(new TypeError('servidor da interface ainda não está pronto'));
    return serve(request);
  });

  const requireFromUi = createRequire(join(config.uiDir, 'package.json'));
  const createNextServer: unknown = requireFromUi('next');
  if (typeof createNextServer !== 'function') throw new Error('o pacote next do build não exporta o servidor');
  const app = (createNextServer as CreateNextServer)({ dir: config.uiDir, dev: false, hostname: APP_HOST, port: 443 });
  await app.prepare();
  const handler = app.getRequestHandler();
  serve = (request) => serveWithNodeHandler(handler, request);
  return { serve, prepareMs: Math.round(performance.now() - started) };
}
