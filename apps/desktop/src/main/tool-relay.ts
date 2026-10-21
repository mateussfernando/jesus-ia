import { checkRequestedPath, createReadPolicy, describeDenial, hostPlatform } from '@jesus/gate';
import type { PathPlatform } from '@jesus/gate';
import { describeFailure, failureCode, isToolName, TOOL_INPUTS } from '@jesus/executor';
import type { AuditEvent } from '@jesus/shared/audit';
import type { ToolPolicy } from '../bridge/executor-protocol';
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
