import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { describeSnapshot } from '../describe';
import { qualitySettings } from '../geometry';
import type { QualityLevel } from '../geometry';
import type { HologramSnapshot } from '../model';
import { palette } from '../palette';
import { computeTargets, initialVisualState } from '../visual';
import { RuntimeContext } from './runtime';
import type { HologramRuntime } from './runtime';
import { Scene } from './Scene';
import type { LabelRegistry } from './Satellites';

export type QualityPreference = 'auto' | QualityLevel;

export interface HologramProps {
  snapshot: HologramSnapshot;
  /** `auto` começa no completo e cai para o leve se a taxa de quadros não aguentar ou se estiver na bateria. */
  quality?: QualityPreference;
  /** `mini`: sem satélites, sem rótulos, sem estrelas e sem anel de gasto (modo mini, docs/08-holograma.md, seção 8.5). */
  variant?: 'full' | 'mini';
  /** Amplitude do áudio da fala (0..1). Sem isso, usa uma fala sintética. */
  audioLevel?: () => number;
  onFps?: (fps: number) => void;
  onQualityChange?: (level: QualityLevel) => void;
  className?: string;
  style?: CSSProperties;
}

const LOW_FPS = 42;
const LOW_FPS_SECONDS = 3;

function createRuntime(snapshot: HologramSnapshot): HologramRuntime {
  const targets = computeTargets(snapshot);
  return {
    snapshot,
    targets,
    visual: initialVisualState(targets),
    time: 0,
    now: 0,
    sphereAngle: 0,
    coreAngle: 0,
    ringAngle: 0,
    orbitAngle: 0,
    audio: 0,
    reducedMotion: false,
    freshStars: 0,
    freshFrom: 0,
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
}

/** `true` quando o aparelho informa que está na bateria (API não padronizada; ausente = `false`). */
function useOnBattery(): boolean {
  const [onBattery, setOnBattery] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (typeof nav.getBattery !== 'function') return;
    let battery: BatteryManagerLike | null = null;
    let cancelled = false;
    const update = () => {
      if (battery !== null) setOnBattery(!battery.charging);
    };
    nav
      .getBattery()
      .then((b) => {
        if (cancelled) return;
        battery = b;
        update();
        b.addEventListener('chargingchange', update);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      battery?.removeEventListener('chargingchange', update);
    };
  }, []);
  return onBattery;
}

export function Hologram({
  snapshot,
  quality = 'auto',
  variant = 'full',
  audioLevel,
  onFps,
  onQualityChange,
  className,
  style,
}: HologramProps) {
  // Estado mutável da animação, fora do ciclo de renderização do React (ver runtime.ts).
  const [runtime] = useState(() => createRuntime(snapshot));
  const [labels] = useState<LabelRegistry>(() => new Map());
  const reducedMotion = usePrefersReducedMotion();
  const visible = usePageVisible();
  const onBattery = useOnBattery();

  const [autoLevel, setAutoLevel] = useState<QualityLevel>('full');
  const lowSeconds = useRef(0);
  const level: QualityLevel = quality === 'auto' ? (onBattery ? 'light' : autoLevel) : quality;
  const settings = useMemo(() => qualitySettings(level), [level]);

  useLayoutEffect(() => {
    runtime.snapshot = snapshot;
    runtime.targets = computeTargets(snapshot);
  }, [runtime, snapshot]);

  useEffect(() => {
    runtime.reducedMotion = reducedMotion;
  }, [runtime, reducedMotion]);

  useEffect(() => {
    onQualityChange?.(level);
  }, [level, onQualityChange]);

  const handleFps = useCallback(
    (fps: number) => {
      onFps?.(fps);
      if (quality !== 'auto') return;
      lowSeconds.current = fps < LOW_FPS ? lowSeconds.current + 1 : 0;
      if (lowSeconds.current >= LOW_FPS_SECONDS) setAutoLevel('light');
    },
    [onFps, quality],
  );

  const description = useMemo(() => describeSnapshot(snapshot).join(' '), [snapshot]);

  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: variant === 'full' ? palette.background : 'transparent',
    ...style,
  };

  return (
    <div className={className} style={containerStyle} role="img" aria-label={description}>
      {/* O contexto WebGL é criado uma vez; trocar de variante (transparência) exige um Canvas novo. */}
      <Canvas
        key={variant}
        dpr={[1, settings.maxPixelRatio]}
        frameloop={visible ? 'always' : 'never'}
        gl={{ antialias: false, alpha: variant === 'mini', powerPreference: 'high-performance' }}
        camera={{ fov: 40, near: 0.1, far: 60, position: [0, 0, 6.4] }}
      >
        <RuntimeContext.Provider value={runtime}>
          {variant === 'full' && <color attach="background" args={[palette.background]} />}
          <Scene
            quality={settings}
            satellites={snapshot.satellites}
            labels={labels}
            variant={variant}
            audioLevel={audioLevel}
            onFps={handleFps}
          />
        </RuntimeContext.Provider>
      </Canvas>

      {variant === 'full' && (
        <div aria-hidden="true" style={overlayStyle}>
          {snapshot.satellites.map((satellite) => (
            <div
              key={satellite.id}
              ref={(element) => {
                if (element) labels.set(satellite.id, element);
                else labels.delete(satellite.id);
              }}
              style={labelStyle}
            >
              {satellite.label}
            </div>
          ))}
        </div>
      )}

      {snapshot.deviceCode !== null && (
        <div aria-hidden="true" style={deviceCodeStyle}>
          <div style={deviceCodeTextStyle}>{snapshot.deviceCode}</div>
          {variant === 'full' && <div style={deviceCodeHintStyle}>digite este código na página oficial de login</div>}
        </div>
      )}
    </div>
  );
}

const overlayStyle: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };

const labelStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  color: palette.silver,
  font: '500 11px/1 ui-monospace, "Cascadia Mono", Consolas, monospace',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  textShadow: '0 0 8px rgba(211, 220, 230, 0.6)',
  willChange: 'transform',
};

const deviceCodeStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  pointerEvents: 'none',
};

const deviceCodeTextStyle: CSSProperties = {
  color: palette.core,
  font: '600 clamp(28px, 6vw, 56px)/1 ui-monospace, "Cascadia Mono", Consolas, monospace',
  letterSpacing: '0.18em',
  textShadow: '0 0 18px rgba(211, 220, 230, 0.9), 0 0 42px rgba(211, 220, 230, 0.45)',
};

const deviceCodeHintStyle: CSSProperties = {
  color: palette.silverDark,
  font: '500 12px/1.3 ui-monospace, "Cascadia Mono", Consolas, monospace',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};
