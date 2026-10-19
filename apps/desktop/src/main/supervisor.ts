import type { UtilityChildLike } from '../bridge/ports';

/**
 * Supervisor de um utilityProcess do Jesus (hoje, o Cérebro; decisões 0017 e 0023): sobe o processo, espera o `ready`,
 * vigia a vida dele com `ping`/`pong` e, se ele cair, travar ou sair do protocolo, derruba e sobe de novo, com espera
 * crescente, até desistir depois de quedas seguidas demais. Mensagem fora do protocolo derruba o processo (falha
 * fechada): um processo filho que fala errado não é confiável.
 *
 * O mesmo desenho do servidor da interface (`ui-server.ts`), sem os pedidos da janela.
 */

export interface SupervisorTiming {
  /** Sem `ready` nesse tempo depois de subir, o processo é derrubado e conta como falha. */
  readonly readyTimeoutMs: number;
  /** Esperas antes de cada novo início, na ordem; a última se repete. */
  readonly restartDelaysMs: readonly number[];
  /** Um processo que viveu isso depois de pronto zera a contagem de quedas seguidas. */
  readonly stableAfterMs: number;
  /** Quedas seguidas antes de desistir. */
  readonly maxConsecutiveFailures: number;
  /** De quanto em quanto tempo o principal manda o sinal de vida (`ping`) ao processo pronto. */
  readonly pingIntervalMs: number;
  /** Sem `pong` nesse tempo, o processo está preso: é derrubado e sobe de novo. */
  readonly pingTimeoutMs: number;
}

export const DEFAULT_SUPERVISOR_TIMING: SupervisorTiming = {
  readyTimeoutMs: 30_000,
  restartDelaysMs: [250, 1_000, 3_000, 10_000],
  stableAfterMs: 60_000,
  maxConsecutiveFailures: 5,
  pingIntervalMs: 5_000,
  pingTimeoutMs: 15_000,
};

export type SupervisorFailure = 'fork-error' | 'failed-message' | 'ready-timeout' | 'invalid-message' | 'unresponsive' | 'protocol';

export type SupervisorEvent =
  | { readonly type: 'starting'; readonly attempt: number }
  | { readonly type: 'ready'; readonly attempt: number; readonly pid: number | undefined; readonly prepareMs: number }
  | { readonly type: 'failed'; readonly reason: SupervisorFailure; readonly message: string }
  | { readonly type: 'exited'; readonly code: number }
  | { readonly type: 'restarting'; readonly delayMs: number; readonly failures: number }
  | { readonly type: 'gave-up'; readonly failures: number };

/** Mensagens de vida, que o supervisor trata sozinho. */
export type LifeMessage =
  | { readonly type: 'ready'; readonly prepareMs: number }
  | { readonly type: 'failed'; readonly message: string }
  | { readonly type: 'pong'; readonly seq: number };

/** Ligação com o processo que mandou uma mensagem: só vale enquanto ele for o atual. */
export interface ChildLink {
  /** Manda ao processo; `false` se ele já não é o atual (saiu ou foi trocado). */
  post(message: unknown): boolean;
  /** Derruba o processo por fugir do protocolo; ele sobe de novo. */
  violation(message: string): void;
}

export interface SupervisorOptions<M extends { readonly type: string }> {
  /** Sobe o utilityProcess (no app: `utilityProcess.fork` com ambiente de lista e `serviceName`). */
  readonly fork: () => UtilityChildLike;
  /** Confere uma mensagem do processo (Zod estrito); `null` = fora do protocolo. */
  readonly parse: (data: unknown) => M | LifeMessage | null;
  /** Mensagem de trabalho de um processo pronto. */
  readonly onMessage: (message: M, link: ChildLink) => void;
  /** O processo atual saiu: o que estava em andamento com ele termina aqui. */
  readonly onExit?: () => void;
  /** Mensagem mandada logo depois de subir (configuração). */
  readonly config?: unknown;
  readonly onEvent?: (event: SupervisorEvent) => void;
  readonly timing?: Partial<SupervisorTiming>;
  readonly now?: () => number;
}

export interface Supervisor {
  /** Resolve quando o processo fica pronto pela primeira vez; rejeita se o supervisor desistir ou parar antes. */
  whenReady(): Promise<void>;
  /** Manda ao processo pronto; `false` se não há. */
  post(message: unknown): boolean;
  readonly pid: number | undefined;
  /** Derruba o processo atual (ele sobe de novo). */
  restart(): void;
  stop(): void;
}

/** Derruba o processo. No Electron, `kill()` antes do evento `spawn` não faz nada: aí a morte fica para quando ele subir. */
export function terminate(child: UtilityChildLike): void {
  if (child.kill()) return;
  child.on('spawn', () => child.kill());
}

function isLife(message: { readonly type: string }): message is LifeMessage {
  return message.type === 'ready' || message.type === 'failed' || message.type === 'pong';
}

interface ChildRecord {
  readonly child: UtilityChildLike;
  readonly attempt: number;
  readonly startedAt: number;
  ready: boolean;
}

export function startSupervisor<M extends { readonly type: string }>(options: SupervisorOptions<M>): Supervisor {
  const timing: SupervisorTiming = { ...DEFAULT_SUPERVISOR_TIMING, ...options.timing };
  const now = options.now ?? (() => performance.now());
  const emit = (event: SupervisorEvent) => options.onEvent?.(event);

  let current: ChildRecord | null = null;
  let attempts = 0;
  let failures = 0;
  let stopped = false;
  let restartTimer: NodeJS.Timeout | null = null;

  let resolveFirstReady: () => void = () => undefined;
  let rejectFirstReady: (error: Error) => void = () => undefined;
  const firstReady = new Promise<void>((resolve, reject) => {
    resolveFirstReady = resolve;
    rejectFirstReady = reject;
  });
  firstReady.catch(() => undefined);

  const afterFailure = (stable: boolean) => {
    failures = stable ? 1 : failures + 1;
    if (failures >= timing.maxConsecutiveFailures) {
      emit({ type: 'gave-up', failures });
      rejectFirstReady(new Error('o processo não conseguiu iniciar'));
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
    const record: ChildRecord = { child, attempt: attempts, startedAt: now(), ready: false };
    current = record;
    let down = false;
    const takeDown = (reason: SupervisorFailure, message: string) => {
      if (down || current !== record) return;
      down = true;
      emit({ type: 'failed', reason, message });
      terminate(child);
    };
    const link: ChildLink = {
      post(message) {
        if (current !== record || down) return false;
        try {
          child.postMessage(message);
          return true;
        } catch {
          return false;
        }
      },
      violation: (message) => takeDown('protocol', message),
    };

    const readyTimer = setTimeout(() => {
      if (!record.ready) takeDown('ready-timeout', 'o processo não ficou pronto a tempo');
    }, timing.readyTimeoutMs);

    let ping: { readonly seq: number; readonly sentAt: number } | null = null;
    let pingSeq = 0;
    const watchdog = setInterval(() => {
      if (current !== record) {
        clearInterval(watchdog);
        return;
      }
      if (!record.ready || down) return;
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
      if (now() - ping.sentAt >= timing.pingTimeoutMs) takeDown('unresponsive', 'o processo parou de responder');
    }, timing.pingIntervalMs);

    child.on('message', (data) => {
      if (current !== record || down) return;
      const message = options.parse(data);
      if (message === null) {
        takeDown('invalid-message', 'mensagem fora do protocolo');
        return;
      }
      if (isLife(message)) {
        if (message.type === 'failed') {
          takeDown('failed-message', message.message);
          return;
        }
        if (message.type === 'pong') {
          if (ping?.seq !== message.seq) {
            takeDown('invalid-message', 'sinal de vida fora de ordem');
            return;
          }
          ping = null;
          return;
        }
        if (record.ready) {
          takeDown('invalid-message', 'pronto duas vezes');
          return;
        }
        record.ready = true;
        clearTimeout(readyTimer);
        emit({ type: 'ready', attempt: record.attempt, pid: child.pid, prepareMs: message.prepareMs });
        resolveFirstReady();
        return;
      }
      // Trabalho antes do `ready` é fuga do protocolo.
      if (!record.ready) {
        takeDown('invalid-message', 'mensagem antes de ficar pronto');
        return;
      }
      try {
        options.onMessage(message, link);
      } catch (error) {
        // Um erro do principal ao atender não derruba o principal: o processo filho cai e sobe de novo, sem o que tinha.
        takeDown('protocol', `erro ao atender a mensagem: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
      }
    });

    child.on('exit', (code) => {
      clearTimeout(readyTimer);
      clearInterval(watchdog);
      emit({ type: 'exited', code });
      if (current !== record) return;
      current = null;
      options.onExit?.();
      if (stopped) return;
      afterFailure(record.ready && now() - record.startedAt >= timing.stableAfterMs);
    });

    if (options.config !== undefined) {
      try {
        child.postMessage(options.config);
      } catch {
        terminate(child);
      }
    }
  };

  spawn();

  return {
    whenReady: () => firstReady,
    post(message) {
      const record = current;
      if (record?.ready !== true) return false;
      try {
        record.child.postMessage(message);
        return true;
      } catch {
        return false;
      }
    },
    get pid() {
      return current?.child.pid;
    },
    restart() {
      const record = current;
      if (record !== null) terminate(record.child);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (restartTimer !== null) clearTimeout(restartTimer);
      rejectFirstReady(new Error('processo parado'));
      const record = current;
      current = null;
      if (record !== null) {
        options.onExit?.();
        terminate(record.child);
      }
    },
  };
}
