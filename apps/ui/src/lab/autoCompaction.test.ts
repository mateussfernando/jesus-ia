import { hologramSnapshotSchema } from '@jesus/hologram';
import { describe, expect, it } from 'vitest';
import { finishCompaction, initialEngine, replayScenario, runEngine, switchModel } from './autoCompaction';
import { DEFAULT_MODEL, labBudget, labModels, withAutoLimit } from './autoContext';
import type { LabModelKey } from './autoContext';
import { applyAction, initialSnapshot, scenarios } from './scenarios';
import type { Scenario } from './scenarios';

const OPUS: LabModelKey = 'anthropic:claude-opus-5-5';

function scenario(id: string): Scenario {
  const found = scenarios.find((s) => s.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

function at(key: LabModelKey, ratio: number) {
  return applyAction(withAutoLimit(initialSnapshot, key), { type: 'contextRatio', ratio }, 0);
}

describe('compactação automática no laboratório', () => {
  it('Haiku 5.5: limpa em 60%, começa o resumo antecipado e avisa em 75%, compacta sozinho em 85%', () => {
    const { snapshot, engine, captions } = replayScenario(scenario('compaction'), DEFAULT_MODEL);
    const text = captions.join('\n');
    expect(text).toContain('Limpeza automática (sem IA)');
    expect(text).toContain('Resumo antecipado em segundo plano');
    expect(text).toContain('Nota ao modelo, gerada só de números: “Contexto em 79% do limite; compacta em 85%.”');
    expect(text).toContain('aplica o resumo antecipado');
    expect(text).toContain('Compactado: de 72 mil para 24 mil tokens (30% do limite)');
    expect(snapshot.context.usedTokens).toBe(24_000);
    expect(snapshot.state).toBe('idle');
    expect(engine.state.phase).toBe('cooldown');
  });

  it('Opus 5.5 com gasto apertado (banda 2): sem resumo antecipado; compacta com IA ao passar de 85%', () => {
    const { snapshot, captions } = replayScenario(scenario('compaction'), OPUS);
    const text = captions.join('\n');
    expect(text).not.toContain('Resumo antecipado');
    expect(text).toContain('Nota ao modelo');
    expect(text).toContain('compacta sozinho (resumo por IA)');
    expect(snapshot.context.usedTokens).toBe(19_111);
  });

  it('disjuntor: o segundo reenchimento seguido trava e espera você (âmbar)', () => {
    const { snapshot, engine, captions } = replayScenario(scenario('breaker'), DEFAULT_MODEL);
    expect(captions.join('\n')).toContain('Encheu de novo logo depois de compactar');
    expect(captions.at(-1)).toContain('Disjuntor: o contexto encheu de novo logo depois de compactar');
    expect(engine.state).toMatchObject({ phase: 'tripped', trippedReason: 'refill' });
    expect(snapshot.state).toBe('awaiting');

    // Só você destrava; destravado, ele compacta na hora.
    const unlocked = runEngine(applyAction(snapshot, { type: 'state', state: 'idle' }, 0), labBudget(DEFAULT_MODEL, snapshot), engine, {
      command: 'continue',
    });
    expect(unlocked.pending?.strategy).toBe('llm');
    expect(unlocked.engine.state.phase).toBe('compacting');
  });

  it('o aviso do disjuntor não se repete a cada passo', () => {
    const { snapshot, engine } = replayScenario(scenario('breaker'), DEFAULT_MODEL);
    const again = runEngine(snapshot, labBudget(DEFAULT_MODEL, snapshot), engine);
    expect(again.caption).toBeNull();
    expect(again.snapshot.state).toBe('awaiting');
  });

  it('"compactar agora" vale mesmo com pouco contexto', () => {
    const snapshot = at(DEFAULT_MODEL, 0.2);
    const result = runEngine(snapshot, labBudget(DEFAULT_MODEL, snapshot), initialEngine(snapshot), { userRequest: true });
    expect(result.pending?.strategy).toBe('llm');
    expect(result.caption).toContain('Você pediu');
  });

  it('nos modelos do catálogo, os outros cenários terminam sem travar e com snapshots válidos', () => {
    for (const model of labModels.filter((m) => !m.key.startsWith('openai:'))) {
      for (const s of scenarios.filter((x) => x.id !== 'breaker')) {
        const { snapshot, engine } = replayScenario(s, model.key);
        expect(hologramSnapshotSchema.safeParse(snapshot).success).toBe(true);
        expect(engine.state.phase, `${model.label} · ${s.id}`).not.toBe('tripped');
        expect(['idle', 'speaking']).toContain(snapshot.state);
      }
    }
  });

  it('modelo desconhecido (limite de 15 mil): compacta sem IA, e o crescimento rápido aciona o disjuntor', () => {
    const { engine, captions } = replayScenario(scenario('compaction'), 'openai:modelo-desconhecido');
    expect(captions.join('\n')).toContain('sem IA');
    expect(engine.state.phase).toBe('tripped');
  });
});

describe('troca de modelo no meio da conversa', () => {
  it('Haiku em 70% → Opus: compacta com o modelo atual antes de trocar', () => {
    const snapshot = at(DEFAULT_MODEL, 0.7);
    const result = switchModel(snapshot, DEFAULT_MODEL, OPUS, initialEngine(snapshot));
    expect(result.switchNow).toBe(false);
    expect(result.pending).toMatchObject({ strategy: 'llm', switchTo: OPUS, targetTokens: 19_111, beforeTokens: 56_000 });
    expect(result.snapshot.state).toBe('compacting');
    expect(result.caption).toContain('compacta com o modelo atual antes de trocar');

    const done = finishCompaction(result.snapshot, labBudget(OPUS, result.snapshot), result.engine, result.pending ?? { strategy: 'llm', beforeTokens: 0, resumeState: 'idle' });
    const switched = withAutoLimit(done.snapshot, OPUS);
    expect(switched.context).toEqual({ usedTokens: 19_111, limitTokens: 63_705 });
    expect(done.engine.state.phase).toBe('cooldown');
  });

  it('Haiku em 50% → Opus: só limpa (o cache se perde na troca de qualquer jeito)', () => {
    const snapshot = at(DEFAULT_MODEL, 0.5);
    const result = switchModel(snapshot, DEFAULT_MODEL, OPUS, initialEngine(snapshot));
    expect(result.switchNow).toBe(true);
    expect(result.pending).toBeNull();
    expect(result.snapshot.context.usedTokens).toBe(28_667);
  });

  it('para um limite maior, nada é desfeito', () => {
    const snapshot = at(OPUS, 0.3);
    const result = switchModel(snapshot, OPUS, DEFAULT_MODEL, initialEngine(snapshot));
    expect(result.switchNow).toBe(true);
    expect(result.snapshot).toBe(snapshot);
    expect(result.caption).toContain('nada a fazer');
  });

  it('com o disjuntor travado, trocar para um limite menor é recusado (trocar de modelo não destrava)', () => {
    const { snapshot, engine } = replayScenario(scenario('breaker'), DEFAULT_MODEL);
    const result = switchModel(snapshot, DEFAULT_MODEL, OPUS, engine);
    expect(result.switchNow).toBe(false);
    expect(result.pending).toBeNull();
    expect(result.engine).toBe(engine);
    expect(result.caption).toContain('Disjuntor travado');
  });
});
