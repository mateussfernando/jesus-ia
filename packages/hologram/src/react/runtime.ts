import { createContext, useContext } from 'react';
import type { HologramSnapshot } from '../model';
import type { VisualState, VisualTargets } from '../visual';

/**
 * Estado mutável compartilhado entre os componentes da cena, atualizado uma vez por quadro
 * pelo `Driver`. Fica fora do React de propósito: mudar a cada quadro sem re-renderizar.
 */
export interface HologramRuntime {
  snapshot: HologramSnapshot;
  targets: VisualTargets;
  visual: VisualState;
  /** Relógio da animação (s), já escalado por "reduzir movimento". */
  time: number;
  /** Relógio de parede (ms, `performance.now()`), usado pelos pulsos. */
  now: number;
  /** Ângulos acumulados (rad). */
  sphereAngle: number;
  coreAngle: number;
  ringAngle: number;
  orbitAngle: number;
  /** Amplitude da fala (0..1). */
  audio: number;
  reducedMotion: boolean;
  /** Brilho das estrelas recém-nascidas (0..1), decai depois de uma compactação. */
  freshStars: number;
  freshFrom: number;
}

export const RuntimeContext = createContext<HologramRuntime | null>(null);

export function useRuntime(): HologramRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) throw new Error('useRuntime precisa estar dentro de <Hologram>.');
  return runtime;
}
