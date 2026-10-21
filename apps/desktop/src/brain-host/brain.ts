import { getModelCard } from '@jesus/models';
import { BRAIN_MODEL_ID, parseToBrain } from '../bridge/brain-protocol';
import type { ChatFailure } from '../bridge/chat-protocol';
import type { ParentPortLike } from '../bridge/ports';
import { ApiFetchBridge } from './api-fetch';
import { ChatEngine } from './chat';
import type { ChatEngineOptions } from './chat';
import { createBrainModel } from './model';

/**
 * Lado do Cérebro na ponte com o processo principal (roda no utilityProcess `jesus-brain`; decisões 0023 e 0024).
 * Monta o modelo com o `fetch` da ponte, responde ao sinal de vida, entrega as respostas da API ao pedido certo e
 * atende a conversa (`chat-*`), que mora aqui, na memória.
 */

export type BrainLog = (message: string) => void;

export interface BrainContext {
  readonly model: ReturnType<typeof createBrainModel>;
  readonly api: ApiFetchBridge;
  readonly chat: ChatEngine;
}

function writeToStderr(message: string): void {
  process.stderr.write(`[jesus-brain] ${message}\n`);
}

export function runBrainHost(
  parent: ParentPortLike,
  log: BrainLog = writeToStderr,
  now: () => number = () => performance.now(),
  chatOptions: Partial<Omit<ChatEngineOptions, 'model' | 'card'>> = {},
): BrainContext {
  const started = now();
  const api = new ApiFetchBridge({ post: (message) => parent.postMessage(message) });
  const model = createBrainModel(api.fetch);
  const card = getModelCard(`anthropic:${BRAIN_MODEL_ID}`);
  if (card === null) throw new Error('o modelo do Cérebro não está no catálogo');
  const chat = new ChatEngine({ ...chatOptions, model, card });
  // Turnos em andamento (id do pedido do principal → parar).
  const turns = new Map<number, () => void>();

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
    if (message.type === 'chat-get') {
      parent.postMessage({ type: 'chat-state', id: message.id, state: chat.state() });
      return;
    }
    if (message.type === 'chat-reset') {
      turns.clear();
      parent.postMessage({ type: 'chat-state', id: message.id, state: chat.reset() });
      return;
    }
    if (message.type === 'chat-stop') {
      turns.get(message.id)?.();
      return;
    }
    if (message.type === 'chat-send') {
      const { id } = message;
      let finished = false;
      const finish = (reply: { type: 'chat-done'; done: unknown } | { type: 'chat-error'; reason: ChatFailure }) => {
        finished = true;
        turns.delete(id);
        parent.postMessage({ ...reply, id });
      };
      const stop = chat.send(message.conversationId, message.text, {
        delta: (text) => parent.postMessage({ type: 'chat-delta', id, text }),
        done: (done) => finish({ type: 'chat-done', done }),
        fail: (reason) => finish({ type: 'chat-error', reason }),
      });
      // Recusa na hora (conversa antiga, turno em andamento, pergunta vazia): já terminou.
      if (!finished) turns.set(id, stop);
      return;
    }
    if (!api.handle(message)) log(`mensagem fora de ordem na resposta da API (pedido ${String(message.id)})`);
  });

  parent.postMessage({ type: 'ready', prepareMs: Math.round(now() - started) });
  return { model, api, chat };
}
