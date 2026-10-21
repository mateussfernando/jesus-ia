import { afterEach, describe, expect, it } from 'vitest';
import { desktopBridge } from './desktop-bridge';

const KEY = Symbol.for('jesus.desktop.bridge');
const noop = () => undefined;
const vault = { status: noop, setAnthropicKey: noop, clearAnthropicKey: noop };
const spend = { status: noop, setDailyLimit: noop };
const chat = { state: noop, reset: noop, send: noop, stop: noop };

function install(value: unknown) {
  Object.defineProperty(globalThis, KEY, { value, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, KEY);
});

describe('ponte do app de desktop vista pelo apps/ui', () => {
  it('sem ponte (next dev): nula', () => {
    expect(desktopBridge()).toBeNull();
  });

  it('com a forma certa, devolve a ponte', () => {
    const bridge = { idleMs: undefined, vault, spend, chat, onLock: noop, onActivity: noop };
    install(bridge);
    expect(desktopBridge()).toBe(bridge);
  });

  it('forma errada não vale: falta cofre, teto, conversa, método ou tempo sem uso fora da faixa', () => {
    for (const value of [
      { onLock: noop, onActivity: noop },
      { vault, spend, chat, onLock: noop },
      { vault: { status: noop }, spend, chat, onLock: noop, onActivity: noop },
      { vault, chat, onLock: noop, onActivity: noop },
      { vault, spend: { status: noop }, chat, onLock: noop, onActivity: noop },
      { vault, spend, onLock: noop, onActivity: noop },
      { vault, spend, chat: { state: noop, reset: noop, send: noop }, onLock: noop, onActivity: noop },
      { idleMs: 10, vault, spend, chat, onLock: noop, onActivity: noop },
      { idleMs: 1.5e3 + 0.5, vault, spend, chat, onLock: noop, onActivity: noop },
      'texto',
    ]) {
      install(value);
      expect(desktopBridge()).toBeNull();
    }
  });
});
