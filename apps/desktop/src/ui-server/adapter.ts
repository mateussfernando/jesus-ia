import { IncomingMessage, ServerResponse, STATUS_CODES } from 'node:http';
import { Socket } from 'node:net';

/**
 * Adaptador em memória entre o `protocol.handle` do Electron e o servidor do Next (decisão 0016): um `Request` do
 * padrão Fetch vira `IncomingMessage`/`ServerResponse` do Node (o que o `getRequestHandler()` do Next espera), e a
 * resposta volta como `Response` com o corpo em streaming e contrapressão. Nenhum socket de verdade: o "socket" do
 * pedido é um `net.Socket` que nunca conecta, para o Next ler `encrypted` e deduzir https. A resposta usa o mesmo
 * (como num servidor de verdade): quando a janela desiste, ele é destruído e emite `close`, que é o que o `on-finished`
 * (usado pelo `send` dos arquivos estáticos do Next) espera para fechar o arquivo.
 *
 * Partes internas do Node usadas aqui (`_header`, `finished`, `_closed`, `_readableState.readingMore`) estão fixadas
 * pelo Electron/Node da versão em uso; os testes de ponta a ponta acusam se uma versão nova mudar esse comportamento.
 */

export const APP_ORIGIN = 'https://jesus.invalid';
export const APP_HOST = 'jesus.invalid';

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => unknown;

/** Cabeçalhos de conexão: não fazem sentido sem socket. */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'te',
  'trailer',
]);

/** Cabeçalhos que a página não pode ditar ao servidor: o endereço vem da URL, e os internos do Next nunca da página. */
const FROM_PAGE_DENY: ReadonlySet<string> = new Set(['host', 'forwarded', 'x-real-ip', 'accept-encoding']);
const FROM_PAGE_DENY_PREFIXES = [
  'x-forwarded-',
  'x-middleware-',
  'x-invoke-',
  'x-next-',
  'x-nextjs-',
  'x-matched-path',
  'x-now-',
  'x-vercel-',
  // Revalidação sob demanda do Next (`x-prerender-revalidate`): nunca vem da página.
  'x-prerender-',
];

/** Respostas que nunca têm corpo. */
const NULL_BODY_STATUS: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

/** Teto de bytes enfileirados antes de o Next esperar o `drain` (contrapressão). */
const STREAM_HIGH_WATER_MARK = 64 * 1024;

export function isHeaderFromPageAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  if (HOP_BY_HOP.has(lower) || FROM_PAGE_DENY.has(lower)) return false;
  return !FROM_PAGE_DENY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

interface IncomingInternals {
  _readableState: { readingMore: boolean };
  _read: (size: number) => void;
}

/** `Request` do Fetch → `IncomingMessage`. O corpo (POST das Server Actions) é lido sob demanda do `ReadableStream`. */
export function toNodeRequest(request: Request): IncomingMessage {
  const url = new URL(request.url);
  const socket = new Socket();
  // O Next deduz o protocolo daqui; no app, a janela fala sempre com https://jesus.invalid.
  Object.defineProperty(socket, 'encrypted', { value: true });
  const req = new IncomingMessage(socket);
  req.method = request.method;
  req.url = url.pathname + url.search;
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;

  // Objeto comum (não Headers): o Next chama `headers.hasOwnProperty`.
  const headers: Record<string, string> = {};
  const raw: string[] = [];
  for (const [name, value] of request.headers) {
    if (!isHeaderFromPageAllowed(name)) continue;
    headers[name] = value;
    raw.push(name, value);
  }
  headers['host'] = APP_HOST;
  headers['x-forwarded-proto'] = 'https';
  raw.push('host', APP_HOST, 'x-forwarded-proto', 'https');
  req.headers = headers;
  req.rawHeaders = raw;

  const internals = req as unknown as IncomingInternals;
  const reader = request.body === null ? null : request.body.getReader();
  let consuming = false;
  let reading = false;
  internals._read = () => {
    // Como o `_read` original do IncomingMessage: no primeiro consumo, libera o `readingMore` (o construtor o liga
    // porque, com socket de verdade, quem empurra os dados é o parser HTTP). Sem isso, só o 1º pedaço chega.
    if (!consuming) {
      internals._readableState.readingMore = false;
      consuming = true;
    }
    if (reader === null) {
      req.push(null);
      return;
    }
    if (reading) return;
    reading = true;
    reader.read().then(
      ({ done, value }) => {
        reading = false;
        if (done) req.push(null);
        else req.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      },
      (error: unknown) => req.destroy(error instanceof Error ? error : new Error('falha ao ler o corpo do pedido')),
    );
  };
  return req;
}

interface OutgoingInternals {
  _header: string | null;
  finished: boolean;
  _closed: boolean;
  socket: Socket | null;
}

function internalError(): Response {
  return new Response('Erro interno.', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** `ServerResponse` que, em vez de escrever num socket, entrega uma `Response` com `ReadableStream` (com contrapressão). */
class MemoryResponse extends ServerResponse {
  readonly #resolve: (response: Response) => void;
  readonly #stream: ReadableStream<Uint8Array>;
  #controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  #nullBody = false;
  #cancelled = false;
  #waitingDrain = false;
  #closed = false;

  constructor(req: IncomingMessage, resolve: (response: Response) => void) {
    super(req);
    this.#internals.socket = req.socket;
    this.#resolve = resolve;
    this.#stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          this.#controller = controller;
        },
        pull: () => {
          if (this.#waitingDrain) {
            this.#waitingDrain = false;
            this.emit('drain');
          }
        },
        cancel: () => {
          // A janela desistiu (navegou, fechou): o Next aborta o render pelo evento 'close'.
          this.#cancelled = true;
          this.destroy();
        },
      },
      { highWaterMark: STREAM_HIGH_WATER_MARK, size: (chunk) => chunk.byteLength },
    );
  }

  get #internals(): OutgoingInternals {
    return this as unknown as OutgoingInternals;
  }

  override writeHead(
    statusCode: number,
    reasonOrHeaders?: string | Record<string, unknown> | readonly unknown[],
    maybeHeaders?: Record<string, unknown> | readonly unknown[],
  ): this {
    const reason = typeof reasonOrHeaders === 'string' ? reasonOrHeaders : undefined;
    const headers = typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
    if (this.#internals._header !== null) {
      throw Object.assign(new Error('Cannot write headers after they are sent'), { code: 'ERR_HTTP_HEADERS_SENT' });
    }
    this.statusCode = statusCode;
    if (reason !== undefined) this.statusMessage = reason;
    if (Array.isArray(headers)) {
      if (headers.length > 0 && Array.isArray(headers[0])) {
        for (const pair of headers as readonly (readonly [string, string])[]) this.appendHeader(pair[0], pair[1]);
      } else {
        const flat = headers as readonly string[];
        for (let i = 0; i + 1 < flat.length; i += 2) this.appendHeader(flat[i] ?? '', flat[i + 1] ?? '');
      }
    } else if (headers !== undefined) {
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) this.setHeader(name, value as string | number | readonly string[]);
      }
    }
    this.#sendHead();
    return this;
  }

  override flushHeaders(): void {
    this.#sendHead();
  }

  #sendHead(): void {
    if (this.#internals._header !== null) return;
    this.#nullBody = this.req.method === 'HEAD' || NULL_BODY_STATUS.has(this.statusCode);
    let response: Response;
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(this.getHeaders())) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        if (Array.isArray(value)) for (const item of value) headers.append(name, String(item));
        else headers.set(name, String(value));
      }
      response = new Response(this.#nullBody ? null : this.#stream, {
        status: this.statusCode,
        statusText: this.statusMessage || STATUS_CODES[this.statusCode] || '',
        headers,
      });
    } catch {
      // Status ou cabeçalho que o Fetch não aceita (103, 600, valor com quebra de linha): 500 seco, como um erro antes
      // dos cabeçalhos, e o resto da resposta é descartado.
      this.#internals._header = 'invalid';
      this.#resolve(internalError());
      this.destroy();
      return;
    }
    // Marca os cabeçalhos como enviados: `setHeader` depois disso lança, como num socket de verdade.
    this.#internals._header = `HTTP/1.1 ${String(this.statusCode)}\r\n`;
    this.#resolve(response);
  }

  override write(chunk: unknown, encodingOrCallback?: unknown, maybeCallback?: unknown): boolean {
    const encoding = typeof encodingOrCallback === 'string' ? (encodingOrCallback as BufferEncoding) : undefined;
    const callback = (typeof encodingOrCallback === 'function' ? encodingOrCallback : maybeCallback) as
      | ((error?: Error | null) => void)
      | undefined;
    if (this.#internals.finished || this.destroyed) {
      const error = Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' });
      if (callback !== undefined) process.nextTick(callback, error);
      return false;
    }
    this.#sendHead();
    if (chunk !== null && chunk !== undefined && !this.#nullBody && !this.#cancelled && this.#controller !== null) {
      const bytes =
        typeof chunk === 'string' ? Buffer.from(chunk, encoding ?? 'utf8') : Buffer.from(chunk as Uint8Array);
      // Cópia: o Next pode reaproveitar o buffer depois do write.
      if (bytes.byteLength > 0) this.#controller.enqueue(new Uint8Array(bytes));
    }
    if (callback !== undefined) process.nextTick(callback);
    const ok = (this.#controller?.desiredSize ?? 1) > 0;
    if (!ok) this.#waitingDrain = true;
    return ok;
  }

  override end(chunkOrCallback?: unknown, encodingOrCallback?: unknown, maybeCallback?: unknown): this {
    let chunk: unknown = chunkOrCallback;
    let encoding: unknown = encodingOrCallback;
    let callback: unknown = maybeCallback;
    if (typeof chunk === 'function') {
      callback = chunk;
      chunk = undefined;
      encoding = undefined;
    } else if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }
    const done = callback as (() => void) | undefined;
    // Depois de destruída (a janela desistiu ou o servidor falhou), o corpo já foi encerrado: só o retorno.
    if (this.#internals.finished || this.destroyed) {
      if (done !== undefined) process.nextTick(done);
      return this;
    }
    if (chunk !== undefined && chunk !== null) this.write(chunk, encoding);
    this.#sendHead();
    this.#internals.finished = true;
    if (!this.#nullBody && !this.#cancelled && this.#controller !== null) this.#controller.close();
    process.nextTick(() => {
      this.emit('prefinish');
      this.emit('finish');
      if (done !== undefined) done();
      this.#emitClose();
    });
    return this;
  }

  override destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (this.#internals._header === null) {
      // Falhou antes de mandar os cabeçalhos: a janela recebe um 500 seco, sem detalhe do erro.
      this.#internals._header = 'destroyed';
      this.#resolve(internalError());
    } else if (!this.#internals.finished && !this.#cancelled && !this.#nullBody && this.#controller !== null) {
      this.#controller.error(error ?? new Error('resposta interrompida'));
    }
    this.socket?.destroy();
    process.nextTick(() => this.#emitClose());
    return this;
  }

  #emitClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    // `res.closed`: o Next confere antes de continuar um trabalho que ninguém mais vai ler.
    this.#internals._closed = true;
    this.emit('close');
  }
}

/**
 * Atende um `Request` com um handler no estilo do Node. Resolve assim que os cabeçalhos saem; o corpo continua
 * chegando pelo `ReadableStream` (o App Router manda o RSC em streaming). Um erro do handler antes dos cabeçalhos
 * vira 500; depois deles, interrompe o corpo.
 */
export function serveWithNodeHandler(handler: NodeHandler, request: Request): Promise<Response> {
  const req = toNodeRequest(request);
  return new Promise<Response>((resolve) => {
    const res = new MemoryResponse(req, resolve);
    request.signal.addEventListener('abort', () => res.destroy(new Error('pedido cancelado')), { once: true });
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((error: unknown) => {
        res.destroy(error instanceof Error ? error : new Error('erro no servidor da interface'));
      });
  });
}
