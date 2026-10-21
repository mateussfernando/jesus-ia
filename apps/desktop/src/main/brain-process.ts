import { parseFromBrain } from '../bridge/brain-protocol';
import type { FromBrainMessage } from '../bridge/brain-protocol';
import type { FromBrainChatMessage } from '../bridge/chat-protocol';
import type { BrainToolCall } from '../bridge/tool-protocol';
import type { UtilityChildLike } from '../bridge/ports';
import type { Egress } from './egress/egress';
import { startSupervisor } from './supervisor';
import type { Supervisor, SupervisorEvent, SupervisorTiming } from './supervisor';

/**
 * Lado do processo principal na ponte com o Cérebro (`jesus-brain`; decisão 0023): o supervisor sobe e vigia o
 * processo, e cada `api-request` vai para a saída (`egress`), que confere, põe a chave e responde pelas mensagens
 * `api-*` com o mesmo `id`. Pedido com `id` repetido é fuga do protocolo e derruba o Cérebro. Se o Cérebro sair, o que
 * estava em andamento com ele é cancelado.
 *
 * Ritmo: cada pedido custa ao principal a conferência de até 2 MB de JSON. Um Cérebro de verdade espera cada resposta
 * do modelo (segundos) e nunca manda pedido fora da lista; pedidos demais em pouco tempo, ou recusas pela lista em
 * série, são laço ou ataque, e derrubam o Cérebro como fuga do protocolo (o supervisor desiste depois de quedas
 * seguidas).
 */

type WorkMessage = Extract<
  FromBrainMessage,
  { readonly type: 'api-request' | 'api-cancel' | 'chat-state' | 'chat-delta' | 'chat-done' | 'chat-error' | 'tool-call' | 'tool-cancel' }
>;

export interface BrainRateLimits {
  /** Pedidos aceitos numa janela de `windowMs`. */
  readonly maxRequests: number;
  readonly windowMs: number;
  /** Pedidos recusados pela lista (fora do que o Jesus manda) aceitos numa janela de `refusalWindowMs`. */
  readonly maxRefusals: number;
  readonly refusalWindowMs: number;
  /** Chamadas de ferramenta aceitas numa janela de `windowMs` (um turno tem até 8 passos, com algumas cada). */
  readonly maxToolCalls: number;
}

export const DEFAULT_BRAIN_RATE: BrainRateLimits = { maxRequests: 10, windowMs: 5_000, maxRefusals: 3, refusalWindowMs: 60_000, maxToolCalls: 32 };

/** Uma chamada de ferramenta do Cérebro (decisão 0026): quem atende responde uma vez e devolve como cancelar. */
export type ToolHandler = (
  call: BrainToolCall,
  reply: (result: { readonly ok: boolean; readonly text: string }) => void,
  violation: (reason: string) => void,
) => () => void;

/** Conta eventos numa janela deslizante; `true` se este passou do limite. */
function windowCounter(max: number, windowMs: number, now: () => number): () => boolean {
  const times: number[] = [];
  return () => {
    const at = now();
    while (times.length > 0 && at - (times[0] ?? at) >= windowMs) times.shift();
    times.push(at);
    return times.length > max;
  };
}

export interface BrainProcessOptions {
  /** Sobe o utilityProcess (no app: `utilityProcess.fork` com ambiente de lista e `serviceName: 'jesus-brain'`). */
  readonly fork: () => UtilityChildLike;
  readonly egress: Pick<Egress, 'send' | 'cancelAll'>;
  /** Mensagem de conversa do Cérebro (decisão 0024); `violation` o derruba por fuga do protocolo. */
  readonly onChat?: (message: FromBrainChatMessage, violation: (reason: string) => void) => void;
  /** Chamada de ferramenta do Cérebro; sem quem atenda, é fuga do protocolo. */
  readonly onTool?: ToolHandler;
  /** O Cérebro saiu (ou foi parado): a conversa em andamento com ele termina. */
  readonly onGone?: () => void;
  readonly onEvent?: (event: SupervisorEvent) => void;
  readonly timing?: Partial<SupervisorTiming>;
  readonly rate?: Partial<BrainRateLimits>;
  readonly now?: () => number;
}

export function startBrainProcess(options: BrainProcessOptions): Supervisor {
  const rate: BrainRateLimits = { ...DEFAULT_BRAIN_RATE, ...options.rate };
  const now = options.now ?? (() => performance.now());
  // Pedidos em andamento do processo atual (id → cancelar) e o ritmo dele. Um processo novo começa do zero.
  let open = new Map<number, () => void>();
  // Chamadas de ferramenta em andamento do processo atual (id → cancelar).
  let tools = new Map<number, () => void>();
  const newCounters = () => ({
    request: windowCounter(rate.maxRequests, rate.windowMs, now),
    refusal: windowCounter(rate.maxRefusals, rate.refusalWindowMs, now),
    tool: windowCounter(rate.maxToolCalls, rate.windowMs, now),
  });
  let counters = newCounters();

  return startSupervisor<WorkMessage>({
    fork: options.fork,
    parse: parseFromBrain,
    onMessage: (message, link) => {
      if (message.type === 'chat-state' || message.type === 'chat-delta' || message.type === 'chat-done' || message.type === 'chat-error') {
        if (options.onChat === undefined) link.violation('conversa sem quem atenda');
        else options.onChat(message, (reason) => link.violation(reason));
        return;
      }
      if (message.type === 'tool-call') {
        if (options.onTool === undefined) {
          link.violation('ferramenta sem quem atenda');
          return;
        }
        if (tools.has(message.id)) {
          link.violation('chamada de ferramenta com id repetido');
          return;
        }
        if (counters.tool()) {
          link.violation('chamadas de ferramenta demais em pouco tempo');
          return;
        }
        const calls = tools;
        const { id } = message;
        let answered = false;
        const cancel = options.onTool(
          message,
          (result) => {
            if (answered) return;
            answered = true;
            calls.delete(id);
            link.post({ type: 'tool-result', id, ok: result.ok, text: result.text });
          },
          (reason) => link.violation(reason),
        );
        if (!answered) calls.set(id, cancel);
        return;
      }
      if (message.type === 'tool-cancel') {
        const cancel = tools.get(message.id);
        tools.delete(message.id);
        cancel?.();
        return;
      }
      if (message.type === 'api-cancel') {
        const cancel = open.get(message.id);
        open.delete(message.id);
        cancel?.();
        return;
      }
      if (open.has(message.id)) {
        link.violation('pedido à API com id repetido');
        return;
      }
      if (counters.request()) {
        link.violation('pedidos à API demais em pouco tempo');
        return;
      }
      const requests = open;
      const limits = counters;
      const { id } = message;
      let finished = false;
      const done = () => {
        finished = true;
        requests.delete(id);
      };
      const cancel = options.egress.send(message, {
        head: (status, headers) => link.post({ type: 'api-head', id, status, headers }),
        chunk: (chunk) => link.post({ type: 'api-chunk', id, chunk }),
        end: () => {
          done();
          link.post({ type: 'api-end', id });
        },
        fail: (reason) => {
          done();
          link.post({ type: 'api-error', id, reason });
          if (reason === 'refused' && limits.refusal()) link.violation('pedidos à API fora da lista em série');
        },
      });
      // Recusa na hora (fora da lista, sem chave, teto do dia): já terminou.
      if (!finished) requests.set(id, cancel);
    },
    onExit: () => {
      for (const cancel of tools.values()) cancel();
      tools = new Map();
      open = new Map();
      counters = newCounters();
      options.egress.cancelAll('brain_gone');
      options.onGone?.();
    },
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.timing === undefined ? {} : { timing: options.timing }),
    now,
  });
}
