import { createReadPolicy, hostPlatform } from '@jesus/gate';
import { failureCode, runTool } from '@jesus/executor';
import type { ToolOutcome } from '@jesus/executor';
import { parseToExecutor } from '../bridge/executor-protocol';
import type { ToolDoneMessage, ToolFailedMessage } from '../bridge/executor-protocol';
import type { ParentPortLike } from '../bridge/ports';

/**
 * Lado do Executor na ponte com o processo principal (roda no utilityProcess `jesus-executor`; decisão 0026). Cada
 * `tool-run` vira uma chamada de `runTool`, com a política que veio junto (as pastas liberadas e os lugares do
 * sistema) e a plataforma deste processo (nunca a da mensagem). Nada fica guardado entre as chamadas.
 */

export type ExecutorLog = (message: string) => void;

/** Chamadas ao mesmo tempo (o Cérebro pode pedir algumas de uma vez; mais que isso é laço). */
export const MAX_CONCURRENT_TOOLS = 4;

function writeToStderr(message: string): void {
  process.stderr.write(`[jesus-executor] ${message}\n`);
}

/** Os segredos mascarados, contados por tipo (a lista pode ter milhares de itens). */
function countSecrets(secrets: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const kind of secrets) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

export function replyFor(id: number, outcome: ToolOutcome): ToolDoneMessage | ToolFailedMessage {
  return outcome.ok
    ? { type: 'tool-done', id, text: outcome.text, secrets: countSecrets(outcome.secrets), stats: outcome.stats }
    : { type: 'tool-failed', id, text: outcome.text, code: failureCode(outcome.failure) };
}

export interface ExecutorHostOptions {
  readonly log?: ExecutorLog;
  readonly now?: () => number;
  readonly run?: typeof runTool;
  readonly platform?: NodeJS.Platform;
}

export function runExecutorHost(parent: ParentPortLike, options: ExecutorHostOptions = {}): void {
  const log = options.log ?? writeToStderr;
  const now = options.now ?? (() => performance.now());
  const run = options.run ?? runTool;
  const platform = hostPlatform(options.platform ?? process.platform);
  const started = now();
  const running = new Map<number, AbortController>();

  const fail = (id: number, code: string, text: string) => parent.postMessage({ type: 'tool-failed', id, code, text });

  parent.on('message', (event) => {
    // O Executor não recebe ports: um port que venha junto é fechado.
    for (const port of event.ports) port.close();
    const message = parseToExecutor(event.data);
    if (message === null) {
      log('mensagem inválida do processo principal recusada');
      return;
    }
    if (message.type === 'ping') {
      parent.postMessage({ type: 'pong', seq: message.seq });
      return;
    }
    if (message.type === 'tool-cancel') {
      running.get(message.id)?.abort();
      return;
    }
    const { id } = message;
    if (running.has(id) || running.size >= MAX_CONCURRENT_TOOLS) {
      fail(id, 'busy', 'O Jesus já está lendo outras coisas; tente de novo daqui a pouco.');
      return;
    }
    let policy: ReturnType<typeof createReadPolicy>;
    try {
      policy = createReadPolicy({ ...message.policy, platform });
    } catch {
      log('política de leitura inválida recusada');
      fail(id, 'policy', 'Erro interno do Jesus ao montar as regras de leitura.');
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    void run(message.name, message.input, { policy, signal: controller.signal })
      .then((outcome) => parent.postMessage(replyFor(id, outcome)))
      // `runTool` não lança; se lançar, é erro de programação, e a chamada falha sem detalhe.
      .catch(() => fail(id, 'io', 'Erro ao ler do disco.'))
      .finally(() => running.delete(id));
  });

  parent.postMessage({ type: 'ready', prepareMs: Math.round(now() - started) });
}
