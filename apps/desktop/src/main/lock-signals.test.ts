import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityMessage, LockMessage } from '../bridge/protocol';
import { LockSignals } from './lock-signals';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(ready = true) {
  const sent: (LockMessage | ActivityMessage)[] = [];
  const unconfirmed: number[] = [];
  let clock = 0;
  const signals = new LockSignals({
    notify: (message) => {
      if (!ready) return false;
      sent.push(message);
      return true;
    },
    unconfirmed: (seq) => unconfirmed.push(seq),
    now: () => clock,
  });
  return { signals, sent, unconfirmed, advance: (ms: number) => (clock += ms) };
}

describe('sinais de bloqueio e de uso para o servidor da interface', () => {
  it('bloqueio confirmado no prazo: nada mais acontece', () => {
    const { signals, sent, unconfirmed } = setup();
    signals.lock('os_locked');
    expect(sent).toEqual([{ type: 'lock', reason: 'os_locked', seq: 1 }]);
    signals.ack(1);
    vi.advanceTimersByTime(5_000);
    expect(unconfirmed).toEqual([]);
    expect(signals.pending).toBe(0);
  });

  it('sem confirmação em 2 s, o servidor é derrubado', () => {
    const { signals, unconfirmed } = setup();
    signals.lock('suspend');
    vi.advanceTimersByTime(1_999);
    expect(unconfirmed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(unconfirmed).toEqual([1]);
  });

  it('cada bloqueio tem o seu número; confirmar um não confirma o outro', () => {
    const { signals, sent, unconfirmed } = setup();
    signals.lock('os_locked');
    signals.lock('suspend');
    expect(sent.map((message) => ('seq' in message ? message.seq : 0))).toEqual([1, 2]);
    signals.ack(2);
    signals.ack(99);
    vi.advanceTimersByTime(2_000);
    expect(unconfirmed).toEqual([1]);
  });

  it('sem servidor pronto, não há o que confirmar (o próximo começa bloqueado)', () => {
    const { signals, unconfirmed } = setup(false);
    signals.lock('os_locked');
    vi.advanceTimersByTime(5_000);
    expect(unconfirmed).toEqual([]);
  });

  it('servidor caiu: as confirmações pendentes são esquecidas', () => {
    const { signals, unconfirmed } = setup();
    signals.lock('os_locked');
    signals.reset();
    vi.advanceTimersByTime(5_000);
    expect(unconfirmed).toEqual([]);
  });

  it('uso de verdade: no máximo um aviso a cada 5 s', () => {
    const { signals, sent, advance } = setup();
    signals.activity();
    advance(1_000);
    signals.activity();
    advance(4_000);
    signals.activity();
    expect(sent).toEqual([{ type: 'activity' }, { type: 'activity' }]);
  });
});
