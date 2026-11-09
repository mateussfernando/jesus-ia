import type { HologramSnapshot, HologramState, Pulse, PulseKind, Taint } from './model';

/**
 * Lógica visual pura: transforma o snapshot em alvos numéricos para os *uniforms*.
 * Não depende de Three.js nem do DOM, para ser testável em Linux (docs/04-tecnologias.md, seção 4.8).
 */

export type AlertColor = 'none' | 'amber' | 'red';

export interface StateProfile {
  /** Rotação da esfera (rad/s). */
  spin: number;
  /** Rotação do núcleo (rad/s): rápido = pensando. */
  coreSpin: number;
  /** Velocidade dos anéis e arcos (rad/s). */
  ringSpin: number;
  /** Amplitude da respiração (fração do raio). */
  breath: number;
  /** Frequência da respiração (Hz). */
  breathRate: number;
  /** 0..1: superfície ondulando (falando). */
  speech: number;
  /** 0..1: ondas na frente da esfera (ouvindo). */
  listen: number;
  /** 0..1: redemoinho de pensamento. */
  think: number;
  /** 0..1: agitação das partículas (executando). */
  turbulence: number;
  /** 0..1: colapso para o núcleo (compactando). */
  compaction: number;
  alert: AlertColor;
  /** Pisca do alerta (Hz); 0 = cor fixa. */
  alertFlashRate: number;
  /** 0..1: dessaturação para o cinza (offline). */
  gray: number;
  /** Brilho geral. */
  brightness: number;
}

const base: StateProfile = {
  spin: 0.08,
  coreSpin: 0.3,
  ringSpin: 0.05,
  breath: 0.03,
  breathRate: 0.22,
  speech: 0,
  listen: 0,
  think: 0,
  turbulence: 0,
  compaction: 0,
  alert: 'none',
  alertFlashRate: 0,
  gray: 0,
  brightness: 0.85,
};

const profiles: Record<HologramState, StateProfile> = {
  idle: base,
  listening: { ...base, spin: 0.1, coreSpin: 0.45, ringSpin: 0.08, breath: 0.01, listen: 1, brightness: 1 },
  thinking: { ...base, spin: 0.16, coreSpin: 2.4, ringSpin: 0.55, breath: 0.01, think: 1, turbulence: 0.15, brightness: 1 },
  speaking: { ...base, spin: 0.1, coreSpin: 0.6, ringSpin: 0.1, breath: 0, speech: 1, brightness: 1 },
  executing: { ...base, spin: 0.12, coreSpin: 1.1, ringSpin: 0.28, breath: 0.01, turbulence: 0.45, brightness: 0.95 },
  awaiting: { ...base, spin: 0.05, coreSpin: 0.25, ringSpin: 0.03, breath: 0.045, breathRate: 0.5, alert: 'amber', brightness: 0.95 },
  blocked: { ...base, spin: 0.04, coreSpin: 0.15, ringSpin: 0, breath: 0, alert: 'red', alertFlashRate: 3, turbulence: 0.3, brightness: 1 },
  compacting: { ...base, spin: 0.45, coreSpin: 3.2, ringSpin: 0.7, breath: 0, compaction: 1, brightness: 1 },
  offline: { ...base, spin: 0, coreSpin: 0, ringSpin: 0, breath: 0, gray: 1, brightness: 0.35 },
};

export function stateProfile(state: HologramState): StateProfile {
  return profiles[state];
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Fração do contexto em uso (0..1). */
export function contextRatio(context: HologramSnapshot['context']): number {
  return clamp01(context.usedTokens / context.limitTokens);
}

export const SPHERE_MIN_RADIUS = 0.35;
export const SPHERE_MAX_RADIUS = 1;

/**
 * Raio da esfera: cresce com o contexto em uso e encosta no contorno tracejado (limite do modelo) em 100%.
 * Usa raiz cúbica para que o *volume* acompanhe o contexto, com um piso para a esfera nunca sumir.
 */
export function sphereRadius(ratio: number): number {
  const r = clamp01(ratio);
  return SPHERE_MIN_RADIUS + (SPHERE_MAX_RADIUS - SPHERE_MIN_RADIUS) * Math.cbrt(r);
}

/** Marcas preenchidas no anel externo (sentido horário a partir do topo). */
export function filledTicks(ratio: number, tickCount: number): number {
  return Math.floor(clamp01(ratio) * tickCount + 1e-9);
}

export type SpendLevel = 'normal' | 'warning' | 'exceeded';

/** Alerta em 80% e parada em 100% do orçamento diário (docs/09-modelos.md, seção 9.4). */
export function spendLevel(spend: HologramSnapshot['spend']): SpendLevel {
  const ratio = spend.todayUsd / spend.limitUsd;
  if (ratio >= 1) return 'exceeded';
  if (ratio >= 0.8) return 'warning';
  return 'normal';
}

export function spendRatio(spend: HologramSnapshot['spend']): number {
  return clamp01(spend.todayUsd / spend.limitUsd);
}

export function taintAmount(taint: Taint): number {
  switch (taint) {
    case 'clean':
      return 0;
    case 'tainted':
      return 0.55;
    case 'suspicious':
      return 1;
  }
}

/** Alvos numéricos que o componente suaviza e entrega aos shaders. */
export interface VisualTargets extends Omit<StateProfile, 'alert'> {
  radius: number;
  contextRatio: number;
  spendRatio: number;
  spendLevel: SpendLevel;
  taint: number;
  /** 0 = sem alerta; 1 = âmbar ou vermelho, conforme `alert`. */
  alertMix: number;
  alert: AlertColor;
  subagents: number;
  /** Esmaece a esfera para destacar o código do *device flow*. */
  dim: number;
}

export function computeTargets(snapshot: HologramSnapshot): VisualTargets {
  const profile = stateProfile(snapshot.state);
  const ratio = contextRatio(snapshot.context);
  return {
    ...profile,
    radius: sphereRadius(ratio),
    contextRatio: ratio,
    spendRatio: spendRatio(snapshot.spend),
    spendLevel: spendLevel(snapshot.spend),
    taint: taintAmount(snapshot.taint),
    alertMix: profile.alert === 'none' ? 0 : 1,
    subagents: snapshot.subagents,
    dim: snapshot.deviceCode === null ? 0 : 0.65,
  };
}

/**
 * Suavização exponencial independente da taxa de quadros.
 * `lambda` maior = chega mais rápido no alvo.
 */
export function damp(current: number, target: number, lambda: number, dtSeconds: number): number {
  if (dtSeconds <= 0) return current;
  return target + (current - target) * Math.exp(-lambda * dtSeconds);
}

// --- Pulsos -----------------------------------------------------------------------------------

/** Posição do losango do Porteiro no fio (0 = esfera, 1 = satélite). */
export const GATE_POSITION = 0.42;
export const PULSE_TRAVEL_MS = 1100;
/** Quanto tempo o pulso barrado fica piscando no losango. */
export const BLOCKED_HOLD_MS = 1600;

export function pulseDuration(kind: PulseKind): number {
  return kind === 'blocked' ? PULSE_TRAVEL_MS * GATE_POSITION + BLOCKED_HOLD_MS : PULSE_TRAVEL_MS;
}

export interface PulseFrame {
  /** Posição no fio: 0 = superfície da esfera, 1 = satélite. */
  position: number;
  /** 0..1 */
  intensity: number;
  /** O pulso parou no Porteiro e pisca em vermelho. */
  stoppedAtGate: boolean;
}

/** Estado de um pulso no instante `now`; `null` se ainda não começou ou já terminou. */
export function pulseFrame(pulse: Pick<Pulse, 'kind' | 'startedAt'>, now: number): PulseFrame | null {
  const elapsed = now - pulse.startedAt;
  if (elapsed < 0 || elapsed > pulseDuration(pulse.kind)) return null;

  if (pulse.kind === 'blocked') {
    const travel = PULSE_TRAVEL_MS * GATE_POSITION;
    if (elapsed <= travel) {
      return { position: (elapsed / travel) * GATE_POSITION, intensity: 1, stoppedAtGate: false };
    }
    const hold = (elapsed - travel) / BLOCKED_HOLD_MS;
    return { position: GATE_POSITION, intensity: 1 - hold * hold, stoppedAtGate: true };
  }

  const t = elapsed / PULSE_TRAVEL_MS;
  // Some suavemente nas pontas.
  const intensity = Math.min(1, t * 6, (1 - t) * 6);
  return { position: pulse.kind === 'action' ? t : 1 - t, intensity, stoppedAtGate: false };
}

export function isPulseAlive(pulse: Pick<Pulse, 'kind' | 'startedAt'>, now: number): boolean {
  return now - pulse.startedAt <= pulseDuration(pulse.kind);
}

// --- Satélites --------------------------------------------------------------------------------

export const ORBIT_RADIUS = 2.05;

/** Ângulo de cada satélite na órbita: distribuídos por igual e girando devagar. */
export function satelliteAngle(index: number, count: number, timeSeconds: number, speed: number): number {
  if (count <= 0) return 0;
  return (index / count) * Math.PI * 2 + timeSeconds * speed;
}

/**
 * Posição do satélite numa órbita levemente inclinada (x, y, z).
 * A inclinação dá profundidade sem esconder os satélites atrás da esfera por muito tempo.
 */
export function satellitePosition(angle: number, radius = ORBIT_RADIUS, tilt = 0.32): [number, number, number] {
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return [x, -z * Math.sin(tilt), z * Math.cos(tilt)];
}

// --- Subagentes -------------------------------------------------------------------------------

/** Direções em que os subagentes "brotam" da esfera (no plano da tela, a partir de cima). */
export function subagentDirection(index: number, count: number): [number, number] {
  const angle = Math.PI / 2 + (index / Math.max(1, count)) * Math.PI * 2 + Math.PI / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

// --- Suavização quadro a quadro ---------------------------------------------------------------

/** Campos numéricos que transitam suavemente entre estados. */
export const smoothedKeys = [
  'spin',
  'coreSpin',
  'ringSpin',
  'breath',
  'breathRate',
  'speech',
  'listen',
  'think',
  'turbulence',
  'compaction',
  'alertFlashRate',
  'gray',
  'brightness',
  'radius',
  'contextRatio',
  'spendRatio',
  'taint',
  'alertMix',
  'subagents',
  'dim',
] as const satisfies readonly (keyof VisualTargets)[];

export type SmoothedKey = (typeof smoothedKeys)[number];

export type VisualState = Record<SmoothedKey, number> & {
  /** Cor do alerta em curso; continua a mesma enquanto o alerta some, para não trocar de cor no meio. */
  alertColor: Exclude<AlertColor, 'none'>;
};

/** Velocidade de cada transição (1/s). O alerta entra rápido; o raio muda devagar. */
const lambdas: Partial<Record<SmoothedKey, number>> = {
  radius: 2.2,
  contextRatio: 3,
  alertMix: 9,
  compaction: 2.6,
  subagents: 2.4,
  taint: 4,
};
const DEFAULT_LAMBDA = 3.5;

export function initialVisualState(targets: VisualTargets): VisualState {
  const state = { alertColor: targets.alert === 'none' ? 'amber' : targets.alert } as VisualState;
  for (const key of smoothedKeys) state[key] = targets[key];
  return state;
}

/** Avança a suavização em `dtSeconds`, mudando `state` no lugar (evita alocação a cada quadro). */
export function stepVisual(state: VisualState, targets: VisualTargets, dtSeconds: number): VisualState {
  const dt = Math.min(dtSeconds, 0.1);
  for (const key of smoothedKeys) {
    state[key] = damp(state[key], targets[key], lambdas[key] ?? DEFAULT_LAMBDA, dt);
  }
  if (targets.alert !== 'none') state.alertColor = targets.alert;
  return state;
}

/**
 * Fator de pisca do alerta (0..1) no instante `t`. Sem pisca = 1 (cor fixa).
 * Com "reduzir movimento" ligado, o alerta não pisca.
 */
export function alertFlash(rate: number, timeSeconds: number, reducedMotion: boolean): number {
  if (reducedMotion || rate < 0.05) return 1;
  return 0.55 + 0.45 * Math.cos(timeSeconds * Math.PI * 2 * rate);
}

/**
 * Amplitude de fala sintética (0..1), com ritmo de sílabas, para o protótipo sem TTS.
 * Na fase de voz, este valor vem de um `AnalyserNode` da Web Audio (docs/08-holograma.md, seção 8.6).
 */
export function syntheticSpeechLevel(timeSeconds: number): number {
  const t = timeSeconds;
  const syllables = Math.abs(Math.sin(t * 7.3)) * (0.6 + 0.4 * Math.sin(t * 2.1));
  const phrase = 0.5 + 0.5 * Math.sin(t * 0.9);
  return clamp01(syllables * (0.35 + 0.65 * phrase));
}
