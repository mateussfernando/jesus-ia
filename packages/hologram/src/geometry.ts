/** Geração de geometria sem dependência de Three.js (testável em Node). */

/** Gerador pseudoaleatório determinístico (mulberry32): mesma semente = mesmo holograma. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Distribui `count` pontos de forma quase uniforme na esfera unitária (espiral de Fibonacci).
 * Retorna `[x0, y0, z0, x1, …]`.
 */
export function fibonacciSphere(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    positions[i * 3] = Math.cos(theta) * ring;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * ring;
  }
  return positions;
}

/** Um valor aleatório por partícula (0..1), usado nos shaders para variar fase, brilho e chiado. */
export function particleSeeds(count: number, seed: number): Float32Array {
  const random = createRandom(seed);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = random();
  return seeds;
}

/**
 * Pontos dentro de uma bola (núcleo): mais densos no centro.
 * Retorna `[x0, y0, z0, …]` com raio máximo 1.
 */
export function ballPoints(count: number, seed: number): Float32Array {
  const random = createRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = random() * 2 - 1;
    const phi = random() * Math.PI * 2;
    const r = Math.pow(random(), 1.6);
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = r * s * Math.cos(phi);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(phi);
  }
  return positions;
}

/** Estrelas do fundo (memórias de longo prazo), numa casca distante atrás da esfera. */
export function starfield(count: number, seed: number, innerRadius = 9, outerRadius = 16): Float32Array {
  const random = createRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Só o hemisfério de trás (z < 0), visível pela câmera.
    const u = random() * 2 - 1;
    const phi = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = innerRadius + random() * (outerRadius - innerRadius);
    positions[i * 3] = r * s * Math.cos(phi) * 1.6;
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = -Math.abs(r * s * Math.sin(phi)) - 2;
  }
  return positions;
}

export interface QualitySettings {
  sphereParticles: number;
  coreParticles: number;
  subagentParticles: number;
  bloom: boolean;
  /** Fração da resolução usada pelo *bloom* (0.5 = meia resolução). */
  bloomResolution: number;
  maxPixelRatio: number;
}

export type QualityLevel = 'full' | 'light';

/**
 * Orçamento de partículas (docs/04-tecnologias.md, seção 4.6):
 * 3–5 mil partículas e *bloom* em meia resolução por padrão; modo leve para GPU integrada fraca ou bateria.
 */
export function qualitySettings(level: QualityLevel): QualitySettings {
  if (level === 'light') {
    return {
      sphereParticles: 2400,
      coreParticles: 300,
      subagentParticles: 260,
      bloom: true,
      bloomResolution: 0.35,
      maxPixelRatio: 1,
    };
  }
  return {
    sphereParticles: 4400,
    coreParticles: 600,
    subagentParticles: 500,
    bloom: true,
    bloomResolution: 0.5,
    maxPixelRatio: 2,
  };
}
