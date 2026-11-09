import { checkRequestedPath, createReadPolicy, describeDenial, hostPlatform } from '@jesus/gate';
import type { PathPlatform } from '@jesus/gate';
import { describeFailure, failureCode, isToolName, summarizeTool, TOOL_INPUTS } from '@jesus/executor';
import type { ToolName, ToolSummary } from '@jesus/executor';
import type { AuditEvent } from '@jesus/shared/audit';
import type { ToolPolicy } from '../bridge/executor-protocol';
import type { ToolHandler } from './brain-process';
import { UNAVAILABLE } from './executor-process';
import type { ExecutorProcess, ToolReply } from './executor-process';

/**
 * Chamadas de ferramenta do Cérebro, no principal (decisão 0026). O Cérebro só propõe; daqui a chamada segue, nesta
 * ordem:
 * 1. o nome e a entrada passam pelo esquema estrito do catálogo;
 * 2. sem política (sem registro de auditoria saudável), nada roda;
 * 3. o caminho pedido passa pelo Porteiro aqui mesmo, só pelo texto: um caminho de rede, de fora ou sensível nem chega
 *    ao Executor (que confere tudo de novo, com o disco);
 * 4. o registro de auditoria grava a chamada antes de ela rodar (sem registro, não roda);
 * 5. o Executor executa, e o resultado vai para o registro (sem conteúdo: o resumo e os tipos de segredo mascarados).
 * O que volta para o Cérebro é só o texto para o modelo.
 */

export interface ToolRelayOptions {
  readonly executor: Pick<ExecutorProcess, 'run'>;
  /** A política do momento (pastas liberadas e lugares do sistema); `null` desliga as ferramentas. */
  readonly policy: () => ToolPolicy | null;
  readonly audit: (event: AuditEvent) => Promise<unknown>;
  readonly platform?: NodeJS.Platform;
}

export interface ToolRelay {
  /** Executa uma chamada do Cérebro; nunca rejeita. */
  call(name: string, input: unknown, signal?: AbortSignal): Promise<ToolReply>;
}

const OFF: ToolReply = {
  ok: false,
  code: 'unavailable',
  text: 'Ler arquivos está desligado agora: o registro de auditoria do Jesus não abriu. Feche e abra o Jesus de novo.',
};

export function createToolRelay(options: ToolRelayOptions): ToolRelay {
  const platform: PathPlatform = hostPlatform(options.platform ?? process.platform);
  return {
    async call(name, input, signal) {
      if (!isToolName(name)) return { ok: false, code: 'input', text: describeFailure({ reason: 'input' }) };
      const parsed = TOOL_INPUTS[name].safeParse(input);
      if (!parsed.success) return { ok: false, code: 'input', text: describeFailure({ reason: 'input' }) };
      const policy = options.policy();
      if (policy === null) return OFF;
      let gate: ReturnType<typeof createReadPolicy>;
      try {
        gate = createReadPolicy({ ...policy, platform });
      } catch {
        return OFF;
      }
      const requested = checkRequestedPath(parsed.data.path, gate);
      if (requested.decision === 'deny') {
        const code = failureCode({ reason: 'denied', denial: requested.denial });
        await options.audit({ type: 'tool.denied', tool: name, code }).catch(() => undefined);
        return { ok: false, code, text: describeDenial(requested.denial) };
      }
      try {
        await options.audit({
          type: 'tool.call',
          tool: name,
          path: requested.path.text,
          ...('query' in parsed.data ? { query: parsed.data.query } : {}),
          ...('offset' in parsed.data && parsed.data.offset !== undefined ? { offset: parsed.data.offset } : {}),
        });
      } catch {
        return OFF;
      }
      const reply = await options.executor.run({ name, input: parsed.data, policy }, signal);
      const result: AuditEvent = reply.ok
        ? { type: 'tool.result', tool: name, ok: true, stats: reply.stats, secrets: reply.secrets }
        : { type: 'tool.result', tool: name, ok: false, code: reply.code };
      await options.audit(result).catch(() => undefined);
      return reply;
    },
  };
}

/** A chamada chegou depois de o turno acabar (corrida com o Parar ou com a saída da tela): não roda. */
export const TURN_ENDED: ToolReply = { ok: false, code: 'cancelled', text: 'O turno acabou antes desta leitura, e ela não foi feita.' };

export interface BrainToolHandlerOptions {
  readonly relay: ToolRelay;
  /** A situação do turno da chamada no repassador da conversa (`ChatRelay.turnState`). */
  readonly turnState: (turn: number) => 'running' | 'ended' | 'unknown';
  /** A linha de atividade de uma chamada que vai rodar, com o resumo feito por código (para a tela da conversa). */
  readonly onActivity?: (turn: number, line: ToolSummary) => void;
}

/** O resumo de uma chamada com a entrada conferida pelo esquema do catálogo; `null` se a entrada não confere. */
export function summarizeCall(name: ToolName, input: unknown): ToolSummary | null {
  switch (name) {
    case 'file_read': {
      const parsed = TOOL_INPUTS.file_read.safeParse(input);
      return parsed.success ? summarizeTool('file_read', parsed.data) : null;
    }
    case 'file_list': {
      const parsed = TOOL_INPUTS.file_list.safeParse(input);
      return parsed.success ? summarizeTool('file_list', parsed.data) : null;
    }
    case 'file_search': {
      const parsed = TOOL_INPUTS.file_search.safeParse(input);
      return parsed.success ? summarizeTool('file_search', parsed.data) : null;
    }
  }
}

/**
 * Quem atende as chamadas de ferramenta do Cérebro (`onTool` de `startBrainProcess`). Só roda a chamada de um turno em
 * andamento; a de um turno que o principal nunca pediu é fuga do protocolo e derruba o Cérebro. O resto da conferência
 * (esquema, Porteiro, registro) fica em `ToolRelay.call`. Ao Cérebro volta só o texto para o modelo.
 */
export function createBrainToolHandler(options: BrainToolHandlerOptions): ToolHandler {
  return (call, reply, violation) => {
    const turn = options.turnState(call.turn);
    if (turn === 'unknown') {
      violation('chamada de ferramenta num turno que o principal não pediu');
      return () => undefined;
    }
    if (turn === 'ended') {
      reply({ ok: TURN_ENDED.ok, text: TURN_ENDED.text });
      return () => undefined;
    }
    // A linha de atividade sai antes da leitura, com a entrada já conferida; entrada que não confere nem aparece (o
    // repassador a recusa).
    const line = summarizeCall(call.name, call.input);
    if (line !== null) options.onActivity?.(call.turn, line);
    const controller = new AbortController();
    // `call` nunca rejeita; o segundo caminho só guarda o Cérebro de ficar sem resposta.
    options.relay.call(call.name, call.input, controller.signal).then(
      (result) => reply({ ok: result.ok, text: result.text }),
      () => reply({ ok: UNAVAILABLE.ok, text: UNAVAILABLE.text }),
    );
    return () => controller.abort();
  };
}
