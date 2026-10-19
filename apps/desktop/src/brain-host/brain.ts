import { parseToBrain } from '../bridge/brain-protocol';
import type { ParentPortLike } from '../bridge/ports';
import { ApiFetchBridge } from './api-fetch';
import { createBrainModel } from './model';

/**
 * Lado do Cérebro na ponte com o processo principal (roda no utilityProcess `jesus-brain`; decisão 0023). Monta o
 * modelo com o `fetch` da ponte, responde ao sinal de vida e entrega as respostas da API ao pedido certo. O laço da
 * conversa (etapa 10) usa o modelo e a ponte daqui.
 */

export type BrainLog = (message: string) => void;

export interface BrainContext {
  readonly model: ReturnType<typeof createBrainModel>;
  readonly api: ApiFetchBridge;
}

function writeToStderr(message: string): void {
  process.stderr.write(`[jesus-brain] ${message}\n`);
}

export function runBrainHost(parent: ParentPortLike, log: BrainLog = writeToStderr, now: () => number = () => performance.now()): BrainContext {
  const started = now();
  const api = new ApiFetchBridge({ post: (message) => parent.postMessage(message) });
  const model = createBrainModel(api.fetch);

  parent.on('message', (event) => {
    // O Cérebro não recebe ports: um port que venha junto é fechado.
    for (const port of event.ports) port.close();
    const message = parseToBrain(event.data);
    if (message === null) {
      log('mensagem inválida do processo principal recusada');
      return;
    }
    if (message.type === 'ping') {
      parent.postMessage({ type: 'pong', seq: message.seq });
      return;
    }
    if (!api.handle(message)) log(`mensagem fora de ordem na resposta da API (pedido ${String(message.id)})`);
  });

  parent.postMessage({ type: 'ready', prepareMs: Math.round(now() - started) });
  return { model, api };
}
