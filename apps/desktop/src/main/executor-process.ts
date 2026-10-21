import type { ToolName } from '@jesus/executor/catalog';
import { parseFromExecutor } from '../bridge/executor-protocol';
import type { FromExecutorMessage, ToolPolicy, ToolStats } from '../bridge/executor-protocol';
import type { UtilityChildLike } from '../bridge/ports';
import { startSupervisor } from './supervisor';
import type { Supervisor, SupervisorEvent, SupervisorTiming } from './supervisor';

/**
 * Lado do processo principal na ponte com o Executor (`jesus-executor`; decisão 0026). O supervisor sobe e vigia o
 * processo; cada chamada vira um `tool-run` com `id` próprio e espera o `tool-done` ou o `tool-failed`. Toda chamada
 * termina: com a resposta, com o cancelamento (turno parado, app bloqueado), com o tempo esgotado ou com a queda do
 * processo. Uma chamada que não volta nem depois do cancelamento prende o processo, que é derrubado e sobe de novo.
 */

type WorkMessage = Extract<FromExecutorMessage, { readonly type: 'tool-done' | 'tool-failed' }>;

export interface ToolRequest {
  readonly name: ToolName;
  readonly input: Record<string, unknown>;
  readonly policy: ToolPolicy;
}

export type ToolReply =
  | { readonly ok: true; readonly text: string; readonly secrets: Readonly<Record<string, number>>; readonly stats: ToolStats }
  | { readonly ok: false; readonly text: string; readonly code: string };

/** Falhas que o próprio principal dá (o Executor não respondeu). */
export const UNAVAILABLE: ToolReply = { ok: false, code: 'unavailable', text: 'O leitor de arquivos do Jesus não está disponível agora. Tente de novo.' };
export const TIMED_OUT: ToolReply = { ok: false, code: 'timeout', text: 'A leitura demorou demais e foi interrompida.' };
export const CANCELLED: ToolReply = { ok: false, code: 'cancelled', text: 'A leitura foi interrompida.' };

export interface ExecutorTiming {
  /** Tempo de uma chamada (a busca tem corte próprio de 10 s). */
  readonly callTimeoutMs: number;
  /** Depois do cancelamento, quanto o processo tem para responder antes de ser derrubado. */
  readonly cancelGraceMs: number;
}

export const DEFAULT_EXECUTOR_TIMING: ExecutorTiming = { callTimeoutMs: 30_000, cancelGraceMs: 5_000 };

export interface ExecutorProcessOptions {
  /** Sobe o utilityProcess (no app: `utilityProcess.fork` com ambiente de lista e `serviceName: 'jesus-executor'`). */
  readonly fork: () => UtilityChildLike;
  readonly onEvent?: (event: SupervisorEvent) => void;
  readonly timing?: Partial<SupervisorTiming>;
  readonly calls?: Partial<ExecutorTiming>;
  readonly now?: () => number;
}

export interface ExecutorProcess {
  /** Executa uma chamada; nunca rejeita. */
  run(request: ToolRequest, signal?: AbortSignal): Promise<ToolReply>;
  /** Cancela todas as chamadas em andamento (o app bloqueou). */
  cancelAll(): void;
  readonly supervisor: Supervisor;
}

interface Pending {
  /** Responde e para de esperar. */
  readonly finish: (reply: ToolReply) => void;
  /** Para de esperar antes da resposta: pede o cancelamento ao processo. */
  readonly abandon: (reply: ToolReply) => void;
}

export function startExecutorProcess(options: ExecutorProcessOptions): ExecutorProcess {
  const calls: ExecutorTiming = { ...DEFAULT_EXECUTOR_TIMING, ...options.calls };
  let nextId = 1;
  const pending = new Map<number, Pending>();
  // Chamadas que o principal deixou de esperar (cancelada, tempo esgotado): uma resposta tardia delas é normal.
  const abandoned = new Set<number>();

  const supervisor = startSupervisor<WorkMessage>({
    fork: options.fork,
    parse: parseFromExecutor,
    onMessage: (message, link) => {
      const entry = pending.get(message.id);
      if (entry === undefined) {
        if (!abandoned.delete(message.id)) link.violation('resposta de ferramenta sem chamada');
        return;
      }
      entry.finish(
        message.type === 'tool-done'
          ? { ok: true, text: message.text, secrets: message.secrets, stats: message.stats }
          : { ok: false, text: message.text, code: message.code },
      );
    },
    onExit: () => {
      abandoned.clear();
      for (const entry of [...pending.values()]) entry.finish(UNAVAILABLE);
    },
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.timing === undefined ? {} : { timing: options.timing }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  /** Depois do cancelamento, o mesmo processo tem um prazo para responder; senão, está preso e sobe de novo. */
  const watchStuck = (id: number) => {
    const pid = supervisor.pid;
    setTimeout(() => {
      if (abandoned.delete(id) && supervisor.pid === pid) supervisor.restart();
    }, calls.cancelGraceMs).unref();
  };

  const run = (request: ToolRequest, signal?: AbortSignal): Promise<ToolReply> =>
    new Promise((resolve) => {
      if (signal?.aborted === true) {
        resolve(CANCELLED);
        return;
      }
      const id = nextId++;
      let timer: NodeJS.Timeout | null = null;
      const onAbort = () => abandon(CANCELLED);
      const finish = (reply: ToolReply) => {
        if (!pending.delete(id)) return;
        if (timer !== null) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(reply);
      };
      const abandon = (reply: ToolReply) => {
        if (!pending.has(id)) return;
        supervisor.post({ type: 'tool-cancel', id });
        abandoned.add(id);
        watchStuck(id);
        finish(reply);
      };
      pending.set(id, { finish, abandon });
      if (!supervisor.post({ type: 'tool-run', id, name: request.name, input: request.input, policy: request.policy })) {
        finish(UNAVAILABLE);
        return;
      }
      timer = setTimeout(() => abandon(TIMED_OUT), calls.callTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  return {
    run,
    cancelAll() {
      for (const entry of [...pending.values()]) entry.abandon(CANCELLED);
    },
    supervisor,
  };
}
