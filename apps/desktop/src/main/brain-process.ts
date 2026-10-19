import { parseFromBrain } from '../bridge/brain-protocol';
import type { FromBrainMessage } from '../bridge/brain-protocol';
import type { UtilityChildLike } from '../bridge/ports';
import type { Egress } from './egress/egress';
import { startSupervisor } from './supervisor';
import type { Supervisor, SupervisorEvent, SupervisorTiming } from './supervisor';

/**
 * Lado do processo principal na ponte com o Cérebro (`jesus-brain`; decisão 0023): o supervisor sobe e vigia o
 * processo, e cada `api-request` vai para a saída (`egress`), que confere, põe a chave e responde pelas mensagens
 * `api-*` com o mesmo `id`. Pedido com `id` repetido é fuga do protocolo e derruba o Cérebro. Se o Cérebro sair, o que
 * estava em andamento com ele é cancelado.
 */

type WorkMessage = Extract<FromBrainMessage, { readonly type: 'api-request' | 'api-cancel' }>;

export interface BrainProcessOptions {
  /** Sobe o utilityProcess (no app: `utilityProcess.fork` com ambiente de lista e `serviceName: 'jesus-brain'`). */
  readonly fork: () => UtilityChildLike;
  readonly egress: Pick<Egress, 'send' | 'cancelAll'>;
  readonly onEvent?: (event: SupervisorEvent) => void;
  readonly timing?: Partial<SupervisorTiming>;
  readonly now?: () => number;
}

export function startBrainProcess(options: BrainProcessOptions): Supervisor {
  // Pedidos em andamento do processo atual (id → cancelar). Um processo novo começa com um mapa novo.
  let open = new Map<number, () => void>();

  return startSupervisor<WorkMessage>({
    fork: options.fork,
    parse: parseFromBrain,
    onMessage: (message, link) => {
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
      const requests = open;
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
        },
      });
      // Recusa na hora (fora da lista, sem chave, teto do dia): já terminou.
      if (!finished) requests.set(id, cancel);
    },
    onExit: () => {
      open = new Map();
      options.egress.cancelAll('brain_gone');
    },
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.timing === undefined ? {} : { timing: options.timing }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
