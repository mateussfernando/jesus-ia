import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import type { Points } from 'three';
import { palette } from '../palette';
import { particleFragmentShader, particleVertexShader } from '../shaders';
import { alertFlash } from '../visual';
import { useRuntime } from './runtime';
import type { HologramRuntime } from './runtime';

export type SphereRole = 'main' | 'core' | 'subagent';

interface ParticleSphereProps {
  positions: Float32Array;
  seeds: Float32Array;
  role: SphereRole;
  pointSize: number;
  /** Só para subagentes: índice e posição relativa. */
  subagentIndex?: number;
}

const alertColors = { amber: new Color(palette.amber), red: new Color(palette.red) } as const;

function createMaterial(pointSize: number, pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: 1 },
      uBreath: { value: 0 },
      uBreathRate: { value: 0 },
      uSpeech: { value: 0 },
      uAudio: { value: 0 },
      uListen: { value: 0 },
      uThink: { value: 0 },
      uTurbulence: { value: 0 },
      uCompaction: { value: 0 },
      uTaint: { value: 0 },
      uPointSize: { value: pointSize },
      uPixelRatio: { value: pixelRatio },
      uBaseColor: { value: new Color(palette.silver) },
      uHotColor: { value: new Color(palette.core) },
      uGrayColor: { value: new Color(palette.gray) },
      uAlertColor: { value: alertColors.amber.clone() },
      uAlertMix: { value: 0 },
      uGray: { value: 0 },
      uBrightness: { value: 1 },
      uDim: { value: 0 },
      uOpacity: { value: 1 },
    },
  });
}

/** Escreve os uniforms a partir do estado suavizado, conforme o papel da esfera. */
function applyUniforms(material: ShaderMaterial, runtime: HologramRuntime, role: SphereRole, subagentIndex: number): void {
  const u = material.uniforms;
  const v = runtime.visual;
  const set = (name: string, value: number) => {
    const uniform = u[name];
    if (uniform !== undefined) uniform.value = value;
  };

  set('uTime', runtime.time + (role === 'subagent' ? subagentIndex * 3.1 : 0));
  set('uTaint', v.taint);
  set('uGray', v.gray);
  set('uDim', v.dim);
  const alert = u.uAlertColor;
  if (alert !== undefined) (alert.value as Color).copy(alertColors[v.alertColor]);
  set('uAlertMix', v.alertMix * alertFlash(v.alertFlashRate, runtime.time, runtime.reducedMotion));

  if (role === 'main') {
    set('uRadius', v.radius);
    set('uBreath', v.breath);
    set('uBreathRate', v.breathRate);
    set('uSpeech', v.speech);
    set('uAudio', runtime.audio);
    set('uListen', v.listen);
    set('uThink', v.think);
    set('uTurbulence', v.turbulence);
    set('uCompaction', v.compaction);
    set('uBrightness', v.brightness);
    set('uOpacity', 1);
  } else if (role === 'core') {
    // O núcleo cresce um pouco e brilha mais durante a compactação (tudo vai para ele).
    set('uRadius', v.radius * (0.26 + 0.12 * v.compaction));
    set('uBreath', 0.04 + 0.04 * v.think);
    set('uBreathRate', 0.4 + v.think * 1.6);
    set('uTurbulence', 0.2 + 0.5 * v.think);
    set('uBrightness', Math.min(1.4, v.brightness * (1 + 0.6 * v.compaction + 0.25 * v.think)));
    set('uOpacity', 1);
  } else {
    // Subagente: aparece conforme `subagents` passa pelo índice dele.
    const presence = Math.min(1, Math.max(0, v.subagents - subagentIndex));
    set('uRadius', 0.26 * Math.max(0.05, presence));
    set('uBreath', 0.03);
    set('uBreathRate', 0.5);
    set('uTurbulence', 0.35);
    set('uThink', 0.6);
    set('uBrightness', Math.min(1.6, v.brightness * 1.5));
    set('uOpacity', presence);
  }
}

export function ParticleSphere({ positions, seeds, role, pointSize, subagentIndex = 0 }: ParticleSphereProps) {
  const runtime = useRuntime();
  const pointsRef = useRef<Points>(null);
  const pixelRatio = useThree((state) => state.viewport.dpr);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    return g;
  }, [positions, seeds]);

  const material = useMemo(() => createMaterial(pointSize, 1), [pointSize]);

  useEffect(() => {
    const uniform = material.uniforms.uPixelRatio;
    if (uniform !== undefined) uniform.value = pixelRatio;
  }, [material, pixelRatio]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const points = pointsRef.current;
    if (points === null) return;
    applyUniforms(material, runtime, role, subagentIndex);
    if (role === 'main') {
      points.rotation.y = runtime.sphereAngle;
      points.rotation.x = 0.18;
    } else if (role === 'core') {
      points.rotation.y = runtime.coreAngle;
      points.rotation.z = runtime.coreAngle * 0.37;
    } else {
      points.rotation.y = -runtime.coreAngle * 0.6;
      points.visible = runtime.visual.subagents - subagentIndex > 0.01;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
