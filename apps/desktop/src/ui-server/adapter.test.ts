import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { APP_HOST, isHeaderFromPageAllowed, serveWithNodeHandler } from './adapter';
import type { NodeHandler } from './adapter';

const BASE = 'https://jesus.invalid';

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Corpo em vários pedaços, como o Chromium entrega um POST grande. */
function chunkedBody(parts: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts[i++];
      if (part === undefined) controller.close();
      else controller.enqueue(encoder.encode(part));
    },
  });
}

describe('adaptador em memória Request → Node → Response', () => {
  it('atende GET com cabeçalhos, status e corpo', async () => {
    const handler: NodeHandler = (req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      res.end(`<p>${req.method ?? ''} ${req.url ?? ''}</p>`);
    };
    const response = await serveWithNodeHandler(handler, new Request(`${BASE}/entrar/?x=1`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<p>GET /entrar/?x=1</p>');
  });

  it('HEAD, 204 e 304 saem sem corpo; 307 e 308 mantêm o Location', async () => {
    const handler: NodeHandler = (req, res) => {
      const status = Number(req.url?.slice(1) ?? '200');
      if (status === 307 || status === 308) res.writeHead(status, { location: '/entrar/' });
      else res.writeHead(status);
      res.end('corpo que não pode sair');
    };
    const head = await serveWithNodeHandler(handler, new Request(`${BASE}/200`, { method: 'HEAD' }));
    expect(head.body).toBeNull();
    for (const status of [204, 304]) {
      const response = await serveWithNodeHandler(handler, new Request(`${BASE}/${String(status)}`));
      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
    }
    for (const status of [307, 308]) {
      const response = await serveWithNodeHandler(handler, new Request(`${BASE}/${String(status)}`));
      expect(response.status).toBe(status);
      expect(response.headers.get('location')).toBe('/entrar/');
    }
  });

  it('entrega vários Set-Cookie na mesma resposta', async () => {
    const handler: NodeHandler = (_req, res) => {
      res.setHeader('set-cookie', ['a=1; Path=/; HttpOnly', 'b=2; Path=/; Secure']);
      res.end();
    };
    const response = await serveWithNodeHandler(handler, new Request(`${BASE}/`));
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; Secure']);
  });

  it('lê o corpo de um POST que chega em vários pedaços (Server Action)', async () => {
    const handler: NodeHandler = async (req, res) => {
      res.end(await readBody(req));
    };
    const parts = ['["primeiro', ' pedaço",', ' "segundo', ' pedaço"]'];
    const request = new Request(`${BASE}/entrar/`, {
      method: 'POST',
      body: chunkedBody(parts),
      headers: { 'next-action': 'abc', 'content-type': 'text/plain;charset=UTF-8' },
      duplex: 'half',
    } as RequestInit);
    const response = await serveWithNodeHandler(handler, request);
    expect(await response.text()).toBe(parts.join(''));
  });

  it('o servidor vê só jesus.invalid em https, sem cabeçalhos ditados pela página', async () => {
    let seen: IncomingMessage | null = null;
    const handler: NodeHandler = (req, res) => {
      seen = req;
      res.end();
    };
    const request = new Request(`${BASE}/`, {
      headers: {
        'x-forwarded-host': 'atacante.example',
        'x-forwarded-for': '1.2.3.4',
        forwarded: 'host=atacante.example',
        'x-middleware-subrequest': 'middleware',
        'x-invoke-path': '/x',
        'accept-encoding': 'gzip',
        'next-action': 'id-da-acao',
        rsc: '1',
      },
    });
    await serveWithNodeHandler(handler, request);
    const req = seen as IncomingMessage | null;
    expect(req?.headers['host']).toBe(APP_HOST);
    expect(req?.headers['x-forwarded-proto']).toBe('https');
    expect(req?.headers['x-forwarded-host']).toBeUndefined();
    expect(req?.headers['x-forwarded-for']).toBeUndefined();
    expect(req?.headers['forwarded']).toBeUndefined();
    expect(req?.headers['x-middleware-subrequest']).toBeUndefined();
    expect(req?.headers['x-invoke-path']).toBeUndefined();
    expect(req?.headers['accept-encoding']).toBeUndefined();
    expect(req?.headers['next-action']).toBe('id-da-acao');
    expect(req?.headers['rsc']).toBe('1');
    expect((req?.socket as unknown as { encrypted?: boolean } | undefined)?.encrypted).toBe(true);
  });

  it('decide quais cabeçalhos da página passam', () => {
    expect(isHeaderFromPageAllowed('Next-Router-State-Tree')).toBe(true);
    expect(isHeaderFromPageAllowed('cookie')).toBe(true);
    expect(isHeaderFromPageAllowed('Host')).toBe(false);
    expect(isHeaderFromPageAllowed('X-Forwarded-Proto')).toBe(false);
    expect(isHeaderFromPageAllowed('Transfer-Encoding')).toBe(false);
    expect(isHeaderFromPageAllowed('x-nextjs-data')).toBe(false);
  });

  it('manda o corpo em streaming: o primeiro pedaço chega antes do fim', async () => {
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const handler: NodeHandler = async (_req, res) => {
      res.write('primeiro');
      await gate;
      res.end(' fim');
    };
    const response = await serveWithNodeHandler(handler, new Request(`${BASE}/`));
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe('primeiro');
    finish();
    const second = await reader?.read();
    expect(new TextDecoder().decode(second?.value)).toBe(' fim');
    expect((await reader?.read())?.done).toBe(true);
  });

  it('aplica contrapressão: write devolve false e o escritor só continua depois do drain', async () => {
    const big = 'x'.repeat(48 * 1024);
    let sawFalse = false;
    let drains = 0;
    const handler: NodeHandler = async (_req, res) => {
      for (let i = 0; i < 6; i++) {
        if (!res.write(big)) {
          sawFalse = true;
          await new Promise<void>((resolve) => res.once('drain', resolve));
          drains++;
        }
      }
      res.end();
    };
    const response = await serveWithNodeHandler(handler, new Request(`${BASE}/`));
    const text = await response.text();
    expect(sawFalse).toBe(true);
    expect(drains).toBeGreaterThan(0);
    expect(text.length).toBe(6 * big.length);
  });

  it('a página que desiste (cancela o corpo) fecha a resposta no servidor', async () => {
    let closed = false;
    const handler: NodeHandler = (_req, res: ServerResponse) => {
      res.on('close', () => {
        closed = true;
      });
      res.write('começo');
    };
    const response = await serveWithNodeHandler(handler, new Request(`${BASE}/`));
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(true);
  });

  it('pedido abortado pela janela também fecha a resposta', async () => {
    let closed = false;
    const controller = new AbortController();
    const handler: NodeHandler = (_req, res) => {
      res.on('close', () => {
        closed = true;
      });
      res.write('começo');
    };
    await serveWithNodeHandler(handler, new Request(`${BASE}/`, { signal: controller.signal }));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(true);
  });

  it('erro do servidor antes dos cabeçalhos vira 500 sem detalhe', async () => {
    const handler: NodeHandler = () => {
      throw new Error('segredo do servidor');
    };
    const response = await serveWithNodeHandler(handler, new Request(`${BASE}/`));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('segredo');
  });

  it('erro depois dos cabeçalhos interrompe o corpo', async () => {
    const handler: NodeHandler = (_req, res) => {
      res.write('parte');
      setTimeout(() => res.destroy(new Error('caiu no meio')), 0);
    };
    const response = await serveWithNodeHandler(handler, new Request(`${BASE}/`));
    await expect(response.text()).rejects.toThrow();
  });

  it('não deixa mudar cabeçalhos depois de enviados', async () => {
    let error: unknown = null;
    const handler: NodeHandler = (_req, res) => {
      res.writeHead(200);
      try {
        res.setHeader('x-tarde', '1');
      } catch (e) {
        error = e;
      }
      res.end();
    };
    await serveWithNodeHandler(handler, new Request(`${BASE}/`));
    expect(error).toMatchObject({ code: 'ERR_HTTP_HEADERS_SENT' });
  });
});
