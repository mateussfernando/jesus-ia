import { describe, expect, it } from 'vitest';
import { hologramStates } from './model';
import type { HologramSnapshot } from './model';
import {
  alertFlash,
  BLOCKED_HOLD_MS,
  computeTargets,
  contextRatio,
  damp,
  filledTicks,
  GATE_POSITION,
  initialVisualState,
  isPulseAlive,
  PULSE_TRAVEL_MS,
  pulseDuration,
  pulseFrame,
  satelliteAngle,
  SPHERE_MAX_RADIUS,
  SPHERE_MIN_RADIUS,
  sphereRadius,
  spendLevel,
  stateProfile,
  stepVisual,
  syntheticSpeechLevel,
} from './visual';

const snapshot: HologramSnapshot = {
  state: 'idle',
  context: { usedTokens: 50_000, limitTokens: 200_000 },
  spend: { todayUsd: 1, limitUsd: 5 },
  satellites: [],
  pulses: [],
  taint: 'clean',
  subagents: 0,
  memoryCount: 0,
  deviceCode: null,
};

describe('política de cor (docs/08-holograma.md, seção 8.4)', () => {
  it('só "aguardando você" (âmbar) e "bloqueado" (vermelho) têm cor', () => {
    for (const state of hologramStates) {
      const { alert } = stateProfile(state);
      if (state === 'awaiting') expect(alert).toBe('amber');
      else if (state === 'blocked') expect(alert).toBe('red');
      else expect(alert).toBe('none');
    }
  });

  it('bloqueado pisca rápido; aguardando não pisca', () => {
    expect(stateProfile('blocked').alertFlashRate).toBeGreaterThan(1);
    expect(stateProfile('awaiting').alertFlashRate).toBe(0);
  });

  it('offline fica cinza e parado', () => {
    const offline = stateProfile('offline');
    expect(offline.gray).toBe(1);
    expect(offline.spin).toBe(0);
    expect(offline.coreSpin).toBe(0);
    expect(offline.ringSpin).toBe(0);
  });

  it('pensando gira o núcleo mais rápido que ocioso', () => {
    expect(stateProfile('thinking').coreSpin).toBeGreaterThan(stateProfile('idle').coreSpin * 4);
  });

  it('computeTargets liga o alerta só quando há cor', () => {
    expect(computeTargets({ ...snapshot, state: 'idle' }).alertMix).toBe(0);
    expect(computeTargets({ ...snapshot, state: 'awaiting' }).alertMix).toBe(1);
    expect(computeTargets({ ...snapshot, state: 'blocked' }).alertMix).toBe(1);
  });
});

describe('contexto → tamanho da esfera', () => {
  it('calcula a fração do contexto com limites', () => {
    expect(contextRatio({ usedTokens: 50, limitTokens: 200 })).toBe(0.25);
    expect(contextRatio({ usedTokens: 500, limitTokens: 200 })).toBe(1);
  });

  it('o raio cresce com o contexto e encosta no contorno em 100%', () => {
    expect(sphereRadius(0)).toBe(SPHERE_MIN_RADIUS);
    expect(sphereRadius(1)).toBeCloseTo(SPHERE_MAX_RADIUS);
    let previous = 0;
    for (let r = 0; r <= 1; r += 0.05) {
      const radius = sphereRadius(r);
      expect(radius).toBeGreaterThanOrEqual(previous);
      previous = radius;
    }
    expect(sphereRadius(2)).toBeCloseTo(SPHERE_MAX_RADIUS);
    expect(sphereRadius(Number.NaN)).toBe(SPHERE_MIN_RADIUS);
  });

  it('preenche as marcas do anel externo', () => {
    expect(filledTicks(0, 100)).toBe(0);
    expect(filledTicks(0.42, 100)).toBe(42);
    expect(filledTicks(0.999, 100)).toBe(99);
    expect(filledTicks(1, 100)).toBe(100);
    expect(filledTicks(1.5, 100)).toBe(100);
  });
});

describe('anel de gasto (docs/09-modelos.md, seção 9.4)', () => {
  it('alerta em 80% e para em 100%', () => {
    expect(spendLevel({ todayUsd: 3.99, limitUsd: 5 })).toBe('normal');
    expect(spendLevel({ todayUsd: 4, limitUsd: 5 })).toBe('warning');
    expect(spendLevel({ todayUsd: 5, limitUsd: 5 })).toBe('exceeded');
    expect(spendLevel({ todayUsd: 9, limitUsd: 5 })).toBe('exceeded');
  });
});

describe('suavização', () => {
  it('damp converge para o alvo', () => {
    let value = 0;
    for (let i = 0; i < 200; i++) value = damp(value, 1, 5, 1 / 60);
    expect(value).toBeCloseTo(1, 3);
  });

  it('damp não depende da taxa de quadros', () => {
    const oneStep = damp(0, 1, 4, 0.1);
    const twoSteps = damp(damp(0, 1, 4, 0.05), 1, 4, 0.05);
    expect(twoSteps).toBeCloseTo(oneStep, 10);
  });

  it('damp com dt zero ou negativo não muda o valor', () => {
    expect(damp(0.3, 1, 4, 0)).toBe(0.3);
    expect(damp(0.3, 1, 4, -1)).toBe(0.3);
  });

  it('stepVisual mantém a cor do alerta enquanto ele some', () => {
    const blocked = computeTargets({ ...snapshot, state: 'blocked' });
    const state = initialVisualState(blocked);
    expect(state.alertColor).toBe('red');
    const idle = computeTargets({ ...snapshot, state: 'idle' });
    stepVisual(state, idle, 0.05);
    expect(state.alertColor).toBe('red');
    expect(state.alertMix).toBeLessThan(1);
    expect(state.alertMix).toBeGreaterThan(0);
  });

  it('stepVisual limita saltos de tempo (aba voltando do segundo plano)', () => {
    const state = initialVisualState(computeTargets(snapshot));
    stepVisual(state, computeTargets({ ...snapshot, state: 'compacting' }), 30);
    expect(state.compaction).toBeLessThan(1);
  });

  it('alertFlash respeita "reduzir movimento"', () => {
    expect(alertFlash(3, 0.123, true)).toBe(1);
    expect(alertFlash(0, 0.123, false)).toBe(1);
    const values = [0, 0.05, 0.1, 0.15].map((t) => alertFlash(3, t, false));
    expect(Math.min(...values)).toBeLessThan(1);
    for (const v of values) expect(v).toBeGreaterThanOrEqual(0.1);
  });

  it('a fala sintética fica entre 0 e 1', () => {
    for (let t = 0; t < 20; t += 0.037) {
      const level = syntheticSpeechLevel(t);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});

describe('pulsos nos fios', () => {
  it('ação vai da esfera para o satélite', () => {
    const start = pulseFrame({ kind: 'action', startedAt: 0 }, 50);
    const end = pulseFrame({ kind: 'action', startedAt: 0 }, PULSE_TRAVEL_MS - 50);
    expect(start?.position).toBeLessThan(0.1);
    expect(end?.position).toBeGreaterThan(0.9);
  });

  it('dados voltam do satélite para a esfera', () => {
    const start = pulseFrame({ kind: 'data', startedAt: 0 }, 50);
    const end = pulseFrame({ kind: 'data', startedAt: 0 }, PULSE_TRAVEL_MS - 50);
    expect(start?.position).toBeGreaterThan(0.9);
    expect(end?.position).toBeLessThan(0.1);
  });

  it('ação barrada nunca passa do losango do Porteiro', () => {
    for (let t = 0; t <= pulseDuration('blocked'); t += 10) {
      const frame = pulseFrame({ kind: 'blocked', startedAt: 0 }, t);
      expect(frame).not.toBeNull();
      expect(frame?.position).toBeLessThanOrEqual(GATE_POSITION + 1e-9);
    }
    const held = pulseFrame({ kind: 'blocked', startedAt: 0 }, PULSE_TRAVEL_MS * GATE_POSITION + BLOCKED_HOLD_MS / 2);
    expect(held?.stoppedAtGate).toBe(true);
  });

  it('pulso fora do intervalo não aparece', () => {
    expect(pulseFrame({ kind: 'action', startedAt: 100 }, 50)).toBeNull();
    expect(pulseFrame({ kind: 'action', startedAt: 0 }, PULSE_TRAVEL_MS + 1)).toBeNull();
    expect(isPulseAlive({ kind: 'blocked', startedAt: 0 }, pulseDuration('blocked') + 1)).toBe(false);
    expect(isPulseAlive({ kind: 'blocked', startedAt: 0 }, pulseDuration('blocked') - 1)).toBe(true);
  });
});

describe('satélites', () => {
  it('distribui os satélites por igual na órbita', () => {
    const angles = [0, 1, 2, 3].map((i) => satelliteAngle(i, 4, 0, 0));
    expect((angles[1] ?? 0) - (angles[0] ?? 0)).toBeCloseTo(Math.PI / 2);
    expect(satelliteAngle(0, 0, 10, 1)).toBe(0);
  });
});
