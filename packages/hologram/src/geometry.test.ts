import { describe, expect, it } from 'vitest';
import { ballPoints, createRandom, fibonacciSphere, particleSeeds, qualitySettings, starfield } from './geometry';

/** Lê um valor do array; índice fora dele vira NaN e falha o teste. */
const at = (values: Float32Array, index: number): number => values[index] ?? Number.NaN;

describe('fibonacciSphere', () => {
  it('gera pontos na esfera unitária', () => {
    const points = fibonacciSphere(500);
    expect(points.length).toBe(1500);
    for (let i = 0; i < 500; i++) {
      const length = Math.hypot(at(points, i * 3), at(points, i * 3 + 1), at(points, i * 3 + 2));
      expect(length).toBeCloseTo(1, 5);
    }
  });

  it('distribui de forma equilibrada entre os hemisférios', () => {
    const points = fibonacciSphere(1000);
    let top = 0;
    for (let i = 0; i < 1000; i++) if (at(points, i * 3 + 1) > 0) top++;
    expect(Math.abs(top - 500)).toBeLessThanOrEqual(2);
  });

  it('funciona com um ponto só', () => {
    expect(Array.from(fibonacciSphere(1))).toEqual([1, 0, 0]);
  });
});

describe('aleatoriedade determinística', () => {
  it('mesma semente, mesma sequência', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('valores entre 0 e 1', () => {
    const seeds = particleSeeds(1000, 1);
    for (const value of seeds) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('núcleo dentro da bola unitária e estrelas atrás da esfera', () => {
    const core = ballPoints(300, 3);
    for (let i = 0; i < 300; i++) {
      expect(Math.hypot(at(core, i * 3), at(core, i * 3 + 1), at(core, i * 3 + 2))).toBeLessThanOrEqual(1 + 1e-6);
    }
    const stars = starfield(300, 7);
    for (let i = 0; i < 300; i++) expect(at(stars, i * 3 + 2)).toBeLessThan(0);
  });
});

describe('orçamento de partículas (docs/04-tecnologias.md, seção 4.6)', () => {
  it('modo completo dentro do orçamento e com bloom em meia resolução', () => {
    const full = qualitySettings('full');
    const total = full.sphereParticles + full.coreParticles;
    expect(total).toBeGreaterThanOrEqual(3000);
    expect(total).toBeLessThanOrEqual(5000);
    expect(full.bloomResolution).toBeLessThanOrEqual(0.5);
    expect(full.maxPixelRatio).toBeLessThanOrEqual(2);
  });

  it('modo leve usa menos de tudo', () => {
    const full = qualitySettings('full');
    const light = qualitySettings('light');
    expect(light.sphereParticles).toBeLessThan(full.sphereParticles);
    expect(light.coreParticles).toBeLessThan(full.coreParticles);
    expect(light.bloomResolution).toBeLessThan(full.bloomResolution);
    expect(light.maxPixelRatio).toBeLessThanOrEqual(full.maxPixelRatio);
  });
});
