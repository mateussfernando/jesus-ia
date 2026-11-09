/**
 * Shaders GLSL do holograma. As deformações ficam no vertex shader, controladas por uniforms
 * (docs/08-holograma.md, seção 8.6).
 */

/** Ruído simplex 3D (Ashima Arts / Stefan Gustavson, licença MIT). */
const simplexNoise = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}
`;

export const particleVertexShader = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uBreath;
uniform float uBreathRate;
uniform float uSpeech;
uniform float uAudio;
uniform float uListen;
uniform float uThink;
uniform float uTurbulence;
uniform float uCompaction;
uniform float uTaint;
uniform float uPointSize;
uniform float uPixelRatio;

attribute float aSeed;

varying float vAlpha;
varying float vHot;
varying float vStatic;

${simplexNoise}

void main() {
  float t = uTime;
  float len = length(position);
  vec3 dir = len > 0.0001 ? position / len : vec3(0.0, 1.0, 0.0);

  // Respiração (ocioso, aguardando).
  float r = uRadius * (1.0 + uBreath * sin(t * 6.2831853 * uBreathRate + aSeed * 0.8));

  // Falando: a superfície ondula com a amplitude do áudio.
  float n = snoise(dir * 2.3 + vec3(0.0, t * 1.4, t * 0.6));
  float speech = uSpeech * uAudio * (0.17 * n + 0.06 * sin(dir.y * 11.0 - t * 9.0));

  // Ouvindo: ondas concêntricas na frente da esfera, vindo em direção ao centro.
  float front = smoothstep(0.1, 1.0, dir.z);
  float angular = acos(clamp(dir.z, -1.0, 1.0));
  float listen = uListen * front * 0.1 * sin(angular * 15.0 + t * 7.5);

  vec3 p = position * r * (1.0 + speech + listen);

  // Pensando: redemoinho por latitude.
  float swirl = uThink * 0.9 * sin(t * 1.1 + dir.y * 2.5) * dir.y;
  p.xz = rot2(swirl) * p.xz;

  // Executando: agitação.
  vec3 q = dir * 3.5 + vec3(t * 0.9);
  vec3 jitter = vec3(snoise(q), snoise(q + 17.1), snoise(q + 31.7));
  p += jitter * uTurbulence * 0.07 * uRadius;

  // Contaminação: chiado (tremor e cintilação aleatória).
  float frame = floor(t * 16.0);
  float flick = hash11(aSeed * 97.31 + frame);
  p += dir * (flick - 0.5) * uTaint * 0.07 * uRadius;
  vStatic = uTaint * step(1.0 - 0.6 * uTaint, hash11(aSeed * 13.7 + frame * 1.37));

  // Compactando: colapso em espiral para o núcleo.
  float c = smoothstep(0.0, 1.0, uCompaction);
  vec3 collapsed = p * (0.08 + 0.1 * aSeed);
  collapsed.xz = rot2(c * 6.0 * (1.0 - aSeed)) * collapsed.xz;
  p = mix(p, collapsed, c);

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Borda mais brilhante (efeito de holograma) e lado de trás mais apagado.
  vec3 nView = normalize(normalMatrix * dir);
  float rim = 1.0 - abs(nView.z);
  float back = smoothstep(-0.9, 0.4, nView.z);
  vAlpha = (0.32 + 0.68 * rim) * mix(0.45, 1.0, back) * (0.55 + 0.45 * aSeed);
  vHot = step(0.93, aSeed);

  float size = uPointSize * (0.55 + 0.9 * aSeed) * (1.0 + c * 0.6) * (1.0 + vStatic * 0.8);
  gl_PointSize = size * uPixelRatio * (6.0 / -mvPosition.z);
}
`;

export const particleFragmentShader = /* glsl */ `
uniform vec3 uBaseColor;
uniform vec3 uHotColor;
uniform vec3 uGrayColor;
uniform vec3 uAlertColor;
uniform float uAlertMix;
uniform float uGray;
uniform float uBrightness;
uniform float uDim;
uniform float uOpacity;

varying float vAlpha;
varying float vHot;
varying float vStatic;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  a *= a;

  vec3 color = mix(uBaseColor, uHotColor, vHot);
  color = mix(color, uAlertColor, uAlertMix * (1.0 - 0.35 * vHot));
  color = mix(color, uGrayColor, max(uGray, vStatic));
  color *= 1.0 - 0.35 * vStatic;

  // Chiado: as partículas "contaminadas" ficam cinza e piscam fora de fase com as outras.
  float alpha = a * vAlpha * uBrightness * (1.0 - uDim) * uOpacity * (1.0 - 0.25 * vStatic);
  gl_FragColor = vec4(color, alpha);
}
`;

/** Anéis do HUD num plano de frente para a câmera: marcas, tracejado, arcos e preenchimento. */
export const ringVertexShader = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ringFragmentShader = /* glsl */ `
uniform float uInner;
uniform float uOuter;
uniform float uTicks;
uniform float uTickDuty;
uniform float uDashes;
uniform float uFill;
uniform float uFillTicks;
uniform float uArcStart;
uniform float uArcLength;
uniform float uRotation;
uniform vec3 uColorOn;
uniform vec3 uColorOff;
uniform float uOpacityOn;
uniform float uOpacityOff;
uniform float uFeather;
uniform float uOpacity;

varying vec2 vPos;

void main() {
  // Ângulo a partir do topo, no sentido horário (0..1).
  float u = fract(atan(vPos.x, vPos.y) / 6.2831853 + 1.0);
  float ur = fract(u - uRotation / 6.2831853 + 1.0);

  float arcU = fract(ur - uArcStart + 1.0);
  float inArc = uArcLength >= 1.0 ? 1.0 : step(arcU, uArcLength);

  float pattern = 1.0;
  if (uTicks > 0.0) pattern *= step(fract(ur * uTicks), uTickDuty);
  if (uDashes > 0.0) pattern *= step(fract(ur * uDashes), 0.5);

  float filled;
  if (uTicks > 0.0) filled = step(floor(u * uTicks) + 0.5, uFillTicks);
  else filled = step(u, uFill);

  float rr = (length(vPos) - uInner) / max(0.0001, uOuter - uInner);
  float edge = smoothstep(0.0, uFeather, rr) * smoothstep(1.0, 1.0 - uFeather, rr);

  vec3 color = mix(uColorOff, uColorOn, filled);
  float alpha = mix(uOpacityOff, uOpacityOn, filled) * pattern * inArc * edge * uOpacity;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

/** Estrelas do fundo: cada memória acende uma; as novas aparecem com um brilho. */
export const starVertexShader = /* glsl */ `
uniform float uTime;
uniform float uVisible;
uniform float uPixelRatio;
uniform float uFreshFrom;
uniform float uFresh;
attribute float aIndex;
attribute float aSeed;
varying float vAlpha;

void main() {
  float born = clamp(uVisible - aIndex, 0.0, 1.0);
  float fresh = uFresh * step(uFreshFrom - 0.5, aIndex);
  float twinkle = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed * 1.7) + aSeed * 40.0);
  vAlpha = born * twinkle * (0.35 + 0.65 * aSeed) * (1.0 + fresh * 1.5);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = (1.5 + aSeed * 2.0 + fresh * 3.0) * uPixelRatio;
}
`;

export const starFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
}
`;
