import type { TokenizerFamily } from './types';

/**
 * Calibração do estimador de tokens e margem de segurança, por modelo (docs/rascunhos/algoritmo-contexto.md,
 * seção 7.4). Compara a estimativa COMPLETA (não ancorada) com a entrada real informada pelo provedor e guarda a
 * média e a variância móveis exponenciais de ln(real / estimado). O estado fica no banco (`model_calibration`).
 * Lógica pura: sem relógio, rede ou E/S.
 */

export interface Calibration {
  /** Amostras aceitas (razão real/estimado dentro de [0,5; 2]). */
  samples: number;
  /** Média móvel exponencial de ln(real / estimado). */
  mean: number;
  /** Variância móvel exponencial de ln(real / estimado). */
  variance: number;
  /** Amostras recusadas: razão fora da faixa ou número inválido. */
  anomalies: number;
}

/** Peso da amostra nova na média e na variância móveis. */
const CALIBRATION_ALPHA = 0.2;
/** Abaixo disso, a estimativa crua vale (k = 1) e a margem é a padrão. */
const MIN_CALIBRATION_SAMPLES = 3;
/** Faixa aceita para real / estimado; fora dela a amostra é anomalia e não entra. */
const MIN_CALIBRATION_RATIO = 0.5;
const MAX_CALIBRATION_RATIO = 2;

/** Margem antes de calibrar: 0,10; tokenizador desconhecido ou runtime local (Ollama, LM Studio): 0,15. */
const DEFAULT_MARGIN_RATIO = 0.1;
const UNCERTAIN_MARGIN_RATIO = 0.15;
/** Margem depois de calibrar: 0,02 + 2·desvio padrão, dentro de [0,03; 0,12]. */
const MIN_CALIBRATED_MARGIN = 0.03;
const MAX_CALIBRATED_MARGIN = 0.12;

/** Folga de ponto flutuante para a checagem da faixa da média. */
const MEAN_SLACK = 1e-9;
const MAX_ABS_MEAN = Math.log(MAX_CALIBRATION_RATIO);

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Estado possível de uma série de amostras. Toda amostra aceita tem ln r em [ln 0,5; ln 2] e a média móvel é uma
 * combinação convexa delas, então a média nunca sai dessa faixa; a variância é finita e ≥ 0. Estado fora disso
 * (banco corrompido) vale como "sem calibração".
 */
function validSeries(cal: Calibration): boolean {
  return (
    Number.isSafeInteger(cal.samples) &&
    cal.samples >= 0 &&
    Number.isFinite(cal.mean) &&
    Math.abs(cal.mean) <= MAX_ABS_MEAN + MEAN_SLACK &&
    Number.isFinite(cal.variance) &&
    cal.variance >= 0
  );
}

function isCalibrated(cal: Calibration | null): cal is Calibration {
  return cal !== null && validSeries(cal) && cal.samples >= MIN_CALIBRATION_SAMPLES;
}

/**
 * Registra uma amostra: r = real / estimado. Estimativa ou real não finitos ou ≤ 0, ou r fora de [0,5; 2], só
 * incrementam `anomalies`. A primeira amostra inicializa mean = ln r e variance = 0; as seguintes aplicam
 * d = ln r − mean; mean += α·d; variance = (1 − α)(variance + α·d²). α fora de (0; 1] vale 0,2.
 * Uma série inválida (banco corrompido) recomeça do zero. Só chame com amostras que podem calibrar
 * (`checkReportedUsage(...).calibrate`).
 */
export function updateCalibration(
  cal: Calibration | null,
  estimatedFull: number,
  actual: number,
  alpha: number = CALIBRATION_ALPHA,
): Calibration {
  const anomalies = cal !== null && Number.isSafeInteger(cal.anomalies) && cal.anomalies >= 0 ? cal.anomalies : 0;
  const series = cal !== null && validSeries(cal) ? cal : { samples: 0, mean: 0, variance: 0 };
  const current: Calibration = { samples: series.samples, mean: series.mean, variance: series.variance, anomalies };

  const anomaly: Calibration = { ...current, anomalies: anomalies + 1 };
  if (!positiveFinite(estimatedFull) || !positiveFinite(actual)) return anomaly;
  const ratio = actual / estimatedFull;
  if (ratio < MIN_CALIBRATION_RATIO || ratio > MAX_CALIBRATION_RATIO) return anomaly;

  const a = Number.isFinite(alpha) && alpha > 0 && alpha <= 1 ? alpha : CALIBRATION_ALPHA;
  const x = Math.log(ratio);
  if (current.samples === 0) return { samples: 1, mean: x, variance: 0, anomalies };
  const d = x - current.mean;
  return {
    samples: current.samples + 1,
    mean: current.mean + a * d,
    variance: (1 - a) * (current.variance + a * d * d),
    anomalies,
  };
}

/**
 * Fator k que multiplica a estimativa: exp(mean) com 3 ou mais amostras; senão 1. Fica sempre em [0,5; 2]
 * (a faixa das amostras aceitas).
 */
export function calibrationFactor(cal: Calibration | null): number {
  if (!isCalibrated(cal)) return 1;
  return clamp(Math.exp(cal.mean), MIN_CALIBRATION_RATIO, MAX_CALIBRATION_RATIO);
}

/**
 * Margem m sobre o limite. Com 3 ou mais amostras: clamp(0,02 + 2·√variance, 0,03, 0,12). Antes disso: 0,15 para
 * tokenizador 'unknown' ou runtime local (o Ollama corta mensagens em silêncio acima do `num_ctx`; seção 3.6) e
 * 0,10 para os demais.
 */
export function marginRatio(cal: Calibration | null, family: TokenizerFamily, localRuntime: boolean): number {
  if (isCalibrated(cal)) {
    return clamp(0.02 + 2 * Math.sqrt(cal.variance), MIN_CALIBRATED_MARGIN, MAX_CALIBRATED_MARGIN);
  }
  return family === 'unknown' || localRuntime ? UNCERTAIN_MARGIN_RATIO : DEFAULT_MARGIN_RATIO;
}
