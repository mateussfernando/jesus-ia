import type { ReadPolicy } from '@jesus/gate';
import { isToolName, TOOL_INPUTS } from './catalog';
import type { ToolInput, ToolName } from './catalog';
import { cancelled } from './context';
import type { ExecutorContext } from './context';
import { describeFailure } from './describe';
import { nodeFs } from './fs';
import type { ExecutorFs } from './fs';
import { DEFAULT_LIMITS } from './limits';
import type { ExecutorLimits } from './limits';
import { listDirectory } from './list-dir';
import { fsProblem } from './open';
import type { ToolFailure, ToolOutcome, ToolResult } from './outcome';
import { readFile } from './read-file';
import { searchFiles } from './search';

/**
 * Executa uma chamada de ferramenta. A entrada vem do modelo e passa de novo pelo esquema estrito (quem chama já
 * conferiu, mas o Executor não confia em ninguém); a política vem do principal, a cada chamada. Nunca lança: erro vira
 * falha em texto, sem a mensagem do sistema (que leva o caminho).
 */

export interface RunOptions {
  readonly policy: ReadPolicy;
  readonly fs?: ExecutorFs;
  readonly limits?: Partial<ExecutorLimits>;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

type Runners = { readonly [N in ToolName]: (input: ToolInput<N>, context: ExecutorContext) => Promise<ToolResult> };

const RUNNERS: Runners = {
  file_read: readFile,
  file_list: listDirectory,
  file_search: searchFiles,
};

function run<N extends ToolName>(name: N, input: ToolInput<N>, context: ExecutorContext): Promise<ToolResult> {
  return RUNNERS[name](input, context);
}

function failed(tool: ToolName | null, failure: ToolFailure): ToolOutcome {
  return { ok: false, tool, text: describeFailure(failure), failure };
}

export async function runTool(name: string, input: unknown, options: RunOptions): Promise<ToolOutcome> {
  if (!isToolName(name)) return failed(null, { reason: 'input' });
  const parsed = TOOL_INPUTS[name].safeParse(input);
  if (!parsed.success) return failed(name, { reason: 'input' });
  const context: ExecutorContext = {
    policy: options.policy,
    fs: options.fs ?? nodeFs,
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    signal: options.signal,
    now: options.now ?? (() => performance.now()),
  };
  if (cancelled(context)) return failed(name, { reason: 'cancelled' });
  let result: ToolResult;
  try {
    result = await run(name, parsed.data, context);
  } catch (error) {
    return failed(name, cancelled(context) ? { reason: 'cancelled' } : { reason: fsProblem(error) });
  }
  return result.ok ? { ok: true, tool: name, text: result.text, secrets: result.secrets, stats: result.stats } : failed(name, result.failure);
}
