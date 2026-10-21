import { MAX_TURN_STREAM_CHARS } from '../bridge/chat-protocol';
import type { ChatEvent, FromBrainChatMessage, ToBrainChatMessage, UiChatRequest } from '../bridge/chat-protocol';

/**
 * A conversa no processo principal (fase 1, etapa 10; decisão 0024): só repassa. Cada pedido do servidor da interface
 * (`chat`) vira uma mensagem ao Cérebro com um `id` daqui, e o que o Cérebro manda de volta segue para quem pediu, se
 * ele ainda for o servidor atual. As duas pontes já conferiram as mensagens com Zod estrito; aqui fica o que depende do
 * estado:
 * - o Cérebro só responde a `id` que o principal mandou: um `id` inventado derruba o Cérebro (fuga do protocolo);
 *   resposta atrasada de um pedido que já terminou (corrida com o Parar) é ignorada;
 * - um turno não passa de `MAX_TURN_STREAM_CHARS` de texto (a saída máxima dá bem menos);
 * - Cérebro que cai encerra os pedidos com `brain`; servidor da interface que cai para os turnos que ele pediu.
 */

type PendingKind = 'get' | 'reset' | 'send';

interface Pending {
  readonly kind: PendingKind;
  /** O servidor da interface que pediu (o registro do processo atual) e o `id` do lado dele. */
  readonly owner: object;
  readonly uiId: number;
  readonly reply: (event: ChatEvent) => void;
  streamed: number;
}

export interface ChatRelayOptions {
  /** Manda ao Cérebro pronto; `false` se não há. */
  readonly postToBrain: (message: ToBrainChatMessage) => boolean;
}

export interface ChatRelay {
  /** Pedido do servidor da interface. `reply` leva a resposta ao mesmo servidor (e não faz nada se ele saiu). */
  fromUi(request: UiChatRequest, owner: object, reply: (event: ChatEvent) => void): void;
  /** Mensagem de conversa do Cérebro. `violation` derruba o Cérebro por fuga do protocolo. */
  fromBrain(message: FromBrainChatMessage, violation: (reason: string) => void): void;
  /** O Cérebro saiu: os pedidos com ele terminam com `brain`. */
  brainGone(): void;
  /** Um servidor da interface saiu: os turnos que ele pediu param (ninguém mais vai ler). */
  uiGone(owner: object): void;
  readonly pending: number;
}

export function createChatRelay(options: ChatRelayOptions): ChatRelay {
  const pending = new Map<number, Pending>();
  let lastId = 0;

  const start = (kind: PendingKind, owner: object, uiId: number, reply: (event: ChatEvent) => void, message: (id: number) => ToBrainChatMessage) => {
    lastId += 1;
    const id = lastId;
    pending.set(id, { kind, owner, uiId, reply, streamed: 0 });
    let sent: boolean;
    try {
      sent = options.postToBrain(message(id));
    } catch {
      sent = false;
    }
    if (!sent) {
      pending.delete(id);
      reply({ kind: 'error', reason: 'brain' });
    }
  };

  const finish = (id: number, event: ChatEvent) => {
    const entry = pending.get(id);
    if (entry === undefined) return;
    pending.delete(id);
    entry.reply(event);
  };

  return {
    fromUi(request, owner, reply) {
      switch (request.op) {
        case 'get':
          start('get', owner, request.id, reply, (id) => ({ type: 'chat-get', id }));
          return;
        case 'reset':
          start('reset', owner, request.id, reply, (id) => ({ type: 'chat-reset', id }));
          return;
        case 'send':
          // O esquema da ponte garante os dois campos no `send`.
          if (request.conversationId === undefined || request.text === undefined) {
            reply({ kind: 'error', reason: 'empty' });
            return;
          }
          start('send', owner, request.id, reply, (id) => ({
            type: 'chat-send',
            id,
            conversationId: request.conversationId ?? '',
            text: request.text ?? '',
          }));
          return;
        case 'stop':
          for (const [id, entry] of pending) {
            if (entry.kind === 'send' && entry.owner === owner && entry.uiId === request.id) {
              try {
                options.postToBrain({ type: 'chat-stop', id });
              } catch {
                // O Cérebro saiu; o turno termina pela queda.
              }
            }
          }
          return;
      }
    },
    fromBrain(message, violation) {
      if (message.id > lastId) {
        violation('resposta de conversa a um pedido que o principal não fez');
        return;
      }
      const entry = pending.get(message.id);
      // Resposta a um pedido que já terminou (o turno foi parado, o servidor da interface saiu): ignora.
      if (entry === undefined) return;
      switch (message.type) {
        case 'chat-state':
          if (entry.kind === 'send') {
            violation('estado da conversa como resposta a uma pergunta');
            return;
          }
          finish(message.id, { kind: 'state', state: message.state });
          return;
        case 'chat-delta':
          if (entry.kind !== 'send') {
            violation('resposta da conversa a um pedido que não é pergunta');
            return;
          }
          entry.streamed += message.text.length;
          if (entry.streamed > MAX_TURN_STREAM_CHARS) {
            finish(message.id, { kind: 'error', reason: 'brain' });
            violation('resposta da conversa grande demais');
            return;
          }
          entry.reply({ kind: 'delta', text: message.text });
          return;
        case 'chat-done':
          if (entry.kind !== 'send') {
            violation('fim de turno a um pedido que não é pergunta');
            return;
          }
          finish(message.id, { kind: 'done', done: message.done });
          return;
        case 'chat-error':
          finish(message.id, { kind: 'error', reason: message.reason });
          return;
      }
    },
    brainGone() {
      for (const id of [...pending.keys()]) finish(id, { kind: 'error', reason: 'brain' });
    },
    uiGone(owner) {
      for (const [id, entry] of [...pending]) {
        if (entry.owner !== owner) continue;
        pending.delete(id);
        if (entry.kind !== 'send') continue;
        try {
          options.postToBrain({ type: 'chat-stop', id });
        } catch {
          // O Cérebro também saiu.
        }
      }
    },
    get pending() {
      return pending.size;
    },
  };
}
