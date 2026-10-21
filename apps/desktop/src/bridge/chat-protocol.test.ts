import { describe, expect, it } from 'vitest';
import { EGRESS_FAILURES, parseFromBrain, parseToBrain } from './brain-protocol';
import { CHAT_FAILURES, MAX_CHAT_DELTA_CHARS, MAX_CHAT_TEXT_CHARS, MAX_TRANSCRIPT_CHARS } from './chat-protocol';
import { parseFromServer, parseToServer } from './protocol';

const CONVERSATION = '0b6e3c1e-5f1a-4f7e-9c7a-2d9b1f4e6a80';
const state = { conversationId: CONVERSATION, turns: [{ user: 'oi', assistant: 'olá' }], contextTokens: 120, limitTokens: 88_500, busy: false };

describe('mensagens da conversa', () => {
  it('toda falha da saída para a API é também uma falha da conversa', () => {
    for (const failure of EGRESS_FAILURES) expect(CHAT_FAILURES).toContain(failure);
  });

  it('interface → principal: só o send leva conversa e texto, sempre os dois', () => {
    expect(parseFromServer({ type: 'chat', id: 1, op: 'get' })).not.toBeNull();
    expect(parseFromServer({ type: 'chat', id: 1, op: 'stop' })).not.toBeNull();
    expect(parseFromServer({ type: 'chat', id: 1, op: 'send', conversationId: CONVERSATION, text: 'oi' })).not.toBeNull();
    for (const bad of [
      { type: 'chat', id: 1, op: 'send', text: 'oi' },
      { type: 'chat', id: 1, op: 'send', conversationId: CONVERSATION },
      { type: 'chat', id: 1, op: 'send', conversationId: CONVERSATION, text: '' },
      { type: 'chat', id: 1, op: 'send', conversationId: CONVERSATION, text: 'x'.repeat(MAX_CHAT_TEXT_CHARS + 1) },
      { type: 'chat', id: 1, op: 'send', conversationId: 'não-é-uuid', text: 'oi' },
      { type: 'chat', id: 1, op: 'get', text: 'oi' },
      { type: 'chat', id: 1, op: 'reset', conversationId: CONVERSATION },
      { type: 'chat', id: 0, op: 'get' },
      { type: 'chat', id: 1, op: 'apagar' },
      { type: 'chat', id: 1, op: 'get', extra: true },
    ]) {
      expect(parseFromServer(bad), JSON.stringify(bad).slice(0, 80)).toBeNull();
    }
  });

  it('principal → interface: estado, pedaço, fim ou erro, nada mais', () => {
    const events = [
      { kind: 'state', state },
      { kind: 'delta', text: 'Olá' },
      { kind: 'done', done: { conversationId: CONVERSATION, finish: 'stop', contextTokens: 10, limitTokens: 20 } },
      { kind: 'error', reason: 'over_budget' },
    ];
    for (const event of events) expect(parseToServer({ type: 'chat-event', id: 3, event })).not.toBeNull();
    for (const event of [
      { kind: 'delta', text: '' },
      { kind: 'delta', text: 'x'.repeat(MAX_CHAT_DELTA_CHARS + 1) },
      { kind: 'error', reason: 'qualquer' },
      { kind: 'state', state: { ...state, extra: 1 } },
      { kind: 'state', state: { ...state, turns: [{ user: 'a'.repeat(MAX_CHAT_TEXT_CHARS + 1), assistant: '' }] } },
      { kind: 'done', done: { conversationId: CONVERSATION, finish: 'tool-calls', contextTokens: 1, limitTokens: 1 } },
    ]) {
      expect(parseToServer({ type: 'chat-event', id: 3, event }), JSON.stringify(event).slice(0, 80)).toBeNull();
    }
  });

  it('a conversa inteira numa mensagem tem teto de tamanho', () => {
    const turn = { user: 'u'.repeat(MAX_CHAT_TEXT_CHARS), assistant: 'a'.repeat(100_000) };
    const turns = Array.from({ length: Math.ceil(MAX_TRANSCRIPT_CHARS / 120_000) + 1 }, () => turn);
    expect(parseToServer({ type: 'chat-event', id: 1, event: { kind: 'state', state: { ...state, turns } } })).toBeNull();
  });

  it('principal ↔ Cérebro: as mensagens de conversa dos dois lados', () => {
    for (const message of [
      { type: 'chat-get', id: 1 },
      { type: 'chat-reset', id: 1 },
      { type: 'chat-send', id: 1, conversationId: CONVERSATION, text: 'oi' },
      { type: 'chat-stop', id: 1 },
    ]) {
      expect(parseToBrain(message)).not.toBeNull();
    }
    for (const message of [
      { type: 'chat-state', id: 1, state },
      { type: 'chat-delta', id: 1, text: 'pedaço' },
      { type: 'chat-done', id: 1, done: { conversationId: CONVERSATION, finish: 'length', contextTokens: 1, limitTokens: 2 } },
      { type: 'chat-error', id: 1, reason: 'cancelled' },
    ]) {
      expect(parseFromBrain(message)).not.toBeNull();
    }
    // Direção errada ou campo a mais: fora do protocolo.
    expect(parseFromBrain({ type: 'chat-send', id: 1, conversationId: CONVERSATION, text: 'oi' })).toBeNull();
    expect(parseToBrain({ type: 'chat-delta', id: 1, text: 'x' })).toBeNull();
    expect(parseFromBrain({ type: 'chat-error', id: 1, reason: 'cancelled', detail: 'x' })).toBeNull();
  });
});
