import { hologramSnapshotSchema, MAX_SATELLITES } from '@jesus/hologram';
import { describe, expect, it } from 'vitest';
import { applyAction, initialSnapshot, prunePulses, satelliteCatalog, scenarioDuration, scenarios } from './scenarios';

describe('cenários da fase 0', () => {
  it('o snapshot inicial é válido', () => {
    expect(hologramSnapshotSchema.safeParse(initialSnapshot).success).toBe(true);
  });

  it.each(scenarios.map((s) => [s.id, s] as const))('%s: roda inteiro gerando só snapshots válidos', (_, scenario) => {
    let snapshot = initialSnapshot;
    let previousAt = -1;
    for (const step of scenario.steps) {
      expect(step.at).toBeGreaterThanOrEqual(previousAt);
      previousAt = step.at;
      for (const action of step.actions) {
        if (action.type === 'pulse') {
          // Todo pulso aponta para um satélite que existe naquele momento.
          expect(snapshot.satellites.some((s) => s.id === action.satelliteId)).toBe(true);
        }
        snapshot = applyAction(snapshot, action, step.at);
        const parsed = hologramSnapshotSchema.safeParse(snapshot);
        expect(parsed.success).toBe(true);
      }
    }
    expect(scenarioDuration(scenario)).toBeGreaterThan(0);
  });

  it('todo cenário termina sem alerta e com a tarefa limpa', () => {
    // O do disjuntor termina esperando você de propósito (quem trava é a compactação automática; ver autoCompaction.test.ts).
    for (const scenario of scenarios.filter((s) => s.id !== 'breaker')) {
      let snapshot = initialSnapshot;
      for (const step of scenario.steps) for (const action of step.actions) snapshot = applyAction(snapshot, action, step.at);
      expect(['idle', 'speaking']).toContain(snapshot.state);
      expect(snapshot.taint).toBe('clean');
    }
  });

  it('o cenário de ataque mostra o bloqueio no Porteiro', () => {
    const attack = scenarios.find((s) => s.id === 'attack');
    const actions = attack?.steps.flatMap((s) => s.actions) ?? [];
    expect(actions).toContainEqual({ type: 'pulse', satelliteId: 'google', kind: 'blocked' });
    expect(actions).toContainEqual({ type: 'state', state: 'blocked' });
    expect(actions).toContainEqual({ type: 'taint', taint: 'tainted' });
  });
});

describe('applyAction', () => {
  it('não muta o snapshot original', () => {
    const before = JSON.stringify(initialSnapshot);
    applyAction(initialSnapshot, { type: 'state', state: 'thinking' }, 0);
    applyAction(initialSnapshot, { type: 'toggleAccess', satelliteId: 'google' }, 0);
    expect(JSON.stringify(initialSnapshot)).toBe(before);
  });

  it('limita contexto, subagentes e memórias', () => {
    let s = applyAction(initialSnapshot, { type: 'context', usedTokens: 10_000_000 }, 0);
    expect(s.context.usedTokens).toBe(s.context.limitTokens);
    s = applyAction(s, { type: 'context', usedTokens: -5 }, 0);
    expect(s.context.usedTokens).toBe(0);
    s = applyAction(s, { type: 'subagents', count: 50 }, 0);
    expect(s.subagents).toBe(4);
    s = applyAction(s, { type: 'memories', add: -100 }, 0);
    expect(s.memoryCount).toBe(0);
  });

  it('reduzir o limite de contexto também reduz o uso', () => {
    const s = applyAction(
      applyAction(initialSnapshot, { type: 'context', usedTokens: 190_000 }, 0),
      { type: 'contextLimit', limitTokens: 128_000 },
      0,
    );
    expect(s.context.usedTokens).toBe(128_000);
  });

  it('alterna o acesso de uma conta', () => {
    const s = applyAction(initialSnapshot, { type: 'toggleAccess', satelliteId: 'google' }, 0);
    expect(s.satellites.find((x) => x.id === 'google')?.access).toBe('read_write');
  });

  it('não duplica nem passa do limite de satélites', () => {
    let s = initialSnapshot;
    for (const satellite of satelliteCatalog) s = applyAction(s, { type: 'addSatellite', satellite }, 0);
    s = applyAction(s, { type: 'addSatellite', satellite: { id: 'extra', label: 'Extra', access: 'read' } }, 0);
    expect(s.satellites.length).toBeLessThanOrEqual(MAX_SATELLITES);
    expect(new Set(s.satellites.map((x) => x.id)).size).toBe(s.satellites.length);
  });

  it('ignora pulso para conta inexistente e remove pulsos ao desconectar', () => {
    let s = applyAction(initialSnapshot, { type: 'pulse', satelliteId: 'nao-existe', kind: 'action' }, 0);
    expect(s.pulses).toHaveLength(0);
    s = applyAction(s, { type: 'pulse', satelliteId: 'google', kind: 'action' }, 0);
    expect(s.pulses).toHaveLength(1);
    s = applyAction(s, { type: 'removeSatellite', satelliteId: 'google' }, 0);
    expect(s.pulses).toHaveLength(0);
  });

  it('prunePulses remove só os pulsos que terminaram', () => {
    let s = applyAction(initialSnapshot, { type: 'pulse', satelliteId: 'google', kind: 'action' }, 0);
    expect(prunePulses(s, 10)).toBe(s);
    s = prunePulses(s, 60_000);
    expect(s.pulses).toHaveLength(0);
  });
});
