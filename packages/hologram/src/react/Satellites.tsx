import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Line,
  LineBasicMaterial,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Group, Mesh } from 'three';
import type { Satellite } from '../model';
import { palette } from '../palette';
import { GATE_POSITION, ORBIT_RADIUS, pulseFrame, satelliteAngle, satellitePosition } from '../visual';
import { useRuntime } from './runtime';

const ORBIT = ORBIT_RADIUS;
const PULSES_PER_WIRE = 4;

export type LabelRegistry = Map<string, HTMLElement>;

const silver = new Color(palette.silver);
const red = new Color(palette.red);
const white = new Color(palette.core);

/** Geometrias compartilhadas por todos os satélites. */
function useSharedGeometry() {
  const geometry = useMemo(
    () => ({
      node: new SphereGeometry(0.045, 16, 12),
      ringInner: new RingGeometry(0.085, 0.094, 48),
      ringOuter: new RingGeometry(0.122, 0.13, 48),
      gate: new RingGeometry(0.034, 0.05, 4),
      pulse: new CircleGeometry(0.03, 16),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const g of Object.values(geometry)) g.dispose();
    },
    [geometry],
  );
  return geometry;
}

type SharedGeometry = ReturnType<typeof useSharedGeometry>;

function basic(color: string, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}

interface SatelliteNodeProps {
  satellite: Satellite;
  index: number;
  count: number;
  geometry: SharedGeometry;
  labels: LabelRegistry;
}

function SatelliteNode({ satellite, index, count, geometry, labels }: SatelliteNodeProps) {
  const runtime = useRuntime();
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  const groupRef = useRef<Group>(null);
  const gateRef = useRef<Mesh>(null);
  const pulseRefs = useRef<(Mesh | null)[]>([]);

  const materials = useMemo(
    () => ({
      node: basic(palette.core, 0.95),
      ring: basic(palette.silver, 0.7),
      gate: basic(palette.silver, 0.8),
      pulses: Array.from({ length: PULSES_PER_WIRE }, () => basic(palette.core, 1)),
    }),
    [],
  );

  const wire = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const material = new LineBasicMaterial({
      color: palette.silverDark,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return new Line(g, material);
  }, []);

  useEffect(
    () => () => {
      wire.geometry.dispose();
      (wire.material as LineBasicMaterial).dispose();
      materials.node.dispose();
      materials.ring.dispose();
      materials.gate.dispose();
      for (const m of materials.pulses) m.dispose();
    },
    [wire, materials],
  );

  const scratch = useMemo(
    () => ({ satellite: new Vector3(), start: new Vector3(), end: new Vector3(), point: new Vector3(), projected: new Vector3() }),
    [],
  );

  useFrame(() => {
    const group = groupRef.current;
    const gate = gateRef.current;
    if (group === null || gate === null) return;
    const v = runtime.visual;

    const angle = satelliteAngle(index, count, 0, 0) + runtime.orbitAngle;
    const [x, y, z] = satellitePosition(angle, ORBIT);
    scratch.satellite.set(x, y, z);
    group.position.copy(scratch.satellite);
    group.quaternion.copy(camera.quaternion);

    // Profundidade: atrás da esfera fica mais apagado.
    const depth = 0.45 + 0.55 * ((z / ORBIT + 1) / 2);
    const fade = depth * (1 - v.gray * 0.78) * (1 - v.dim * 0.6);
    materials.node.opacity = 0.95 * fade;
    materials.ring.opacity = 0.7 * fade;

    // Fio: da superfície da esfera até a borda do satélite.
    const direction = scratch.point.copy(scratch.satellite).normalize();
    scratch.start.copy(direction).multiplyScalar(v.radius * 1.02);
    scratch.end.copy(scratch.satellite).addScaledVector(direction, -0.14);
    const attribute = wire.geometry.getAttribute('position') as BufferAttribute;
    attribute.setXYZ(0, scratch.start.x, scratch.start.y, scratch.start.z);
    attribute.setXYZ(1, scratch.end.x, scratch.end.y, scratch.end.z);
    attribute.needsUpdate = true;
    (wire.material as LineBasicMaterial).opacity = 0.42 * fade;

    // Losango do Porteiro no fio.
    gate.position.lerpVectors(scratch.start, scratch.end, GATE_POSITION);
    gate.quaternion.copy(camera.quaternion);

    // Pulsos: indo = ação; voltando = dados; barrado = para no losango e pisca em vermelho.
    let gateBlocked = 0;
    let slot = 0;
    for (const pulse of runtime.snapshot.pulses) {
      if (pulse.satelliteId !== satellite.id || slot >= PULSES_PER_WIRE) continue;
      const frame = pulseFrame(pulse, runtime.now);
      if (frame === null) continue;
      const mesh = pulseRefs.current[slot];
      const material = materials.pulses[slot];
      slot++;
      if (mesh === null || mesh === undefined || material === undefined) continue;
      mesh.visible = true;
      mesh.position.lerpVectors(scratch.start, scratch.end, frame.position);
      mesh.quaternion.copy(camera.quaternion);
      const blink = frame.stoppedAtGate ? 0.6 + 0.4 * Math.cos(runtime.now / 60) : 1;
      material.color.copy(pulse.kind === 'blocked' ? red : white);
      material.opacity = frame.intensity * blink;
      mesh.scale.setScalar(frame.stoppedAtGate ? 1.6 : 1);
      if (frame.stoppedAtGate) gateBlocked = Math.max(gateBlocked, frame.intensity * blink);
    }
    for (let i = slot; i < PULSES_PER_WIRE; i++) {
      const mesh = pulseRefs.current[i];
      if (mesh) mesh.visible = false;
    }
    materials.gate.color.copy(silver).lerp(red, Math.min(1, gateBlocked * 1.5));
    materials.gate.opacity = Math.max(0.75 * fade, gateBlocked);
    gate.scale.setScalar(1 + 0.9 * gateBlocked);

    // Rótulo HTML acompanhando o satélite na tela.
    const label = labels.get(satellite.id);
    if (label !== undefined) {
      scratch.projected.copy(scratch.satellite).project(camera);
      const sx = (scratch.projected.x * 0.5 + 0.5) * size.width;
      const sy = (-scratch.projected.y * 0.5 + 0.5) * size.height;
      label.style.transform = `translate(${sx.toFixed(1)}px, ${(sy + 22).toFixed(1)}px) translateX(-50%)`;
      label.style.opacity = fade.toFixed(2);
    }
  });

  return (
    <>
      <primitive object={wire} />
      <mesh ref={gateRef} geometry={geometry.gate} material={materials.gate} />
      {materials.pulses.map((material, i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            pulseRefs.current[i] = mesh;
          }}
          geometry={geometry.pulse}
          material={material}
          visible={false}
        />
      ))}
      <group ref={groupRef}>
        <mesh geometry={geometry.node} material={materials.node} />
        <mesh geometry={geometry.ringInner} material={materials.ring} />
        {satellite.access === 'read_write' && <mesh geometry={geometry.ringOuter} material={materials.ring} />}
      </group>
    </>
  );
}

/** Contas conectadas em órbita (anel simples = só leitura; anel duplo = leitura e escrita). */
export function Satellites({ satellites, labels }: { satellites: readonly Satellite[]; labels: LabelRegistry }) {
  const geometry = useSharedGeometry();
  return (
    <>
      {satellites.map((satellite, index) => (
        <SatelliteNode
          key={satellite.id}
          satellite={satellite}
          index={index}
          count={satellites.length}
          geometry={geometry}
          labels={labels}
        />
      ))}
    </>
  );
}
