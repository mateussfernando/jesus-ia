import { useEffect, useMemo } from 'react';
import { AdditiveBlending, Color, RingGeometry, ShaderMaterial } from 'three';
import { ringFragmentShader, ringVertexShader } from '../shaders';

export interface HudRingOptions {
  inner: number;
  outer: number;
  /** Número de marcas (0 = traço contínuo). */
  ticks?: number;
  /** Largura de cada marca (fração do intervalo). */
  tickDuty?: number;
  /** Número de traços do tracejado (0 = sem tracejado). */
  dashes?: number;
  arcStart?: number;
  arcLength?: number;
  colorOn?: string;
  colorOff?: string;
  opacityOn?: number;
  opacityOff?: number;
  feather?: number;
  segments?: number;
}

/** Cria o material de um anel do HUD; o componente dono muda os uniforms a cada quadro. */
export function createRingMaterial(options: HudRingOptions): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: ringVertexShader,
    fragmentShader: ringFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uInner: { value: options.inner },
      uOuter: { value: options.outer },
      uTicks: { value: options.ticks ?? 0 },
      uTickDuty: { value: options.tickDuty ?? 0.5 },
      uDashes: { value: options.dashes ?? 0 },
      uFill: { value: 1 },
      uFillTicks: { value: options.ticks ?? 0 },
      uArcStart: { value: options.arcStart ?? 0 },
      uArcLength: { value: options.arcLength ?? 1 },
      uRotation: { value: 0 },
      uColorOn: { value: new Color(options.colorOn ?? '#D3DCE6') },
      uColorOff: { value: new Color(options.colorOff ?? '#8693A2') },
      uOpacityOn: { value: options.opacityOn ?? 0.9 },
      uOpacityOff: { value: options.opacityOff ?? 0.15 },
      uFeather: { value: options.feather ?? 0.25 },
      uOpacity: { value: 1 },
    },
  });
}

/** Geometria + material de um anel, descartados quando o componente sai da cena. */
export function useRing(options: HudRingOptions): { geometry: RingGeometry; material: ShaderMaterial } {
  const { inner, outer, segments = 256 } = options;
  const geometry = useMemo(() => new RingGeometry(inner, outer, segments, 1), [inner, outer, segments]);
  // As opções são estáticas por anel; mudanças dinâmicas vão pelos uniforms.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useMemo(() => createRingMaterial(options), []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return { geometry, material };
}

export function setUniform(material: ShaderMaterial, name: string, value: number): void {
  const uniform = material.uniforms[name];
  if (uniform !== undefined) uniform.value = value;
}

export function setColorUniform(material: ShaderMaterial, name: string, color: Color): void {
  const uniform = material.uniforms[name];
  if (uniform !== undefined) (uniform.value as Color).copy(color);
}
