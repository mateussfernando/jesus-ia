import { CREDIT_WINDOW, MAX_CHUNK_BYTES, parseRequestPortIn, parseToServer } from '../bridge/protocol';
import type { ConfigMessage, RequestMeta } from '../bridge/protocol';
import { wrapPort } from '../bridge/ports';
import type { BridgePort, MessagePortLike, ParentPortLike } from '../bridge/ports';
import { createHostBridge } from './desktop-bridge';
import type { HostBridge } from './desktop-bridge';

/**
 * Lado do servidor da interface na ponte (roda no utilityProcess `jesus-next`; decisão 0017). Espera a configuração
 * (uma vez só), carrega o servidor e atende cada pedido pelo port que veio com ele. A resposta sai em pedaços de no
 * máximo 64 KiB, com no máximo `CREDIT_WINDOW` pedaços sem confirmação: se a janela parar de ler, o servidor para de
 * produzir (e o Next também, pela contrapressão do adaptador).
 */

export type Serve = (request: Request) => Promise<Response>;

export interface LoadedServer {
  readonly serve: Serve;
  readonly prepareMs: number;
}

export type LoadServer = (config: ConfigMessage) => Promise<LoadedServer>;

export type HostLog = (message: string) => void;

/** O principal fecha o port de cada pedido ao receber o fim; se não fechar, o servidor fecha depois disso. */
const CLOSE_FALLBACK_MS = 5_000;
const MAX_FAILURE_MESSAGE = 4_000;

function writeToStderr(message: string): void {
  process.stderr.write(`[jesus-next] ${message}\n`);
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return text.slice(0, MAX_FAILURE_MESSAGE);
}

/** Responde erro num port que não vai ser atendido (pedido inválido ou servidor ainda não pronto). */
function refuse(port: MessagePortLike): void {
  const bridge = wrapPort(port);
  bridge.post({ type: 'error' });
  setTimeout(() => bridge.close(), CLOSE_FALLBACK_MS).unref();
}

export function runNextHost(parent: ParentPortLike, load: LoadServer, log: HostLog = writeToStderr, host: HostBridge = createHostBridge()): void {
  let phase: 'waiting-config' | 'loading' | 'ready' | 'failed' = 'waiting-config';
  let serve: Serve | null = null;
  host.connect((message) => parent.postMessage(message));

  parent.on('message', (event) => {
    const message = parseToServer(event.data);
    const [port, ...extraPorts] = event.ports;
    for (const extra of extraPorts) extra.close();

    if (message === null) {
      log('mensagem inválida do processo principal recusada');
      if (port !== undefined) refuse(port);
      return;
    }
    if (message.type === 'ping') {
      // Responde em qualquer fase: o que o principal confere é se o laço de eventos daqui ainda gira.
      port?.close();
      parent.postMessage({ type: 'pong', seq: message.seq });
      return;
    }
    if (message.type === 'lock') {
      // A confirmação só sai depois de o bloqueio ser aplicado; sem ela, o principal reinicia este processo.
      port?.close();
      if (host.lock(message.reason)) parent.postMessage({ type: 'lock-ack', seq: message.seq });
      return;
    }
    if (message.type === 'activity') {
      port?.close();
      host.activity();
      return;
    }
    if (message.type === 'vault-reply') {
      port?.close();
      host.vaultReply(message);
      return;
    }
    if (message.type === 'config') {
      port?.close();
      // A configuração vale uma vez: trocar a pasta de dados com o servidor rodando nunca é aceito.
      if (phase !== 'waiting-config') {
        log('configuração repetida recusada');
        return;
      }
      phase = 'loading';
      host.configure(message.idleMs);
      load(message).then(
        (loaded) => {
          serve = loaded.serve;
          phase = 'ready';
          parent.postMessage({ type: 'ready', prepareMs: Math.min(loaded.prepareMs, 10 * 60 * 1000) });
        },
        (error: unknown) => {
          phase = 'failed';
          parent.postMessage({ type: 'failed', message: describeError(error) });
        },
      );
      return;
    }
    if (port === undefined) {
      log('pedido sem port recusado');
      return;
    }
    if (serve === null) {
      refuse(port);
      return;
    }
    void serveOverPort(serve, message.meta, wrapPort(port));
  });
}

/** Atende um pedido e manda a resposta pelo port, respeitando os créditos. Nunca lança. */
export async function serveOverPort(serve: Serve, meta: RequestMeta, port: BridgePort, window = CREDIT_WINDOW): Promise<void> {
  const abort = new AbortController();
  let credits = window;
  let wake: (() => void) | null = null;
  let finished = false;
  let fallback: NodeJS.Timeout | null = null;
  const wakeUp = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  port.onMessage((data) => {
    const message = parseRequestPortIn(data);
    // Crédito nunca passa da janela; `cancel` ou qualquer coisa inválida encerra o pedido.
    if (message?.type === 'ack') credits = Math.min(credits + 1, window);
    else abort.abort();
    wakeUp();
  });
  port.onClose(() => {
    if (fallback !== null) clearTimeout(fallback);
    if (!finished) abort.abort();
    wakeUp();
  });

  const finish = (type: 'end' | 'error') => {
    finished = true;
    if (!abort.signal.aborted) port.post({ type });
    fallback = setTimeout(() => port.close(), CLOSE_FALLBACK_MS);
    fallback.unref();
  };

  let response: Response;
  try {
    const request = new Request(meta.url, {
      method: meta.method,
      headers: meta.headers,
      body: meta.body,
      signal: abort.signal,
    });
    response = await serve(request);
  } catch {
    finish('error');
    return;
  }
  if (abort.signal.aborted) {
    await response.body?.cancel().catch(() => undefined);
    finish('error');
    return;
  }

  port.post({ type: 'head', status: response.status, statusText: response.statusText, headers: [...response.headers] });
  if (response.body !== null) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < value.byteLength; offset += MAX_CHUNK_BYTES) {
          while (credits <= 0 && !abort.signal.aborted) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          if (abort.signal.aborted) throw new Error('pedido cancelado');
          credits -= 1;
          // `slice` copia só o pedaço: a cópia estruturada de uma vista levaria o buffer inteiro.
          port.post({ type: 'chunk', chunk: value.slice(offset, offset + MAX_CHUNK_BYTES) });
        }
      }
    } catch {
      await reader.cancel().catch(() => undefined);
      finish('error');
      return;
    }
  }
  finish('end');
}
