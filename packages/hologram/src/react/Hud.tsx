import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { Color } from 'three';
import { palette } from '../palette';
import { filledTicks, spendLevel } from '../visual';
import { setColorUniform, setUniform, useRing } from './HudRing';
import { useRuntime } from './runtime';

export const CONTEXT_TICKS = 100;

/**
 * Anéis do HUD (docs/08-holograma.md, seção 8.2):
 * contorno tracejado = limite de contexto; marcas = % do contexto; arcos = atividade; anel de gasto.
 */
export function Hud({ showSpend }: { showSpend: boolean }) {
  const runtime = useRuntime();

  const limit = useRing({ inner: 1.05, outer: 1.062, dashes: 90, colorOn: palette.silverDark, opacityOn: 0.75, feather: 0.4 });
  const ticks = useRing({
    inner: 1.2,
    outer: 1.29,
    ticks: CONTEXT_TICKS,
    tickDuty: 0.32,
    colorOn: palette.silver,
    colorOff: palette.silverDark,
    opacityOn: 0.95,
    opacityOff: 0.16,
    feather: 0.1,
  });
  const arcA = useRing({ inner: 1.355, outer: 1.37, arcStart: 0.05, arcLength: 0.17, opacityOn: 0.55, feather: 0.4 });
  const arcB = useRing({ inner: 1.385, outer: 1.392, arcStart: 0.55, arcLength: 0.09, opacityOn: 0.4, feather: 0.4 });
  const arcC = useRing({ inner: 1.12, outer: 1.128, arcStart: 0.3, arcLength: 0.24, opacityOn: 0.35, feather: 0.4 });
  const spend = useRing({
    inner: 1.47,
    outer: 1.484,
    colorOn: palette.silver,
    colorOff: palette.silverDark,
    opacityOn: 0.55,
    opacityOff: 0.08,
    feather: 0.3,
  });

  const spendColors = useMemo(
    () => ({ normal: new Color(palette.silver), warning: new Color(palette.amber), exceeded: new Color(palette.red) }),
    [],
  );

  useFrame(() => {
    const v = runtime.visual;
    const fade = (1 - v.gray * 0.55) * (1 - v.dim * 0.6);

    setUniform(limit.material, 'uOpacity', fade);
    setUniform(ticks.material, 'uFillTicks', filledTicks(v.contextRatio, CONTEXT_TICKS));
    setUniform(ticks.material, 'uOpacity', fade);

    setUniform(arcA.material, 'uRotation', runtime.ringAngle);
    setUniform(arcB.material, 'uRotation', -runtime.ringAngle * 1.6);
    setUniform(arcC.material, 'uRotation', runtime.ringAngle * 2.3);
    for (const arc of [arcA, arcB, arcC]) setUniform(arc.material, 'uOpacity', fade * (0.6 + 0.4 * Math.min(1, v.ringSpin * 3)));

    setUniform(spend.material, 'uFill', v.spendRatio);
    setColorUniform(spend.material, 'uColorOn', spendColors[spendLevel(runtime.snapshot.spend)]);
    setUniform(spend.material, 'uOpacity', fade);
  });

  return (
    <group>
      <mesh geometry={limit.geometry} material={limit.material} />
      <mesh geometry={ticks.geometry} material={ticks.material} />
      <mesh geometry={arcA.geometry} material={arcA.material} />
      <mesh geometry={arcB.geometry} material={arcB.material} />
      <mesh geometry={arcC.geometry} material={arcC.material} />
      {showSpend && <mesh geometry={spend.geometry} material={spend.material} />}
    </group>
  );
}
