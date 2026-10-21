import { describe, expect, it } from 'vitest';
import { createEntryGuard } from './entry-guard';
import type { GuardedWindow } from './entry-guard';

const ENTRY = 'https://jesus.invalid/entrar/';
const HOME = 'https://jesus.invalid/';

function setup() {
  const timers: { run: () => void; ms: number }[] = [];
  const stuck: string[] = [];
  const guard = createEntryGuard({
    entryUrl: ENTRY,
    onRetry: (url) => stuck.push(url),
    setTimer: (run, ms) => timers.push({ run, ms }),
  });
  const loads: string[] = [];
  let url = HOME;
  let destroyed = false;
  const win: GuardedWindow = {
    isDestroyed: () => destroyed,
    url: () => url,
    load: (target) => loads.push(target),
  };
  const fire = () => {
    for (const timer of timers.splice(0)) timer.run();
  };
  return {
    guard,
    win,
    timers,
    stuck,
    loads,
    fire,
    at: (next: string) => {
      url = next;
    },
    destroy: () => {
      destroyed = true;
    },
  };
}

describe('guarda da entrada depois de um bloqueio', () => {
  it('a janela passou pela entrada: nada a fazer, mesmo que já tenha voltado ao início', () => {
    const s = setup();
    s.guard.afterLock(s.win);
    expect(s.timers.map((timer) => timer.ms)).toEqual([3_000]);
    s.guard.navigated(ENTRY);
    s.at(HOME);
    s.fire();
    expect(s.loads).toEqual([]);
    expect(s.guard.retries).toBe(0);
  });

  it('a navegação se perdeu e a janela ficou no início: vai direto para a entrada, com aviso', () => {
    const s = setup();
    // Uma entrada de antes do bloqueio não conta.
    s.guard.navigated(ENTRY);
    s.guard.afterLock(s.win);
    s.guard.navigated(HOME);
    s.fire();
    expect(s.loads).toEqual([ENTRY]);
    expect(s.stuck).toEqual([HOME]);
    expect(s.guard.retries).toBe(1);
  });

  it('já está na entrada, ou a janela fechou: nada a fazer', () => {
    const s = setup();
    s.at(`${ENTRY}?x=1`);
    s.guard.afterLock(s.win);
    s.fire();
    s.at(HOME);
    s.guard.afterLock(s.win);
    s.destroy();
    s.fire();
    expect(s.loads).toEqual([]);
    expect(s.stuck).toEqual([]);
  });

  it('endereço parecido com a entrada não conta como entrada', () => {
    const s = setup();
    s.guard.afterLock(s.win);
    s.guard.navigated(`${ENTRY}x`);
    s.at('https://jesus.invalid/entrarx/');
    s.fire();
    expect(s.loads).toEqual([ENTRY]);
  });
});
