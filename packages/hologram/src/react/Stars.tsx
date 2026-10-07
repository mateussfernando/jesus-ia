import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import { particleSeeds, starfield } from '../geometry';
import { MAX_MEMORY_STARS } from '../model';
import { palette } from '../palette';
import { starFragmentShader, starVertexShader } from '../shaders';
import { setUniform } from './HudRing';
import { useRuntime } from './runtime';

/** Fundo de estrelas: cada memória de longo prazo acende uma (docs/08-holograma.md, seção 8.2). */
export function Stars() {
  const runtime = useRuntime();
  const pixelRatio = useThree((state) => state.viewport.dpr);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const index = new Float32Array(MAX_MEMORY_STARS);
    for (let i = 0; i < MAX_MEMORY_STARS; i++) index[i] = i;
    g.setAttribute('position', new BufferAttribute(starfield(MAX_MEMORY_STARS, 7), 3));
    g.setAttribute('aIndex', new BufferAttribute(index, 1));
    g.setAttribute('aSeed', new BufferAttribute(particleSeeds(MAX_MEMORY_STARS, 11), 1));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: starVertexShader,
        fragmentShader: starFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uVisible: { value: 0 },
          uPixelRatio: { value: 1 },
          uFreshFrom: { value: 0 },
          uFresh: { value: 0 },
          uColor: { value: new Color(palette.silver) },
          uOpacity: { value: 1 },
        },
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const visible = Math.min(MAX_MEMORY_STARS, runtime.snapshot.memoryCount);
    const current = material.uniforms.uVisible?.value as number;
    // As estrelas novas acendem aos poucos.
    setUniform(material, 'uVisible', current + (visible - current) * 0.04);
    setUniform(material, 'uTime', runtime.time);
    setUniform(material, 'uPixelRatio', pixelRatio);
    setUniform(material, 'uFreshFrom', runtime.freshFrom);
    setUniform(material, 'uFresh', runtime.freshStars);
    setUniform(material, 'uOpacity', 1 - runtime.visual.gray * 0.6);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
