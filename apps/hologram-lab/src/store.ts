import type { HologramSnapshot } from '@jesus/hologram';
import { create } from 'zustand';
import { COMPACTION_DURATION_MS, finishCompaction, initialEngine, runEngine, settleLab, switchModel } from './autoCompaction';
import type { EngineInput, EngineResult, LabEngine, PendingCompaction } from './autoCompaction';
import { DEFAULT_MODEL, labBudget, withAutoLimit } from './autoContext';
import type { LabModelKey } from './autoContext';
import { applyAction, initialSnapshot, prunePulses, scenarios } from './scenarios';
import type { LabAction, Scenario } from './scenarios';

interface LabStore {
  snapshot: HologramSnapshot;
  /** Modelo simulado: define o limite de contexto automaticamente. */
  modelKey: LabModelKey;
  /** Compactação automática (a mesma máquina de estados do app) sobre o histórico simulado. */
  engine: LabEngine;
  caption: string | null;
  runningScenario: string | null;
  dispatch: (action: LabAction) => void;
  setModel: (key: LabModelKey) => void;
  /** "/compactar": pedido explícito do usuário. */
  requestCompaction: () => void;
  /** Destrava o disjuntor (só o usuário pode). */
  continueAfterTrip: () => void;
  reset: () => void;
  runScenario: (id: string) => void;
  stopScenario: () => void;
  prune: () => void;
}

let timers: ReturnType<typeof setTimeout>[] = [];
let compactionTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

function cancelCompaction(): void {
  if (compactionTimer !== null) clearTimeout(compactionTimer);
  compactionTimer = null;
}

const startSnapshot = withAutoLimit(initialSnapshot, DEFAULT_MODEL);

export const useLabStore = create<LabStore>((set, get) => {
  /** Guarda o resultado da máquina de estados e agenda o fim da compactação, se começou uma. */
  function apply(result: EngineResult, fallbackCaption: string | null = null): Partial<LabStore> {
    if (result.pending !== null) schedule(result.pending);
    return {
      snapshot: result.snapshot,
      engine: result.engine,
      ...(result.caption !== null ? { caption: result.caption } : fallbackCaption !== null ? { caption: fallbackCaption } : {}),
    };
  }

  function schedule(pending: PendingCompaction): void {
    cancelCompaction();
    compactionTimer = setTimeout(() => {
      compactionTimer = null;
      set((s) => {
        const key = pending.switchTo ?? s.modelKey;
        const done = finishCompaction(s.snapshot, labBudget(key, s.snapshot), s.engine, pending);
        const snapshot = withAutoLimit(done.snapshot, key);
        // Depois de compactar, a máquina olha de novo (ex.: o usuário encheu o contexto enquanto compactava).
        const again = runEngine(snapshot, labBudget(key, snapshot), done.engine);
        return { modelKey: key, ...apply(again, done.caption) };
      });
    }, COMPACTION_DURATION_MS[pending.strategy]);
  }

  function settle(s: LabStore, next: HologramSnapshot, input: EngineInput = {}, fallbackCaption: string | null = null) {
    return apply(settleLab(s.snapshot, next, s.modelKey, s.engine, input), fallbackCaption);
  }

  return {
    snapshot: startSnapshot,
    modelKey: DEFAULT_MODEL,
    engine: initialEngine(startSnapshot),
    caption: null,
    runningScenario: null,

    // Depois de cada mudança: limite automático (gastar mais aperta o limite) e compactação automática.
    dispatch: (action) => set((s) => settle(s, applyAction(s.snapshot, action, performance.now()))),

    setModel: (key) => {
      const s = get();
      if (key === s.modelKey) return;
      if (s.engine.state.phase === 'compacting') {
        set({ caption: 'A troca de modelo espera a compactação terminar.' });
        return;
      }
      const result = switchModel(s.snapshot, s.modelKey, key, s.engine);
      const applied = apply(result);
      // Sem troca agora: ou a troca espera a compactação (pending.switchTo), ou foi recusada (disjuntor travado).
      set(result.switchNow ? { ...applied, modelKey: key, snapshot: withAutoLimit(result.snapshot, key) } : applied);
    },

    requestCompaction: () => set((s) => settle(s, s.snapshot, { userRequest: true })),

    continueAfterTrip: () =>
      set((s) => {
        const snapshot = s.snapshot.state === 'awaiting' ? applyAction(s.snapshot, { type: 'state', state: 'idle' }, 0) : s.snapshot;
        return settle(s, snapshot, { command: 'continue' }, 'Destravado por você: a compactação automática voltou a funcionar.');
      }),

    reset: () => {
      clearTimers();
      cancelCompaction();
      set((s) => {
        const snapshot = withAutoLimit(initialSnapshot, s.modelKey);
        return { snapshot, engine: initialEngine(snapshot), caption: null, runningScenario: null };
      });
    },

    runScenario: (id) => {
      const scenario: Scenario | undefined = scenarios.find((s) => s.id === id);
      if (scenario === undefined) return;
      clearTimers();
      cancelCompaction();
      // Cada cenário começa como uma sessão nova da compactação automática.
      set((s) => {
        const snapshot = s.snapshot.state === 'compacting' ? applyAction(s.snapshot, { type: 'state', state: 'idle' }, 0) : s.snapshot;
        return { snapshot, engine: initialEngine(snapshot), runningScenario: id, caption: null };
      });
      for (const step of scenario.steps) {
        timers.push(
          setTimeout(() => {
            const now = performance.now();
            set((s) => settle(s, step.actions.reduce((snap, action) => applyAction(snap, action, now), s.snapshot), {}, step.caption ?? null));
          }, step.at),
        );
      }
      const end = Math.max(...scenario.steps.map((s) => s.at)) + 3000;
      timers.push(
        setTimeout(() => {
          // A legenda some no fim, menos quando o disjuntor travou (o aviso precisa ficar até você agir).
          if (get().runningScenario === id) {
            set((s) => ({ runningScenario: null, ...(s.engine.state.phase === 'tripped' ? {} : { caption: null }) }));
          }
        }, end),
      );
    },

    stopScenario: () => {
      clearTimers();
      set({ runningScenario: null, caption: null });
    },

    prune: () =>
      set((s) => {
        const snapshot = prunePulses(s.snapshot, performance.now());
        return snapshot === s.snapshot ? s : { snapshot };
      }),
  };
});
