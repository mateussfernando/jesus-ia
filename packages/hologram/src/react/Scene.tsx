import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import { ballPoints, fibonacciSphere, particleSeeds } from '../geometry';
import type { QualitySettings } from '../geometry';
import { MAX_SUBAGENTS } from '../model';
import type { Satellite } from '../model';
import { stepVisual, subagentDirection, syntheticSpeechLevel } from '../visual';
import { Hud } from './Hud';
import { ParticleSphere } from './ParticleSphere';
import { useRuntime } from './runtime';
import { Satellites } from './Satellites';
import type { LabelRegistry } from './Satellites';
import { Stars } from './Stars';

/** Atualiza o relógio, os ângulos e a suavização uma vez por quadro, antes de todo o resto. */
function Driver({ audioLevel }: { audioLevel: (() => number) | undefined }) {
  const runtime = useRuntime();
  const lastMemory = useRef(runtime.snapshot.memoryCount);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const scaled = runtime.reducedMotion ? dt * 0.25 : dt;
    runtime.time += scaled;
    runtime.now = performance.now();
    stepVisual(runtime.visual, runtime.targets, dt);

    const v = runtime.visual;
    runtime.sphereAngle += v.spin * scaled;
    runtime.coreAngle += v.coreSpin * scaled;
    runtime.ringAngle += v.ringSpin * scaled;
    runtime.orbitAngle += 0.06 * (1 - v.gray) * scaled;

    const speaking = v.speech > 0.01;
    const level = audioLevel ? audioLevel() : syntheticSpeechLevel(runtime.time);
    runtime.audio = speaking ? level : 0;

    // Memórias novas: as estrelas recém-criadas brilham e depois se acalmam.
    const memories = runtime.snapshot.memoryCount;
    if (memories > lastMemory.current) {
      runtime.freshFrom = lastMemory.current;
      runtime.freshStars = 1;
    }
    lastMemory.current = memories;
    runtime.freshStars = Math.max(0, runtime.freshStars - dt * 0.35);
  }, -10);

  return null;
}

/** Câmera com leve paralaxe; recua em telas estreitas (celular em pé) para caber a órbita. */
function CameraRig() {
  const runtime = useRuntime();
  const camera = useThree((state) => state.camera);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));

  useFrame(() => {
    // Metade da largura visível = d · tan(20°) · aspecto; a órbita com rótulos precisa de ~2,4.
    const distance = Math.max(6.4, 6.9 / aspect);
    const drift = runtime.reducedMotion ? 0 : 1;
    camera.position.set(Math.sin(runtime.time * 0.11) * 0.25 * drift, Math.sin(runtime.time * 0.07) * 0.15 * drift, distance);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** Subagentes: esferas menores que brotam da principal (docs/08-holograma.md, seção 8.2). */
function Subagents({ quality }: { quality: QualitySettings }) {
  const runtime = useRuntime();
  const groups = useRef<(Group | null)[]>([]);
  const geometry = useMemo(
    () => ({ positions: fibonacciSphere(quality.subagentParticles), seeds: particleSeeds(quality.subagentParticles, 23) }),
    [quality.subagentParticles],
  );

  useFrame(() => {
    const count = Math.max(1, Math.round(runtime.targets.subagents));
    for (let i = 0; i < MAX_SUBAGENTS; i++) {
      const group = groups.current[i];
      if (!group) continue;
      const presence = Math.min(1, Math.max(0, runtime.visual.subagents - i));
      const [dx, dy] = subagentDirection(i, count);
      const distance = runtime.visual.radius + 0.12 + 0.22 * presence;
      group.position.set(dx * distance * presence, dy * distance * presence, 0.2 * presence);
    }
  });

  return (
    <>
      {Array.from({ length: MAX_SUBAGENTS }, (_, i) => (
        <group
          key={i}
          ref={(group) => {
            groups.current[i] = group;
          }}
        >
          <ParticleSphere positions={geometry.positions} seeds={geometry.seeds} role="subagent" pointSize={2.4} subagentIndex={i} />
        </group>
      ))}
    </>
  );
}

/** Mede a taxa de quadros e avisa a cada segundo. */
function FpsProbe({ onFps }: { onFps: ((fps: number) => void) | undefined }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    if (!onFps) return;
    acc.current.frames++;
    acc.current.time += delta;
    if (acc.current.time >= 1) {
      onFps(acc.current.frames / acc.current.time);
      acc.current.frames = 0;
      acc.current.time = 0;
    }
  });
  return null;
}

export interface SceneProps {
  quality: QualitySettings;
  satellites: readonly Satellite[];
  labels: LabelRegistry;
  variant: 'full' | 'mini';
  audioLevel: (() => number) | undefined;
  onFps: ((fps: number) => void) | undefined;
}

export function Scene({ quality, satellites, labels, variant, audioLevel, onFps }: SceneProps) {
  const sphere = useMemo(
    () => ({ positions: fibonacciSphere(quality.sphereParticles), seeds: particleSeeds(quality.sphereParticles, 1) }),
    [quality.sphereParticles],
  );
  const core = useMemo(
    () => ({ positions: ballPoints(quality.coreParticles, 3), seeds: particleSeeds(quality.coreParticles, 5) }),
    [quality.coreParticles],
  );
  // Menos partículas = cada uma um pouco maior, para a esfera não parecer rala.
  const pointSize = 2.2 * Math.sqrt(4400 / quality.sphereParticles);

  return (
    <>
      <Driver audioLevel={audioLevel} />
      <CameraRig />
      <FpsProbe onFps={onFps} />
      {variant === 'full' && <Stars />}
      <ParticleSphere positions={sphere.positions} seeds={sphere.seeds} role="main" pointSize={pointSize} />
      <ParticleSphere positions={core.positions} seeds={core.seeds} role="core" pointSize={2.4} />
      <Subagents quality={quality} />
      <Hud showSpend={variant === 'full'} />
      {variant === 'full' && <Satellites satellites={satellites} labels={labels} />}
      {/* No modo mini a janela é transparente; o bloom apagaria a transparência. */}
      {quality.bloom && variant === 'full' && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur resolutionScale={quality.bloomResolution} intensity={1.15} luminanceThreshold={0.08} luminanceSmoothing={0.35} radius={0.7} />
        </EffectComposer>
      )}
    </>
  );
}
