import { MAX_API_BODY_BYTES } from '../bridge/brain-protocol';
import type { EgressFailure, ToBrainApiMessage } from '../bridge/brain-protocol';

/**
 * O `fetch` que o AI SDK usa no Cérebro (decisão 0023): não abre conexão nenhuma. Cada chamada vira uma mensagem
 * `api-request` ao processo principal, e a resposta volta pelas mensagens `api-*` com o mesmo `id`. O principal confere
 * o pedido, põe a chave e manda; o Cérebro só vê a resposta (ou o motivo da recusa, como `EgressError`).
 */

export class EgressError extends Error {
  override readonly name = 'EgressError';
  readonly reason: EgressFailure;

  constructor(reason: EgressFailure) {
    super(`a saída para a API recusou o pedido: ${reason}`);
    this.reason = reason;
  }
}

/**
 * O motivo da saída por trás de um erro do AI SDK: a recusa antes da resposta chega como `EgressError`; a interrupção
 * no meio do corpo chega embrulhada (`APICallError` com a causa).
 */
export function egressFailureOf(error: unknown): EgressFailure | null {
  const seen = new Set<unknown>();
  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (current instanceof EgressError) return current.reason;
  }
  return null;
}

export interface BrainOutbox {
  post(message: unknown): void;
}

interface Pending {
  readonly signal: AbortSignal | null;
  readonly onAbort: () => void;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('O pedido foi cancelado.', 'AbortError');
}

export class ApiFetchBridge {
  readonly #outbox: BrainOutbox;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;

  constructor(outbox: BrainOutbox) {
    this.#outbox = outbox;
  }

  /** Pedidos ainda sem fim (resposta inteira, recusa ou cancelamento). */
  get pending(): number {
    return this.#pending.size;
  }

  readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (typeof input !== 'string' && !(input instanceof URL)) {
      return Promise.reject(new TypeError('o fetch do Cérebro só aceita endereço em texto'));
    }
    const body = init?.body;
    if (typeof body !== 'string') return Promise.reject(new TypeError('o fetch do Cérebro só manda corpo em texto'));
    // Corpo acima do limite da ponte: recusa aqui mesmo. Mandado, ele seria mensagem fora do protocolo e derrubaria o
    // Cérebro (uma conversa longa, de verdade, cairia em laço até o supervisor desistir).
    if (Buffer.byteLength(body, 'utf8') > MAX_API_BODY_BYTES) return Promise.reject(new EgressError('too_large'));
    const signal = init?.signal ?? null;
    if (signal?.aborted === true) return Promise.reject(abortReason(signal));

    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => {
        const pending = this.#pending.get(id);
        if (pending === undefined || signal === null) return;
        this.#pending.delete(id);
        this.#outbox.post({ type: 'api-cancel', id });
        const reason = abortReason(signal);
        if (pending.controller === null) pending.reject(reason);
        else pending.controller.error(reason);
      };
      this.#pending.set(id, { signal, onAbort, resolve, reject, controller: null });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.#outbox.post({
          type: 'api-request',
          id,
          url: String(input),
          method: (init?.method ?? 'GET').toUpperCase(),
          headers: [...new Headers(init?.headers)],
          body,
        });
      } catch (error) {
        this.#finish(id);
        reject(error);
      }
    });
  };

  /** Mensagem do principal sobre um pedido. `false`: mensagem fora de ordem (o pedido não existe ou já começou). */
  handle(message: ToBrainApiMessage): boolean {
    const pending = this.#pending.get(message.id);
    if (pending === undefined) {
      // Resposta de um pedido já cancelado pelo Cérebro: ignora.
      return true;
    }
    switch (message.type) {
      case 'api-head': {
        if (pending.controller !== null) return false;
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            pending.controller = controller;
          },
          cancel: () => {
            // Quem lia desistiu do corpo: o principal para de mandar.
            if (this.#finish(message.id)) this.#outbox.post({ type: 'api-cancel', id: message.id });
          },
        });
        pending.resolve(new Response(stream, { status: message.status, headers: message.headers }));
        return true;
      }
      case 'api-chunk':
        if (pending.controller === null) return false;
        pending.controller.enqueue(message.chunk);
        return true;
      case 'api-end':
        if (pending.controller === null) return false;
        this.#finish(message.id);
        pending.controller.close();
        return true;
      case 'api-error': {
        this.#finish(message.id);
        const error = new EgressError(message.reason);
        if (pending.controller === null) pending.reject(error);
        else pending.controller.error(error);
        return true;
      }
    }
  }

  /** O principal sumiu (ou o Cérebro vai sair): todo pedido em aberto falha. */
  failAll(reason: EgressFailure): void {
    for (const id of [...this.#pending.keys()]) this.handle({ type: 'api-error', id, reason });
  }

  #finish(id: number): boolean {
    const pending = this.#pending.get(id);
    if (pending === undefined) return false;
    this.#pending.delete(id);
    pending.signal?.removeEventListener('abort', pending.onAbort);
    return true;
  }
}
