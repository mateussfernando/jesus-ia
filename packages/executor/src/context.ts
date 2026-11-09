import type { ReadPolicy } from '@jesus/gate';
import type { ExecutorFs } from './fs';
import type { ExecutorLimits } from './limits';

/** O que cada ferramenta recebe para executar: a política do momento (quem manda é o principal), o disco e os cortes. */
export interface ExecutorContext {
  readonly policy: ReadPolicy;
  readonly fs: ExecutorFs;
  readonly limits: ExecutorLimits;
  readonly signal: AbortSignal | undefined;
  /** Relógio em milissegundos, para o tempo da busca. */
  readonly now: () => number;
}

/** O turno foi parado. (Função, e não `signal.aborted` direto: o TypeScript estreitaria o valor entre dois `await`.) */
export function cancelled(context: ExecutorContext): boolean {
  return context.signal?.aborted === true;
}
