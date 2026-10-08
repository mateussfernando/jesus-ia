import type { HologramSnapshot } from '@jesus/hologram';
import { create } from 'zustand';
import { DEFAULT_MODEL, withAutoLimit } from './autoContext';
import type { LabModelKey } from './autoContext';
import { applyAction, initialSnapshot, prunePulses, scenarios } from './scenarios';
import type { LabAction, Scenario } from './scenarios';

interface LabStore {
  snapshot: HologramSnapshot;
  /** Modelo simulado: define o limite de contexto automaticamente. */
  modelKey: LabModelKey;
  caption: string | null;
  runningScenario: string | null;
  dispatch: (action: LabAction) => void;
  setModel: (key: LabModelKey) => void;
  reset: () => void;
  runScenario: (id: string) => void;
  stopScenario: () => void;
  prune: () => void;
}

let timers: ReturnType<typeof setTimeout>[] = [];

function clearTimers(): void {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

export const useLabStore = create<LabStore>((set, get) => ({
  snapshot: withAutoLimit(initialSnapshot, DEFAULT_MODEL),
  modelKey: DEFAULT_MODEL,
  caption: null,
  runningScenario: null,

  // Depois de cada mudança, o limite é recalculado (ex.: gastar mais aperta o limite).
  dispatch: (action) =>
    set((s) => ({ snapshot: withAutoLimit(applyAction(s.snapshot, action, performance.now()), s.modelKey) })),

  setModel: (key) => set((s) => ({ modelKey: key, snapshot: withAutoLimit(s.snapshot, key) })),

  reset: () => {
    clearTimers();
    set((s) => ({ snapshot: withAutoLimit(initialSnapshot, s.modelKey), caption: null, runningScenario: null }));
  },

  runScenario: (id) => {
    const scenario: Scenario | undefined = scenarios.find((s) => s.id === id);
    if (scenario === undefined) return;
    clearTimers();
    set({ runningScenario: id, caption: null });
    for (const step of scenario.steps) {
      timers.push(
        setTimeout(() => {
          const now = performance.now();
          set((s) => ({
            snapshot: withAutoLimit(
              step.actions.reduce((snap, action) => applyAction(snap, action, now), s.snapshot),
              s.modelKey,
            ),
            caption: step.caption ?? s.caption,
          }));
        }, step.at),
      );
    }
    const end = Math.max(...scenario.steps.map((s) => s.at)) + 3000;
    timers.push(
      setTimeout(() => {
        if (get().runningScenario === id) set({ runningScenario: null, caption: null });
      }, end),
    );
  },

  stopScenario: () => {
    clearTimers();
    set({ runningScenario: null, caption: null });
  },

  prune: () => set((s) => {
    const snapshot = prunePulses(s.snapshot, performance.now());
    return snapshot === s.snapshot ? s : { snapshot };
  }),
}));
