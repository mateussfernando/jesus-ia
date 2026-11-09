import { TOOL_DESCRIPTIONS, TOOL_INPUTS } from '@jesus/executor/catalog';
import type { ToolInput, ToolName } from '@jesus/executor/catalog';
import { tool } from 'ai';
import type { BrainToolResult } from '../bridge/tool-protocol';
import type { TurnBudget } from './turn-budget';

/**
 * As ferramentas de leitura no Cérebro (etapa 13; decisão 0026). O Cérebro só propõe: cada chamada que o modelo faz
 * vira uma mensagem `tool-call` ao processo principal, com o `id` do turno, e a resposta volta como `tool-result`, só
 * com o texto para o modelo. Quem confere a chamada (esquema, turno em andamento, Porteiro, registro) e quem lê o disco
 * ficam fora daqui: o principal e o Executor.
 *
 * - **Falha vira erro para o modelo.** O texto da falha (em pt-BR, sem o caminho) vai à API como resultado com
 *   `is_error`, e o modelo segue o turno com ele.
 * - **Parar** cancela as chamadas em andamento (`tool-cancel`); a resposta que chegar depois é ignorada.
 * - **Ritmo:** acima de `BRIDGE_MAX_CALLS` chamadas numa janela de `BRIDGE_WINDOW_MS`, a chamada é recusada aqui mesmo.
 *   O principal derruba o Cérebro acima de 32 na mesma janela; o modelo pedindo leituras demais recebe um texto.
 * - **Tempo:** sem resposta em `BRIDGE_TIMEOUT_MS` (o principal sempre responde, mas o registro pode travar), a
 *   chamada é cancelada e o modelo recebe um texto.
 */

export interface ToolOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/**
 * Falha de uma ferramenta para o modelo. O AI SDK manda à API o `toString()` do erro, que por padrão começa com o nome
 * ("Error: …"); este manda só o texto em pt-BR.
 */
export class ToolFailure extends Error {
  override readonly name = 'ToolFailure';

  override toString(): string {
    return this.message;
  }
}

export const BRIDGE_MAX_CALLS = 24;
export const BRIDGE_WINDOW_MS = 5_000;
/** Mais que os 30 s de uma leitura no Executor, com os 5 s para ele responder ao cancelamento. */
export const BRIDGE_TIMEOUT_MS = 60_000;

export const BRIDGE_BUSY: ToolOutcome = { ok: false, text: 'Leituras demais em pouco tempo. Espere as anteriores antes de pedir mais.' };
export const BRIDGE_TIMED_OUT: ToolOutcome = { ok: false, text: 'A leitura não respondeu a tempo e foi interrompida.' };

export interface ToolBridgeOptions {
  /** Manda uma mensagem ao processo principal. */
  readonly post: (message: unknown) => void;
  readonly maxCalls?: number;
  readonly windowMs?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

interface PendingCall {
  readonly resolve: (outcome: ToolOutcome) => void;
  readonly cleanup: () => void;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('A leitura foi cancelada.', 'AbortError');
}

export class ToolBridge {
  readonly #post: (message: unknown) => void;
  readonly #maxCalls: number;
  readonly #windowMs: number;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  readonly #pending = new Map<number, PendingCall>();
  readonly #recent: number[] = [];
  #nextId = 1;

  constructor(options: ToolBridgeOptions) {
    this.#post = options.post;
    this.#maxCalls = options.maxCalls ?? BRIDGE_MAX_CALLS;
    this.#windowMs = options.windowMs ?? BRIDGE_WINDOW_MS;
    this.#timeoutMs = options.timeoutMs ?? BRIDGE_TIMEOUT_MS;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Chamadas sem resposta ainda. */
  get pending(): number {
    return this.#pending.size;
  }

  /** `true` se mais uma chamada passaria do ritmo (a chamada aceita entra na conta). */
  #overRate(): boolean {
    const now = this.#now();
    while (this.#recent.length > 0 && now - (this.#recent[0] ?? now) >= this.#windowMs) this.#recent.shift();
    if (this.#recent.length >= this.#maxCalls) return true;
    this.#recent.push(now);
    return false;
  }

  /**
   * Pede uma chamada ao principal, dentro do turno `turn`. Resolve com o texto para o modelo (nunca com a resposta
   * crua); rejeita só se o sinal abortar (o turno parou) ou se a mensagem não puder sair.
   */
  call(turn: number, name: ToolName, input: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<ToolOutcome> {
    if (signal?.aborted === true) return Promise.reject(abortReason(signal));
    if (this.#overRate()) return Promise.resolve(BRIDGE_BUSY);
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<ToolOutcome>((resolve, reject) => {
      const onAbort = () => {
        if (!this.#finish(id)) return;
        this.#cancel(id);
        reject(signal === undefined ? new DOMException('A leitura foi cancelada.', 'AbortError') : abortReason(signal));
      };
      const timer = setTimeout(() => {
        if (!this.#finish(id)) return;
        this.#cancel(id);
        resolve(BRIDGE_TIMED_OUT);
      }, this.#timeoutMs);
      timer.unref?.();
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.#pending.set(id, { resolve, cleanup });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.#post({ type: 'tool-call', id, turn, name, input });
      } catch (error) {
        this.#finish(id);
        reject(error);
      }
    });
  }

  /** A resposta do principal. Sem chamada em aberto com o `id` (cancelada, ou o tempo acabou), é ignorada. */
  handle(message: BrainToolResult): void {
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    this.#finish(message.id);
    pending.resolve({ ok: message.ok, text: message.text });
  }

  /** O principal sumiu (ou o Cérebro vai sair): toda chamada em aberto falha com `text`. */
  failAll(text: string): void {
    for (const [id, pending] of [...this.#pending]) {
      this.#finish(id);
      pending.resolve({ ok: false, text });
    }
  }

  #finish(id: number): boolean {
    const pending = this.#pending.get(id);
    if (pending === undefined) return false;
    this.#pending.delete(id);
    pending.cleanup();
    return true;
  }

  #cancel(id: number): void {
    try {
      this.#post({ type: 'tool-cancel', id });
    } catch {
      // O principal sumiu: a chamada já não existe do lado dele.
    }
  }
}

export interface ReadToolsContext {
  readonly bridge: ToolBridge;
  /** O `id` do turno na ponte. */
  readonly turn: number;
  readonly budget: TurnBudget;
  /** Tokens estimados de um texto (para o orçamento do turno). */
  readonly estimate: (text: string) => number;
}

/** Recusa do orçamento do turno, em texto para o modelo. */
export const BUDGET_REFUSALS = {
  calls: 'Este turno já fez leituras demais. Responda ao dono com o que já leu.',
  context: 'Não cabe mais nenhuma leitura nesta conversa. Responda ao dono com o que já leu; se faltar algo, sugira começar uma conversa nova.',
} as const;

/**
 * As três ferramentas do catálogo para o `streamText` de um turno: a descrição e o esquema estrito vêm de
 * `@jesus/executor/catalog` (os mesmos que o principal e o Executor conferem), e cada chamada passa pelo orçamento do
 * turno antes de ir ao principal.
 */
export function readTools(context: ReadToolsContext) {
  const run = async (name: ToolName, input: ToolInput<ToolName>, signal: AbortSignal | undefined): Promise<string> => {
    const refusal = context.budget.reserve();
    if (refusal !== null) {
      const text = BUDGET_REFUSALS[refusal];
      context.budget.addResult(context.estimate(text));
      throw new ToolFailure(text);
    }
    let outcome: ToolOutcome;
    try {
      outcome = await context.bridge.call(context.turn, name, input, signal);
    } catch (error) {
      context.budget.settle(0);
      throw error;
    }
    context.budget.settle(context.estimate(outcome.text));
    if (!outcome.ok) throw new ToolFailure(outcome.text);
    return outcome.text;
  };
  return {
    file_read: tool({
      description: TOOL_DESCRIPTIONS.file_read,
      inputSchema: TOOL_INPUTS.file_read,
      execute: (input, options) => run('file_read', input, options.abortSignal),
    }),
    file_list: tool({
      description: TOOL_DESCRIPTIONS.file_list,
      inputSchema: TOOL_INPUTS.file_list,
      execute: (input, options) => run('file_list', input, options.abortSignal),
    }),
    file_search: tool({
      description: TOOL_DESCRIPTIONS.file_search,
      inputSchema: TOOL_INPUTS.file_search,
      execute: (input, options) => run('file_search', input, options.abortSignal),
    }),
  };
}
