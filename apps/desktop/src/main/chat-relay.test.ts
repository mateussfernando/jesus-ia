import { describe, expect, it } from 'vitest';
import { parseToBrain } from '../bridge/brain-protocol';
import { MAX_CHAT_DELTA_CHARS, MAX_FOLDER_CHARS, MAX_TURN_FOLDERS, MAX_TURN_STREAM_CHARS } from '../bridge/chat-protocol';
import type { ChatEvent, ToBrainChatMessage, UiChatRequest } from '../bridge/chat-protocol';
import { createChatRelay } from './chat-relay';

const CONVERSATION = '0b6e3c1e-5f1a-4f7e-9c7a-2d9b1f4e6a80';
const state = { conversationId: CONVERSATION, turns: [], contextTokens: 1, limitTokens: 2, busy: false };

function setup(options: { brainUp?: boolean; folders?: () => readonly string[] } = {}) {
  const toBrain: ToBrainChatMessage[] = [];
  const relay = createChatRelay({
    postToBrain: (message) => {
      if (options.brainUp === false) return false;
      toBrain.push(message);
      return true;
    },
    ...(options.folders === undefined ? {} : { folders: options.folders }),
  });
  const violations: string[] = [];
  const violation = (reason: string) => violations.push(reason);
  const ui = (owner: object = {}) => {
    const events: [number, ChatEvent][] = [];
    const request = (id: number, op: UiChatRequest['op'], extra: Partial<UiChatRequest> = {}) =>
      relay.fromUi({ type: 'chat', id, op, ...extra } as UiChatRequest, owner, (event) => events.push([id, event]));
    return { owner, events, request };
  };
  return { relay, toBrain, violations, violation, ui };
}

describe('repassador da conversa no principal', () => {
  it('troca os ids: cada pedido da interface vira um do principal, e a resposta volta para quem pediu', () => {
    const { relay, toBrain, violation, ui } = setup();
    const a = ui();
    const b = ui();
    a.request(7, 'get');
    b.request(7, 'send', { conversationId: CONVERSATION, text: 'oi' });
    expect(toBrain).toEqual([
      { type: 'chat-get', id: 1 },
      { type: 'chat-send', id: 2, conversationId: CONVERSATION, text: 'oi', folders: [] },
    ]);
    relay.fromBrain({ type: 'chat-delta', id: 2, text: 'Olá' }, violation);
    relay.fromBrain({ type: 'chat-state', id: 1, state }, violation);
    relay.fromBrain({ type: 'chat-done', id: 2, done: { conversationId: CONVERSATION, finish: 'stop', contextTokens: 5, limitTokens: 9 } }, violation);
    expect(a.events).toEqual([[7, { kind: 'state', state }]]);
    expect(b.events.map(([, event]) => event.kind)).toEqual(['delta', 'done']);
    expect(relay.pending).toBe(0);
  });

  it('cada pergunta leva as pastas liberadas daquele momento, dentro do que o protocolo aceita', () => {
    let folders: readonly string[] = ['C:\\Users\\dono\\Projetos\\site'];
    const { toBrain, ui } = setup({ folders: () => folders });
    const a = ui();
    a.request(1, 'send', { conversationId: CONVERSATION, text: 'oi' });
    folders = ['', 'x'.repeat(MAX_FOLDER_CHARS + 1), ...Array.from({ length: MAX_TURN_FOLDERS + 5 }, (_, index) => `C:\\p${String(index)}`)];
    a.request(2, 'send', { conversationId: CONVERSATION, text: 'de novo' });
    const sends = toBrain.flatMap((message) => (message.type === 'chat-send' ? [message] : []));
    expect(sends[0]?.folders).toEqual(['C:\\Users\\dono\\Projetos\\site']);
    expect(sends[1]?.folders).toHaveLength(MAX_TURN_FOLDERS);
    expect(sends[1]?.folders[0]).toBe('C:\\p0');
    // Tudo o que vai ao Cérebro passa no esquema dele (senão o turno nem começaria).
    for (const message of sends) expect(parseToBrain(message)).not.toBeNull();
  });

  it('a situação do turno para as ferramentas: em andamento, terminado ou nunca pedido', () => {
    const { relay, violation, ui } = setup();
    const a = ui();
    a.request(1, 'get');
    a.request(2, 'send', { conversationId: CONVERSATION, text: 'oi' });
    expect(relay.turnState(1)).toBe('ended');
    expect(relay.turnState(2)).toBe('running');
    expect(relay.turnState(3)).toBe('unknown');
    expect(relay.turnState(0)).toBe('unknown');
    expect(relay.turnState(-1)).toBe('unknown');
    expect(relay.turnState(1.5)).toBe('unknown');
    relay.fromBrain({ type: 'chat-error', id: 2, reason: 'cancelled' }, violation);
    expect(relay.turnState(2)).toBe('ended');
    // O servidor da interface saiu: o turno dele deixa de estar em andamento na hora.
    a.request(3, 'send', { conversationId: CONVERSATION, text: 'outra' });
    expect(relay.turnState(3)).toBe('running');
    relay.uiGone(a.owner);
    expect(relay.turnState(3)).toBe('ended');
  });

  it('bloqueio do Windows: todo turno em andamento para no Cérebro; os outros pedidos, não', () => {
    const { relay, toBrain, ui } = setup();
    const a = ui();
    const b = ui();
    a.request(1, 'send', { conversationId: CONVERSATION, text: 'oi' });
    b.request(1, 'send', { conversationId: CONVERSATION, text: 'olá' });
    a.request(2, 'get');
    relay.stopAll();
    expect(toBrain.filter((message) => message.type === 'chat-stop')).toEqual([
      { type: 'chat-stop', id: 1 },
      { type: 'chat-stop', id: 2 },
    ]);
    // Cérebro fora do ar: parar não quebra o principal.
    const down = setup({ brainUp: false });
    down.relay.stopAll();
  });

  it('parar vai só para o turno daquele servidor e daquele id', () => {
    const { toBrain, ui } = setup();
    const a = ui();
    const b = ui();
    a.request(1, 'send', { conversationId: CONVERSATION, text: 'oi' });
    b.request(1, 'stop');
    a.request(2, 'stop');
    expect(toBrain.filter((message) => message.type === 'chat-stop')).toEqual([]);
    a.request(1, 'stop');
    expect(toBrain.at(-1)).toEqual({ type: 'chat-stop', id: 1 });
  });

  it('id que o principal nunca mandou derruba o Cérebro; resposta atrasada de um pedido que já terminou é ignorada', () => {
    const { relay, violations, violation, ui } = setup();
    const a = ui();
    a.request(1, 'send', { conversationId: CONVERSATION, text: 'oi' });
    relay.fromBrain({ type: 'chat-error', id: 1, reason: 'cancelled' }, violation);
    relay.fromBrain({ type: 'chat-delta', id: 1, text: 'atrasado' }, violation);
    expect(violations).toEqual([]);
    expect(a.events).toEqual([[1, { kind: 'error', reason: 'cancelled' }]]);
    relay.fromBrain({ type: 'chat-delta', id: 99, text: 'inventado' }, violation);
    expect(violations).toEqual(['resposta de conversa a um pedido que o principal não fez']);
  });

  it('resposta do tipo errado para o pedido derruba o Cérebro', () => {
    const { relay, violations, violation, ui } = setup();
    const a = ui();
    a.request(1, 'get');
    a.request(2, 'send', { conversationId: CONVERSATION, text: 'oi' });
    relay.fromBrain({ type: 'chat-delta', id: 1, text: 'x' }, violation);
    relay.fromBrain({ type: 'chat-state', id: 2, state }, violation);
    expect(violations).toHaveLength(2);
  });

  it('um turno não passa do limite de texto', () => {
    const { relay, violations, violation, ui } = setup();
    const a = ui();
    a.request(1, 'send', { conversationId: CONVERSATION, text: 'oi' });
    const piece = 'x'.repeat(MAX_CHAT_DELTA_CHARS);
    for (let sent = 0; sent <= MAX_TURN_STREAM_CHARS; sent += piece.length) relay.fromBrain({ type: 'chat-delta', id: 1, text: piece }, violation);
    expect(violations).toEqual(['resposta da conversa grande demais']);
    expect(a.events.at(-1)).toEqual([1, { kind: 'error', reason: 'brain' }]);
    expect(relay.pending).toBe(0);
  });

  it('Cérebro caído: tudo termina com brain; sem Cérebro pronto, o pedido falha na hora', () => {
    const { relay, ui } = setup();
    const a = ui();
    a.request(1, 'get');
    a.request(2, 'send', { conversationId: CONVERSATION, text: 'oi' });
    relay.brainGone();
    expect(a.events).toEqual([
      [1, { kind: 'error', reason: 'brain' }],
      [2, { kind: 'error', reason: 'brain' }],
    ]);
    const down = setup({ brainUp: false });
    const b = down.ui();
    b.request(3, 'reset');
    expect(b.events).toEqual([[3, { kind: 'error', reason: 'brain' }]]);
    expect(down.relay.pending).toBe(0);
  });

  it('servidor da interface caído: os turnos dele param, e nada mais vai para ele', () => {
    const { relay, toBrain, violation, ui } = setup();
    const a = ui();
    const b = ui();
    a.request(1, 'send', { conversationId: CONVERSATION, text: 'oi' });
    a.request(2, 'get');
    b.request(1, 'get');
    relay.uiGone(a.owner);
    expect(toBrain.at(-1)).toEqual({ type: 'chat-stop', id: 1 });
    relay.fromBrain({ type: 'chat-delta', id: 1, text: 'tarde' }, violation);
    relay.fromBrain({ type: 'chat-state', id: 3, state }, violation);
    expect(a.events).toEqual([]);
    expect(b.events).toEqual([[1, { kind: 'state', state }]]);
  });
});
