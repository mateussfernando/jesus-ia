import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { computeCost, normalizeUsage } from '@jesus/models';
import type { ModelCard } from '@jesus/models';
import type { AuditEvent } from '@jesus/shared/audit';
import { MAX_API_CHUNK_BYTES } from '../../bridge/brain-protocol';
import type { EgressFailure } from '../../bridge/brain-protocol';
import { ANTHROPIC_VERSION, API_PATH, checkApiRequest } from './api-policy';
import type { ApiRequestInput, CheckedApiRequest } from './api-policy';
import { worstCaseCostPUsd } from './spend';
import type { DailySpend } from './spend';
import { SseUsageReader } from './sse-usage';
import type { SseUsage } from './sse-usage';
import { UpstreamError } from './transport';
import type { Transport } from './transport';

/**
 * Saída para a API da Anthropic, no processo principal (decisão 0023). Para cada pedido do Cérebro:
 * 1. confere o pedido (`checkApiRequest`): fora da lista, recusa e registra o motivo;
 * 2. lê a chave do cofre (só aqui, na hora; o Cérebro nunca a vê);
 * 3. reserva o pior caso no teto do dia e grava a reserva no registro de auditoria (sem registro, o pedido não sai);
 * 4. manda pelo transporte de autoridades fixas e devolve a resposta em pedaços, lendo o uso no caminho;
 * 5. liquida pelo uso real (ou pelo pior caso, se o uso não veio) e registra a chamada.
 * O bloqueio do Jesus interrompe tudo o que está em andamento.
 */

export type KeyRead = { readonly ok: true; readonly key: string } | { readonly ok: false; readonly problem: 'no_key' | 'vault' };

/** Para onde vai a resposta de um pedido (no app, mensagens ao Cérebro). Cada pedido termina em `end` ou `fail`. */
export interface EgressSink {
  head(status: number, headers: [string, string][]): void;
  chunk(chunk: Uint8Array): void;
  end(): void;
  fail(reason: EgressFailure): void;
}

export interface EgressOptions {
  readonly transport: Pick<Transport, 'send'>;
  readonly readKey: () => KeyRead;
  readonly spend: DailySpend;
  /** Cartão do modelo (preços e janela) no registro de modelos. */
  readonly card: ModelCard;
  /** Grava no registro de auditoria; rejeita se não gravou. */
  readonly audit: (event: AuditEvent) => Promise<unknown>;
  readonly toolNames: readonly string[];
  readonly userAgent: string;
  readonly maxInflight?: number;
  readonly maxResponseBytes?: number;
  readonly newRequestId?: () => string;
  readonly now?: () => number;
}

export interface Egress {
  /** Atende um pedido do Cérebro. A função devolvida cancela (o Cérebro desistiu): nada mais vai para o `sink`. */
  send(input: ApiRequestInput, sink: EgressSink): () => void;
  /** Interrompe tudo o que está em andamento: o bloqueio avisa o Cérebro (`locked`); o Cérebro caído, não. */
  cancelAll(reason: 'locked' | 'brain_gone'): void;
  readonly inflight: number;
}

/** Cabeçalhos da resposta que seguem para o Cérebro (o AI SDK lê o tipo e o id do pedido). */
const RESPONSE_HEADERS: readonly string[] = ['content-type', 'request-id'];
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
/** Recusas e estouros do teto vão ao registro no máximo uma vez por minuto (o resto é contado). */
const AUDIT_THROTTLE_MS = 60_000;

interface Inflight {
  readonly controller: AbortController;
  readonly sink: EgressSink;
  /** Interrompido pelo bloqueio do Jesus: o Cérebro recebe `locked`. */
  locked: boolean;
  /** O Cérebro desistiu do pedido (ou caiu): nada mais vai para ele. */
  silent: boolean;
  done: boolean;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function forwardedHeaders(headers: IncomingHttpHeaders): [string, string][] {
  const list: [string, string][] = [];
  for (const name of RESPONSE_HEADERS) {
    const value = headerValue(headers, name);
    if (value !== undefined && value.length <= 256 && !/[\r\n]/.test(value) && !value.includes('\u0000')) list.push([name, value]);
  }
  return list;
}

class ResponseTooLarge extends Error {}

/** Custo a liquidar e se ele é estimado (pior caso) ou veio do uso informado pela API. */
interface Charge {
  readonly costPUsd: number;
  readonly estimated: boolean;
  readonly usage?: { readonly input: number; readonly cacheRead: number; readonly cacheWrite: number; readonly output: number };
}

function charge(i: {
  sent: boolean;
  status: number | undefined;
  usage: SseUsage | null;
  estimate: number;
  maxTokens: number;
  card: ModelCard;
}): Charge {
  // Não saiu: nada a cobrar. Erro da API (4xx e 5xx): a API não cobra.
  if (!i.sent) return { costPUsd: 0, estimated: false };
  if (i.status !== undefined && (i.status < 200 || i.status >= 300)) return { costPUsd: 0, estimated: false };
  if (i.usage === null || i.usage.raw === null || i.usage.broken) return { costPUsd: i.estimate, estimated: true };
  // Sem a saída final (resposta cortada ou cancelada), a saída conta inteira.
  const raw = i.usage.final ? i.usage.raw : { ...i.usage.raw, output_tokens: i.maxTokens };
  const report = normalizeUsage('anthropic', raw);
  if (report === null) return { costPUsd: i.estimate, estimated: true };
  const cost = computeCost(report, i.card);
  return {
    costPUsd: cost.totalPUsd,
    estimated: !i.usage.final,
    usage: {
      input: report.inputTokens,
      cacheRead: report.cacheReadTokens,
      cacheWrite: report.cacheWrite5mTokens + report.cacheWrite1hTokens,
      output: report.outputTokens,
    },
  };
}

export function createEgress(options: EgressOptions): Egress {
  const now = options.now ?? (() => performance.now());
  const newRequestId = options.newRequestId ?? randomUUID;
  const maxInflight = options.maxInflight ?? 2;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const inflight = new Set<Inflight>();
  const throttle = new Map<string, { at: number; suppressed: number }>();

  /** Grava sem esperar; uma falha aqui já fica no log de quem grava. */
  const note = (event: AuditEvent) => void options.audit(event).catch(() => undefined);
  /** Grava no máximo uma vez por minuto por tipo, contando as que ficaram de fora. */
  const noteThrottled = (event: AuditEvent) => {
    const at = now();
    const last = throttle.get(event.type);
    if (last !== undefined && at - last.at < AUDIT_THROTTLE_MS) {
      last.suppressed += 1;
      return;
    }
    throttle.set(event.type, { at, suppressed: 0 });
    note({ ...event, ...(last !== undefined && last.suppressed > 0 ? { suppressed: last.suppressed } : {}) });
  };

  const finish = (record: Inflight, failure: EgressFailure | null) => {
    if (record.done) return;
    record.done = true;
    inflight.delete(record);
    if (record.silent) return;
    const reason = record.locked ? 'locked' : failure;
    if (reason === null) record.sink.end();
    else record.sink.fail(reason);
  };

  const outgoingHeaders = (key: string, checked: CheckedApiRequest): Record<string, string> => ({
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'x-api-key': key,
    'user-agent': options.userAgent,
    ...(checked.betas.length > 0 ? { 'anthropic-beta': checked.betas.join(',') } : {}),
  });

  const run = async (record: Inflight, checked: CheckedApiRequest, key: string, requestId: string, estimate: number) => {
    const started = now();
    try {
      await options.audit({
        type: 'api.reserved',
        request: requestId,
        reserved_pusd: estimate,
        max_tokens: checked.maxTokens,
        body_bytes: checked.bodyBytes,
        messages: checked.messages,
        tools: checked.tools,
        betas: checked.betas.join(','),
      });
    } catch {
      // Sem registro, sem gasto: a reserva volta e o pedido não sai.
      options.spend.settle(requestId, 0);
      finish(record, 'audit');
      return;
    }

    let sent = false;
    let status: number | undefined;
    let apiRequestId: string | undefined;
    let reader: SseUsageReader | null = null;
    let failure: EgressFailure | null = null;
    try {
      const response = await options.transport.send(
        { path: API_PATH, headers: outgoingHeaders(key, checked), body: Buffer.from(checked.body, 'utf8') },
        record.controller.signal,
      );
      sent = true;
      status = response.status;
      apiRequestId = headerValue(response.headers, 'request-id');
      if (!record.controller.signal.aborted) record.sink.head(status, forwardedHeaders(response.headers));
      const contentType = headerValue(response.headers, 'content-type') ?? '';
      if (status >= 200 && status < 300 && contentType.startsWith('text/event-stream')) reader = new SseUsageReader();
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > maxResponseBytes) throw new ResponseTooLarge();
        reader?.push(chunk);
        if (record.controller.signal.aborted) continue;
        // Cópia de cada pedaço: um Buffer do Node pode ser uma fatia do reservatório compartilhado, com outros dados do
        // principal do lado (a chave, nos cabeçalhos), e a mensagem ao Cérebro levaria o reservatório inteiro.
        for (let offset = 0; offset < chunk.byteLength; offset += MAX_API_CHUNK_BYTES) {
          record.sink.chunk(new Uint8Array(chunk.subarray(offset, offset + MAX_API_CHUNK_BYTES)));
        }
      }
      reader?.end();
    } catch (error) {
      if (error instanceof ResponseTooLarge) {
        failure = 'too_large';
        record.controller.abort();
      } else if (error instanceof UpstreamError) {
        // Um redirecionamento é uma resposta da API sem processar o pedido: não é cobrado.
        if (error.reason !== 'redirect') sent = sent || error.sent;
        failure =
          error.reason === 'timeout'
            ? 'timeout'
            : error.reason === 'redirect'
              ? 'redirect'
              : status !== undefined
                ? 'interrupted'
                : 'network';
      } else {
        failure = 'network';
      }
    }

    const charged = charge({ sent, status, usage: reader?.result ?? null, estimate, maxTokens: checked.maxTokens, card: options.card });
    options.spend.settle(requestId, charged.costPUsd);
    const outcome = record.locked ? 'locked' : record.silent ? 'cancelled' : (failure ?? 'ok');
    note({
      type: 'api.call',
      request: requestId,
      outcome,
      ...(status === undefined ? {} : { status }),
      ...(apiRequestId === undefined ? {} : { api_request: apiRequestId.slice(0, 128) }),
      ...(reader?.result.streamError == null ? {} : { stream_error: reader.result.streamError }),
      cost_pusd: charged.costPUsd,
      estimated: charged.estimated,
      ...(charged.usage === undefined ? {} : { usage: charged.usage }),
      duration_ms: Math.round(now() - started),
    });
    finish(record, failure);
  };

  const start = (input: ApiRequestInput, sink: EgressSink): (() => void) => {
    const record: Inflight = { controller: new AbortController(), sink, locked: false, silent: false, done: false };
    const cancel = () => {
      if (record.done) return;
      record.silent = true;
      record.controller.abort();
    };

    const check = checkApiRequest(input, { toolNames: options.toolNames });
    if (!check.ok) {
      noteThrottled({ type: 'api.refused', refusal: check.refusal, detail: check.detail });
      sink.fail('refused');
      return () => undefined;
    }
    if (inflight.size >= maxInflight) {
      sink.fail('busy');
      return () => undefined;
    }
    const key = options.readKey();
    if (!key.ok) {
      sink.fail(key.problem);
      return () => undefined;
    }
    const requestId = newRequestId();
    const estimate = worstCaseCostPUsd(options.card, check.request.bodyBytes, check.request.maxTokens);
    if (!options.spend.reserve(requestId, estimate)) {
      const day = options.spend.snapshot();
      noteThrottled({
        type: 'api.over_budget',
        estimate_pusd: estimate,
        spent_pusd: day.settledPUsd,
        reserved_pusd: day.reservedPUsd,
        limit_pusd: day.limitPUsd,
      });
      sink.fail('over_budget');
      return () => undefined;
    }
    inflight.add(record);
    // Todo pedido termina, mesmo com um erro inesperado no caminho (o Cérebro nunca fica esperando). A reserva fica
    // presa até o app fechar, e o registro a cobra inteira na próxima abertura: falha fechada.
    run(record, check.request, key.key, requestId, estimate).catch(() => {
      record.controller.abort();
      finish(record, 'internal');
    });
    return cancel;
  };

  return {
    send(input, sink) {
      try {
        return start(input, sink);
      } catch {
        // Erro inesperado antes de sair: o pedido termina aqui, e o tratador de mensagens do principal nunca vê a falha.
        sink.fail('internal');
        return () => undefined;
      }
    },
    cancelAll(reason) {
      for (const record of [...inflight]) {
        if (reason === 'locked') record.locked = true;
        else record.silent = true;
        record.controller.abort();
      }
    },
    get inflight() {
      return inflight.size;
    },
  };
}
