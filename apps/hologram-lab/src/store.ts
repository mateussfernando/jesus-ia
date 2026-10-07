import type { HologramSnapshot } from '@jesus/hologram';
import { create } from 'zustand';
import { applyAction, initialSnapshot, prunePulses, scenarios } from './scenarios';
import type { LabAction, Scenario } from './scenarios';

interface LabStore {
  snapshot: HologramSnapshot;
  caption: string | null;
  runningScenario: string | null;
  dispatch: (action: LabAction) => void;
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
  snapshot: initialSnapshot,
  caption: null,
  runningScenario: null,

  dispatch: (action) => set((s) => ({ snapshot: applyAction(s.snapshot, action, performance.now()) })),

  reset: () => {
    clearTimers();
    set({ snapshot: initialSnapshot, caption: null, runningScenario: null });
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
            snapshot: step.actions.reduce((snap, action) => applyAction(snap, action, now), s.snapshot),
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
