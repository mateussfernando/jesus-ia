import { afterEach, describe, expect, it } from 'vitest';
import { desktopBridge } from './desktop-bridge';

const KEY = Symbol.for('jesus.desktop.bridge');
const noop = () => undefined;
const vault = { status: noop, setAnthropicKey: noop, clearAnthropicKey: noop };

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
    const bridge = { idleMs: undefined, vault, onLock: noop, onActivity: noop };
    install(bridge);
    expect(desktopBridge()).toBe(bridge);
  });

  it('forma errada não vale: falta cofre, método ou tempo sem uso fora da faixa', () => {
    for (const value of [
      { onLock: noop, onActivity: noop },
      { vault, onLock: noop },
      { vault: { status: noop }, onLock: noop, onActivity: noop },
      { idleMs: 10, vault, onLock: noop, onActivity: noop },
      { idleMs: 1.5e3 + 0.5, vault, onLock: noop, onActivity: noop },
      'texto',
    ]) {
      install(value);
      expect(desktopBridge()).toBeNull();
    }
  });
});
