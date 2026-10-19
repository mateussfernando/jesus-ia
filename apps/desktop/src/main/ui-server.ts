import { BRIDGE_METHODS, CREDIT_WINDOW, MAX_HEADER_BYTES, MAX_HEADERS, MAX_REQUEST_BODY_BYTES, MAX_URL_LENGTH } from '../bridge/protocol';
import { parseFromServer, parseRequestPortOut } from '../bridge/protocol';
import type {
  ActivityMessage,
  BridgeMethod,
  ConfigMessage,
  HeaderList,
  LockMessage,
  RequestMeta,
  SpendReply,
  SpendRequest,
  VaultReply,
  VaultRequest,
} from '../bridge/protocol';
import { wrapPort } from '../bridge/ports';
import type { ChannelLike, UtilityChildLike } from '../bridge/ports';
import { isAppUrl } from './policy/url';

/**
 * Lado do processo principal na ponte com o servidor da interface (`jesus-next`, decisão 0017). Sobe o utilityProcess,
 * manda a configuração por mensagem, encaminha cada pedido da janela por um port próprio e devolve a `Response` com o
 * corpo em streaming. Falha fechada em tudo: servidor fora do ar dá 503, mensagem inválida dá 502, demora dá 504, e
 * um pedido em andamento quando o processo cai é interrompido (nunca fica pendurado). Um servidor vivo mas preso (laço
 * infinito, expressão regular catastrófica) para de responder ao sinal de vida e é derrubado, como se tivesse caído.
 *
 * No Electron 44, o `protocol.handle` nunca aborta o `request.signal`: a janela desistir de um pedido antes do cabeçalho
 * não chega aqui, e o pedido segue até a resposta ou o prazo de 504 (o cancelamento do corpo chega).
 *
 * O estado de acesso (bloqueado ou não) mora no servidor da interface: se ele cair, o novo começa bloqueado. Quem usa
 * este módulo limpa o pote de cookies e volta a janela para o início no evento `exited`.
 */

export interface UiServerTiming {
  /** Sem `ready` nesse tempo depois de subir, o processo é derrubado e conta como falha. */
  readonly readyTimeoutMs: number;
  /** Quanto um pedido espera o servidor ficar pronto antes de receber 503. */
  readonly waitReadyMs: number;
  /** Sem cabeçalho de resposta nesse tempo, 504. */
  readonly headTimeoutMs: number;
  /** Esperas antes de cada novo início, na ordem; a última se repete. */
  readonly restartDelaysMs: readonly number[];
  /** Um processo que viveu isso depois de pronto zera a contagem de quedas seguidas. */
  readonly stableAfterMs: number;
  /** Quedas seguidas antes de desistir (a janela passa a mostrar que o servidor não sobe). */
  readonly maxConsecutiveFailures: number;
  /** De quanto em quanto tempo o principal manda o sinal de vida (`ping`) ao servidor pronto. */
  readonly pingIntervalMs: number;
  /** Sem `pong` nesse tempo, o servidor está preso: é derrubado e sobe de novo. */
  readonly pingTimeoutMs: number;
}

export const DEFAULT_TIMING: UiServerTiming = {
  readyTimeoutMs: 30_000,
  waitReadyMs: 10_000,
  headTimeoutMs: 30_000,
  restartDelaysMs: [250, 1_000, 3_000, 10_000],
  stableAfterMs: 60_000,
  maxConsecutiveFailures: 5,
  // A senha (bcrypt) não segura o laço: é assíncrona. Um laço parado por 15 s não é trabalho normal.
  pingIntervalMs: 5_000,
  pingTimeoutMs: 15_000,
};

export type UiServerEvent =
  | { readonly type: 'starting'; readonly attempt: number }
  | { readonly type: 'ready'; readonly attempt: number; readonly pid: number | undefined; readonly prepareMs: number }
  | {
      readonly type: 'failed';
      readonly reason: 'fork-error' | 'failed-message' | 'ready-timeout' | 'invalid-message' | 'unresponsive' | 'lock-unconfirmed';
      readonly message: string;
    }
  | { readonly type: 'exited'; readonly code: number; readonly inflight: number }
  | { readonly type: 'restarting'; readonly delayMs: number; readonly failures: number }
  | { readonly type: 'gave-up'; readonly failures: number }
  | { readonly type: 'invalid-response' };

export interface UiServerOptions {
  /** Sobe o utilityProcess (no app: `utilityProcess.fork` com ambiente de lista e `serviceName: 'jesus-next'`). */
  readonly fork: () => UtilityChildLike;
  /** Canal novo para cada pedido (no app: `new MessageChannelMain()`). */
  readonly createChannel: () => ChannelLike;
  readonly config: Omit<ConfigMessage, 'type'>;
  readonly onEvent?: (event: UiServerEvent) => void;
  /** O servidor confirmou um bloqueio mandado com `notify` (decisão 0019). */
  readonly onLockAck?: (seq: number) => void;
  /** Pedido do servidor ao cofre (decisão 0020). Sem quem atenda, a resposta é falha. */
  readonly onVaultRequest?: (request: VaultRequest) => Promise<Omit<VaultReply, 'type' | 'id'>>;
  /** Pedido do servidor ao teto de gasto do dia (decisão 0023). Sem quem atenda, a resposta é falha. */
  readonly onSpendRequest?: (request: SpendRequest) => Promise<Omit<SpendReply, 'type' | 'id'>>;
  readonly timing?: Partial<UiServerTiming>;
  readonly now?: () => number;
}

export interface UiServer {
  /** Atende um pedido da janela. Nunca rejeita: qualquer falha vira uma resposta de erro. */
  serve(request: Request): Promise<Response>;
  /** Resolve quando o servidor fica pronto pela primeira vez; rejeita se ele desistir de subir ou for parado antes. */
  whenReady(): Promise<void>;
  /** Aviso do principal ao servidor pronto (bloqueio, uso). `false` se não há servidor pronto para receber. */
  notify(message: LockMessage | ActivityMessage): boolean;
  /** Derruba o servidor atual, que sobe de novo (bloqueado): um bloqueio sem confirmação no prazo. */
  restartUnconfirmed(): void;
  stop(): void;
}

/** Cabeçalhos que a página nunca manda ao servidor (só o próprio servidor, no repasse interno de Server Action). */
const PAGE_HEADER_DENY: ReadonlySet<string> = new Set(['x-action-forwarded']);
const NULL_BODY_STATUS: ReadonlySet<number> = new Set([204, 205, 304]);

const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: 'Pedido inválido.',
  403: 'Endereço fora do app.',
  405: 'Método não atendido.',
  413: 'Pedido grande demais.',
  431: 'Cabeçalhos grandes demais.',
  500: 'Erro interno no servidor da interface.',
  502: 'O servidor da interface respondeu algo inválido.',
  503: 'O servidor da interface está iniciando. A página tenta de novo sozinha.',
  504: 'O servidor da interface demorou demais para responder.',
};
const GAVE_UP_TEXT = 'O servidor da interface não conseguiu iniciar. Feche e abra o Jesus de novo.';

/**
 * Página de erro do próprio principal: sem script nem estilo (`default-src 'none'`). A de 503 se recarrega sozinha
 * (o `meta refresh` não depende de script).
 */
export function statusPage(status: number, options: { text?: string; retry?: boolean } = {}): Response {
  const text = options.text ?? STATUS_TEXT[status] ?? 'Erro.';
  const refresh = options.retry === true ? '<meta http-equiv="refresh" content="2">' : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${refresh}<title>Jesus</title></head><body><p>${text}</p></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  });
}

function isBridgeMethod(method: string): method is BridgeMethod {
  return (BRIDGE_METHODS as readonly string[]).includes(method);
}

/** Cabeçalhos da página que seguem para o servidor; `null` se passarem dos limites. */
export function pageHeaders(headers: Headers): HeaderList | null {
  const list: [string, string][] = [];
  let bytes = 0;
  for (const [name, value] of headers) {
    if (PAGE_HEADER_DENY.has(name)) continue;
    list.push([name, value]);
    bytes += name.length + value.length;
  }
  return list.length > MAX_HEADERS || bytes > MAX_HEADER_BYTES ? null : list;
}

/** Lê o corpo inteiro até o limite; acima dele, desiste sem ler o resto. */
export async function readBodyLimited(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | 'too-large' | 'unreadable'> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return 'too-large';
      }
      parts.push(value);
    }
  } catch {
    return 'unreadable';
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

/** Derruba o processo. No Electron, `kill()` antes do evento `spawn` não faz nada: aí a morte fica para quando ele subir. */
function terminate(child: UtilityChildLike): void {
  if (child.kill()) return;
  child.on('spawn', () => child.kill());
}

interface ChildRecord {
  readonly child: UtilityChildLike;
  readonly attempt: number;
  readonly startedAt: number;
  ready: boolean;
  readonly inflight: Set<() => void>;
}

export function startUiServer(options: UiServerOptions): UiServer {
  const timing: UiServerTiming = { ...DEFAULT_TIMING, ...options.timing };
  const now = options.now ?? (() => performance.now());
  const emit = (event: UiServerEvent) => options.onEvent?.(event);

  let current: ChildRecord | null = null;
  let attempts = 0;
  let failures = 0;
  let gaveUp = false;
  let stopped = false;
  let restartTimer: NodeJS.Timeout | null = null;
  const readyWaiters = new Set<() => void>();

  let resolveFirstReady: () => void = () => undefined;
  let rejectFirstReady: (error: Error) => void = () => undefined;
  const firstReady = new Promise<void>((resolve, reject) => {
    resolveFirstReady = resolve;
    rejectFirstReady = reject;
  });
  // Quem não espera o primeiro `ready` não deve ver rejeição solta.
  firstReady.catch(() => undefined);

  const wakeWaiters = () => {
    for (const wake of [...readyWaiters]) wake();
    readyWaiters.clear();
  };

  /** Conta uma queda e agenda o próximo início, ou desiste depois de quedas seguidas demais. */
  const afterFailure = (stable: boolean) => {
    failures = stable ? 1 : failures + 1;
    if (failures >= timing.maxConsecutiveFailures) {
      gaveUp = true;
      emit({ type: 'gave-up', failures });
      rejectFirstReady(new Error('o servidor da interface não conseguiu iniciar'));
      wakeWaiters();
      return;
    }
    const delays = timing.restartDelaysMs;
    const delayMs = delays[Math.min(failures, delays.length) - 1] ?? 1_000;
    emit({ type: 'restarting', delayMs, failures });
    restartTimer = setTimeout(spawn, delayMs);
  };

  const spawn = () => {
    restartTimer = null;
    if (stopped) return;
    attempts += 1;
    emit({ type: 'starting', attempt: attempts });
    let child: UtilityChildLike;
    try {
      child = options.fork();
    } catch (error) {
      emit({ type: 'failed', reason: 'fork-error', message: error instanceof Error ? error.message : String(error) });
      afterFailure(false);
      return;
    }
    const record: ChildRecord = { child, attempt: attempts, startedAt: now(), ready: false, inflight: new Set() };
    current = record;

    const readyTimer = setTimeout(() => {
      if (record.ready || current !== record) return;
      emit({ type: 'failed', reason: 'ready-timeout', message: 'o servidor da interface não ficou pronto a tempo' });
      terminate(child);
    }, timing.readyTimeoutMs);

    // Vigia de vida (depois de pronto): um `ping` por vez; sem `pong` no prazo, o processo é derrubado. O caminho de
    // queda limpa a sessão e reinicia, como numa queda de verdade. No Windows, o `kill()` é um TerminateProcess, que um
    // laço preso não segura; no Linux, um SIGTERM (o Next só trata esse sinal no `next start`, que o app não usa).
    let ping: { readonly seq: number; readonly sentAt: number } | null = null;
    let pingSeq = 0;
    let unresponsive = false;
    const watchdog = setInterval(() => {
      if (current !== record) {
        clearInterval(watchdog);
        return;
      }
      if (!record.ready) return;
      if (ping === null) {
        pingSeq += 1;
        ping = { seq: pingSeq, sentAt: now() };
        try {
          child.postMessage({ type: 'ping', seq: pingSeq });
        } catch {
          // O prazo cuida disso.
        }
        return;
      }
      if (unresponsive || now() - ping.sentAt < timing.pingTimeoutMs) return;
      unresponsive = true;
      emit({ type: 'failed', reason: 'unresponsive', message: 'o servidor da interface parou de responder' });
      terminate(child);
    }, timing.pingIntervalMs);

    child.on('message', (data) => {
      if (current !== record) return;
      const message = parseFromServer(data);
      if (message === null) {
        // Mensagem fora do protocolo: o processo não é confiável, cai e sobe de novo.
        emit({ type: 'failed', reason: 'invalid-message', message: 'mensagem inválida do servidor da interface' });
        terminate(child);
        return;
      }
      if (message.type === 'failed') {
        emit({ type: 'failed', reason: 'failed-message', message: message.message });
        terminate(child);
        return;
      }
      if (message.type === 'lock-ack') {
        if (record.ready) options.onLockAck?.(message.seq);
        return;
      }
      if (message.type === 'vault') {
        // Só de um servidor pronto; a resposta volta para o mesmo processo, se ele ainda for o atual.
        if (!record.ready) return;
        const failed: Omit<VaultReply, 'type' | 'id'> = { ok: false, anthropicKey: 'unknown', problem: 'failed' };
        const answer = options.onVaultRequest?.(message) ?? Promise.resolve(failed);
        void answer
          .catch(() => failed)
          .then((result) => {
            if (current !== record) return;
            try {
              child.postMessage({ type: 'vault-reply', id: message.id, ...result });
            } catch {
              // O processo saiu; o pedido do outro lado falha pelo prazo.
            }
          });
        return;
      }
      if (message.type === 'spend') {
        if (!record.ready) return;
        const failed: Omit<SpendReply, 'type' | 'id'> = { ok: false, problem: 'failed' };
        const answer = options.onSpendRequest?.(message) ?? Promise.resolve(failed);
        void answer
          .catch(() => failed)
          .then((result) => {
            if (current !== record) return;
            try {
              child.postMessage({ type: 'spend-reply', id: message.id, ...result });
            } catch {
              // O processo saiu; o pedido do outro lado falha pelo prazo.
            }
          });
        return;
      }
      if (message.type === 'pong') {
        // Só vale a resposta ao `ping` pendente; qualquer outra é fuga do protocolo.
        if (ping?.seq !== message.seq) {
          emit({ type: 'failed', reason: 'invalid-message', message: 'sinal de vida fora de ordem' });
          terminate(child);
          return;
        }
        ping = null;
        return;
      }
      if (record.ready) return;
      record.ready = true;
      clearTimeout(readyTimer);
      emit({ type: 'ready', attempt: record.attempt, pid: child.pid, prepareMs: message.prepareMs });
      resolveFirstReady();
      wakeWaiters();
    });

    child.on('exit', (code) => {
      clearTimeout(readyTimer);
      clearInterval(watchdog);
      emit({ type: 'exited', code, inflight: record.inflight.size });
      for (const fail of [...record.inflight]) fail();
      if (current !== record) return;
      current = null;
      if (stopped) return;
      afterFailure(record.ready && now() - record.startedAt >= timing.stableAfterMs);
    });

    try {
      child.postMessage({ type: 'config', ...options.config });
    } catch {
      terminate(child);
    }
  };

  const readyChild = async (): Promise<ChildRecord | null> => {
    const deadline = now() + timing.waitReadyMs;
    for (;;) {
      if (stopped || gaveUp) return null;
      if (current?.ready === true) return current;
      const remaining = deadline - now();
      if (remaining <= 0) return null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, remaining);
        function done() {
          clearTimeout(timer);
          readyWaiters.delete(done);
          resolve();
        }
        readyWaiters.add(done);
      });
    }
  };

  const unavailable = () => (gaveUp ? statusPage(503, { text: GAVE_UP_TEXT }) : statusPage(503, { retry: !stopped }));

  const forward = (record: ChildRecord, meta: RequestMeta, signal: AbortSignal): Promise<Response> =>
    new Promise<Response>((resolve) => {
      const channel = options.createChannel();
      const port = wrapPort(channel.port1);
      let state: 'head' | 'body' | 'done' = 'head';
      let nullBody = false;
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      // Pedaços recebidos e ainda não confirmados: a confirmação sai quando a janela tem espaço para ler.
      let owed = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          start: (c) => {
            controller = c;
          },
          pull: () => {
            while (owed > 0 && state === 'body') {
              owed -= 1;
              port.post({ type: 'ack' });
            }
          },
          cancel: () => abandon(),
        },
        { highWaterMark: 2 },
      );

      const headTimer = setTimeout(() => fail(504), timing.headTimeoutMs);
      const cleanup = () => {
        state = 'done';
        clearTimeout(headTimer);
        record.inflight.delete(serverGone);
        signal.removeEventListener('abort', abandon);
        port.close();
      };
      const fail = (status: number) => {
        if (state === 'done') return;
        if (state === 'head') resolve(statusPage(status, { retry: status === 503 }));
        else if (!nullBody) controller?.error(new Error('resposta interrompida'));
        port.post({ type: 'cancel' });
        cleanup();
      };
      // A janela desistiu (navegou, fechou ou cancelou a leitura do corpo).
      function abandon() {
        if (state === 'done') return;
        if (state === 'head') resolve(statusPage(503));
        port.post({ type: 'cancel' });
        cleanup();
      }
      const serverGone = () => fail(503);
      const violation = () => {
        emit({ type: 'invalid-response' });
        fail(502);
      };

      record.inflight.add(serverGone);
      if (signal.aborted) {
        abandon();
        return;
      }
      signal.addEventListener('abort', abandon, { once: true });
      port.onClose(() => fail(502));
      port.onMessage((data) => {
        if (state === 'done') return;
        const message = parseRequestPortOut(data);
        if (message === null) {
          violation();
          return;
        }
        switch (message.type) {
          case 'head': {
            if (state !== 'head') {
              violation();
              return;
            }
            clearTimeout(headTimer);
            nullBody = meta.method === 'HEAD' || NULL_BODY_STATUS.has(message.status);
            let response: Response;
            try {
              response = new Response(nullBody ? null : stream, {
                status: message.status,
                statusText: message.statusText,
                headers: message.headers,
              });
            } catch {
              violation();
              return;
            }
            state = 'body';
            resolve(response);
            return;
          }
          case 'chunk': {
            // Corpo onde não cabe corpo, ou mais pedaços do que os créditos permitem: o servidor fugiu do protocolo.
            if (state !== 'body' || nullBody || controller === null || owed >= CREDIT_WINDOW) {
              violation();
              return;
            }
            controller.enqueue(message.chunk);
            if ((controller.desiredSize ?? 0) > 0) port.post({ type: 'ack' });
            else owed += 1;
            return;
          }
          case 'end': {
            if (state !== 'body') {
              violation();
              return;
            }
            if (!nullBody) controller?.close();
            cleanup();
            return;
          }
          case 'error':
            fail(500);
            return;
        }
      });
      try {
        record.child.postMessage({ type: 'request', meta }, [channel.port2]);
      } catch {
        fail(500);
      }
    });

  spawn();

  return {
    async serve(request) {
      try {
        const method = request.method.toUpperCase();
        if (!isBridgeMethod(method)) return statusPage(405);
        if (request.url.length > MAX_URL_LENGTH || !isAppUrl(request.url)) return statusPage(403);
        const headers = pageHeaders(request.headers);
        if (headers === null) return statusPage(431);
        let body: Uint8Array<ArrayBuffer> | null = null;
        if (method === 'POST') {
          const declared = Number(request.headers.get('content-length') ?? '0');
          if (declared > MAX_REQUEST_BODY_BYTES) return statusPage(413);
          const read = await readBodyLimited(request.body, MAX_REQUEST_BODY_BYTES);
          if (read === 'too-large') return statusPage(413);
          if (read === 'unreadable') return statusPage(400);
          body = read;
        }
        const record = await readyChild();
        if (record === null) return unavailable();
        return await forward(record, { url: request.url, method, headers, body }, request.signal);
      } catch {
        return statusPage(500);
      }
    },
    whenReady: () => firstReady,
    notify(message) {
      const record = current;
      if (record?.ready !== true) return false;
      try {
        record.child.postMessage(message);
        return true;
      } catch {
        return false;
      }
    },
    restartUnconfirmed() {
      const record = current;
      if (record === null) return;
      emit({ type: 'failed', reason: 'lock-unconfirmed', message: 'o servidor da interface não confirmou o bloqueio a tempo' });
      terminate(record.child);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (restartTimer !== null) clearTimeout(restartTimer);
      rejectFirstReady(new Error('servidor da interface parado'));
      wakeWaiters();
      const record = current;
      current = null;
      if (record !== null) {
        for (const fail of [...record.inflight]) fail();
        terminate(record.child);
      }
    },
  };
}
