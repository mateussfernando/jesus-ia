import { Agent, request as httpsRequest } from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { rootCertificates } from 'node:tls';
import { API_HOST } from '../../bridge/brain-protocol';

/**
 * Transporte da saída para a API (decisão 0023): `https.request` do Node com agente próprio, nunca o `fetch` nem o
 * agente global. Medido no Electron 44.7.0: o `fetch` e o agente global obedecem a `NODE_EXTRA_CA_CERTS`,
 * `NODE_USE_SYSTEM_CA`, `NODE_TLS_REJECT_UNAUTHORIZED=0` e `NODE_USE_ENV_PROXY` com `HTTPS_PROXY`; um programa que
 * ponha essas variáveis no ambiente do Jesus leria a chave da API no caminho. Com agente próprio, autoridades
 * explícitas (as que vêm com o Node, `tls.rootCertificates`) e `rejectUnauthorized: true`, nenhuma delas tem efeito.
 *
 * Redirecionamento não é seguido (`redirect: 'error'`): 3xx é falha. A rede do Chromium não entra aqui (proxy morto e
 * resolvedor sem nomes, seção 3.12).
 *
 * A chave nunca vai nas opções do `https.request`, que o Node imprime no stderr com `NODE_DEBUG=https` (o app de
 * produção nem abre com `NODE_DEBUG`, seção 3.13): os cabeçalhos entram um a um, depois de criado o pedido.
 */

/**
 * Variáveis que mudariam a conexão de um `fetch` comum do Node e que este transporte ignora por construção. Se alguma
 * estiver no ambiente, o principal só registra os nomes (o valor pode ser segredo).
 */
export const EGRESS_IGNORED_ENV: readonly string[] = [
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_SYSTEM_CA',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_USE_ENV_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

/** Os nomes de `EGRESS_IGNORED_ENV` presentes no ambiente (sem diferenciar maiúsculas, como no Windows). */
export function ignoredEgressEnvironment(env: Readonly<Record<string, string | undefined>>): string[] {
  const present = new Set(Object.keys(env).map((name) => name.toUpperCase()));
  return EGRESS_IGNORED_ENV.filter((name) => present.has(name));
}

export interface UpstreamTarget {
  readonly host: string;
  readonly port: number;
  /** Autoridades aceitas. Na produção, as que vêm com o Node; nunca as do ambiente nem as do sistema. */
  readonly ca: readonly string[];
}

export const ANTHROPIC_TARGET: UpstreamTarget = { host: API_HOST, port: 443, ca: rootCertificates };

export interface TransportTiming {
  /** Até a resposta começar (cabeçalho). O raciocínio do modelo vem depois, dentro do corpo. */
  readonly headMs: number;
  /** Sem nenhum byte por esse tempo no meio da resposta (a API manda `ping` enquanto pensa). */
  readonly idleMs: number;
  /** Duração máxima de um pedido inteiro. */
  readonly totalMs: number;
}

export const DEFAULT_TRANSPORT_TIMING: TransportTiming = { headMs: 60_000, idleMs: 120_000, totalMs: 15 * 60_000 };

export interface UpstreamRequest {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

export interface UpstreamResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  /** O corpo, em pedaços. Se o transporte falhar no meio, a iteração termina com `UpstreamError`. */
  readonly body: AsyncIterable<Buffer>;
}

export type UpstreamFailure = 'network' | 'timeout' | 'redirect' | 'aborted';

export class UpstreamError extends Error {
  override readonly name = 'UpstreamError';
  readonly reason: UpstreamFailure;
  /** O pedido chegou a ir inteiro para a conexão: a API pode ter cobrado. */
  readonly sent: boolean;

  constructor(reason: UpstreamFailure, sent: boolean, message: string) {
    super(message);
    this.reason = reason;
    this.sent = sent;
  }
}

export interface Transport {
  send(request: UpstreamRequest, signal: AbortSignal): Promise<UpstreamResponse>;
  /** Fecha as conexões guardadas (na saída do app). */
  close(): void;
}

export function createTransport(target: UpstreamTarget, timing: TransportTiming = DEFAULT_TRANSPORT_TIMING): Transport {
  const tlsOptions: { ca: string[]; rejectUnauthorized: true; minVersion: 'TLSv1.2'; servername: string } = {
    ca: [...target.ca],
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    servername: target.host,
  };
  // Agente próprio: sem proxy do ambiente e sem as autoridades do agente global. Conexão parada no reservatório fecha
  // em 60 s.
  const agent = new Agent({ keepAlive: true, maxSockets: 4, timeout: 60_000, ...tlsOptions });

  const send = (upstream: UpstreamRequest, signal: AbortSignal) =>
    new Promise<UpstreamResponse>((resolve, reject) => {
      // Já cancelado: nem abre conexão.
      if (signal.aborted) {
        reject(new UpstreamError('aborted', false, 'pedido cancelado'));
        return;
      }
      let sent = false;
      let settled = false;
      let response: IncomingMessage | null = null;
      let failure: UpstreamError | null = null;
      let idleTimer: NodeJS.Timeout | null = null;
      let closed = false;

      // Os cabeçalhos (com a chave) nunca vão nas opções do `https.request`: com `NODE_DEBUG=https`, o Node imprime
      // essas opções inteiras no stderr ao abrir a conexão. Eles entram depois, um a um, antes do `end`.
      const req = httpsRequest({ host: target.host, port: target.port, path: upstream.path, method: 'POST', agent, ...tlsOptions });
      const headTimer = setTimeout(() => fail('timeout', 'a API não respondeu a tempo'), timing.headMs);
      const totalTimer = setTimeout(() => fail('timeout', 'o pedido passou do tempo máximo'), timing.totalMs);
      const clearTimers = () => {
        clearTimeout(headTimer);
        clearTimeout(totalTimer);
        if (idleTimer !== null) clearTimeout(idleTimer);
        signal.removeEventListener('abort', onAbort);
      };
      function fail(reason: UpstreamFailure, message: string) {
        if (failure !== null) return;
        failure = new UpstreamError(reason, sent, message);
        clearTimers();
        if (!settled) {
          settled = true;
          reject(failure);
        }
        // Com a resposta já entregue, a iteração do corpo termina com o mesmo erro.
        req.destroy(failure);
        response?.destroy(failure);
      }
      const touch = () => {
        if (failure !== null || closed) return;
        if (idleTimer !== null) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => fail('timeout', 'a resposta parou no meio'), timing.idleMs);
      };
      function onAbort() {
        fail('aborted', 'pedido cancelado');
      }

      // O ouvinte de erro vem antes de qualquer `destroy`: um erro sem ouvinte viraria exceção solta no principal.
      req.on('error', (error: NodeJS.ErrnoException) => fail('network', error.code ?? error.message));
      try {
        for (const [name, value] of Object.entries(upstream.headers)) req.setHeader(name, value);
        req.setHeader('content-length', String(upstream.body.byteLength));
      } catch {
        fail('network', 'cabeçalho inválido');
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      req.on('finish', () => {
        sent = true;
      });
      req.on('response', (res) => {
        clearTimeout(headTimer);
        response = res;
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          fail('redirect', `redirecionamento ${String(status)}`);
          return;
        }
        if (status < 200 || status > 599) {
          fail('network', `status inválido ${String(status)}`);
          return;
        }
        res.on('error', (error: Error) => fail('network', error.message));
        res.on('close', () => {
          // Corpo que não chegou ao fim: a conexão caiu (ou quem lia desistiu).
          if (!res.complete) fail('network', 'a resposta foi cortada');
          closed = true;
          clearTimers();
        });
        touch();
        settled = true;
        resolve({ status, headers: res.headers, body: iterate(res, touch, () => failure) });
      });
      req.end(upstream.body);
    });

  return {
    send,
    close: () => agent.destroy(),
  };
}

/** Pedaços do corpo; se o transporte falhou no meio, a iteração termina com a falha (nunca como se acabasse bem). */
async function* iterate(res: IncomingMessage, touch: () => void, failure: () => UpstreamError | null): AsyncGenerator<Buffer> {
  try {
    for await (const chunk of res) {
      touch();
      yield chunk as Buffer;
    }
  } catch (error) {
    throw failure() ?? error;
  }
  const failed = failure();
  if (failed !== null) throw failed;
  if (!res.complete) throw new UpstreamError('network', true, 'a resposta foi cortada');
}
