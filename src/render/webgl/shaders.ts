// GLSL ES 3.00 sources. Kept as template strings so the build has zero asset fetches
// (YouTube Playables bundles must be self-contained).

const HEADER = /* glsl */ `#version 300 es
precision highp float;
`;

/** Curved-world bend shared by every world-space vertex shader (mirrored on the CPU in Camera.project). */
const BEND = /* glsl */ `
uniform vec3 uCamPos;
uniform vec2 uCurve;
vec3 bend(vec3 p) {
  float dz = p.z - uCamPos.z;
  float d2 = dz * dz;
  return vec3(p.x + d2 * uCurve.x, p.y - d2 * uCurve.y, p.z);
}
`;

const FOG = /* glsl */ `
uniform vec3 uFogColor;
uniform vec2 uFogRange;
vec3 applyFog(vec3 col, vec3 world) {
  float f = smoothstep(uFogRange.x, uFogRange.y, distance(world, uCamPos));
  return mix(col, uFogColor, f);
}
`;

// ---------------------------------------------------------------- full-screen triangle

export const FULLSCREEN_VS = HEADER + /* glsl */ `
out vec2 vUv;
void main() {
  // Single oversized triangle from gl_VertexID: no vertex buffer needed.
  vec2 p = vec2(float((gl_VertexID & 1) << 2), float((gl_VertexID & 2) << 1));
  vUv = p * 0.5;
  gl_Position = vec4(p - 1.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- sky

export const SKY_FS = HEADER + /* glsl */ `
in vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform float uSunY;
uniform float uSunR;
uniform vec3 uTop;
uniform vec3 uHorizon;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec3 col = mix(uHorizon, uTop, smoothstep(0.25, 1.0, uv.y));

  // Twinkling star field on a jittered grid.
  vec2 g = uv * vec2(uAspect, 1.0) * 70.0;
  vec2 cell = floor(g);
  float h = hash(cell);
  vec2 star = cell + 0.5 + (vec2(hash(cell + 7.1), hash(cell + 3.3)) - 0.5) * 0.7;
  float d = length(g - star);
  float tw = 0.5 + 0.5 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
  col += step(0.93, h) * smoothstep(0.12, 0.0, d) * tw * smoothstep(0.45, 0.8, uv.y) * 1.4;

  // Retro striped sun.
  vec2 sp = vec2((uv.x - 0.5) * uAspect, uv.y - uSunY);
  float r = length(sp);
  float disc = 1.0 - smoothstep(uSunR - 0.005, uSunR, r);
  float sy = sp.y * 0.26 / uSunR; // stripe layout normalised to the sun's size
  float band = fract(sy * 24.0 + uTime * 0.35);
  float gap = clamp(-sy * 3.2, 0.0, 0.75);
  float mask = sp.y > 0.0 ? 1.0 : step(gap, band);
  vec3 sunCol = mix(vec3(1.0, 0.1, 0.5), vec3(1.0, 0.82, 0.2), smoothstep(-0.25, 0.25, sy));
  col = mix(col, sunCol * 0.7, disc * mask); // kept under the bloom threshold so it stays saturated
  col += vec3(1.0, 0.3, 0.6) * exp(-r * 5.0) * 0.25;

  outColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- ground

export const GROUND_VS = HEADER + BEND + /* glsl */ `
layout(location = 0) in vec2 aXZ;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec2 vFlat;
void main() {
  vFlat = aXZ;
  vWorld = bend(vec3(aXZ.x, 0.0, aXZ.y));
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`;

export const GROUND_FS = HEADER + BEND + FOG + /* glsl */ `
in vec3 vWorld;
in vec2 vFlat;
uniform float uScroll;   // distance travelled, pre-wrapped on the CPU to keep fract() precise
uniform float uLaneWidth;
uniform vec3 uLaneColor;
uniform vec3 uGridColor;
uniform vec3 uPlayer;    // x, height, shield(0/1)
uniform float uPulse;
out vec4 outColor;

// Anti-aliased grid line using screen-space derivatives.
float gridLine(float c, float thickness) {
  float fw = fwidth(c);
  float g = abs(fract(c - 0.5) - 0.5);
  return 1.0 - smoothstep(thickness, thickness + fw * 1.5, g);
}

void main() {
  float x = vFlat.x;
  float z = vFlat.y - uScroll;
  float halfTrack = uLaneWidth * 1.5;
  float ax = abs(x);
  float onTrack = 1.0 - smoothstep(halfTrack, halfTrack + 0.05, ax);

  float cross = gridLine(z / 4.0, 0.025);
  float dashes = step(0.45, fract(z / 3.0));
  float divider = gridLine((x - uLaneWidth * 0.5) / uLaneWidth, 0.012) * dashes * step(ax, halfTrack - 0.2);
  float edge = exp(-abs(ax - halfTrack) * 18.0);
  float outer = max(gridLine(x / 6.0, 0.02), gridLine(z / 6.0, 0.02)) * (1.0 - onTrack);

  vec3 col = mix(vec3(0.03, 0.005, 0.06), vec3(0.015, 0.01, 0.04), onTrack);
  col += onTrack * uLaneColor * (divider * 0.9 + cross * 0.3 * (0.8 + uPulse));
  col += uLaneColor * edge * 2.2;
  col += uGridColor * outer * (0.55 + uPulse * 0.4);

  // Soft glow pool under the ship that fades as it jumps.
  vec3 glowCol = mix(uLaneColor, vec3(0.45, 1.0, 0.45), uPlayer.z);
  float d = length(vec2(x - uPlayer.x, vFlat.y * 0.8));
  col += glowCol * exp(-d * 1.6) * 0.7 / (1.0 + uPlayer.y * 1.5);

  outColor = vec4(applyFog(col, vWorld), 1.0);
}
`;

// ---------------------------------------------------------------- instanced boxes

export const BOX_VS = HEADER + BEND + /* glsl */ `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 iPos;
layout(location = 3) in vec3 iRot;
layout(location = 4) in vec3 iScale;
layout(location = 5) in vec4 iColor;   // rgb + glow
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vLocal;
out vec3 vScale;
out vec4 vColor;
out vec3 vWorld;

// Euler rotation applied X -> Y -> Z (mirrors rotateXYZ in core/math.ts).
vec3 rotate(vec3 p, vec3 r) {
  float c = cos(r.x), s = sin(r.x);
  p = vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
  c = cos(r.y); s = sin(r.y);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  c = cos(r.z); s = sin(r.z);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

void main() {
  vLocal = aPos;
  vScale = iScale;
  vColor = iColor;
  vNormal = rotate(aNormal, iRot);
  vWorld = bend(rotate(aPos * iScale, iRot) + iPos);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`;

export const BOX_FS = HEADER + BEND + FOG + /* glsl */ `
in vec3 vNormal;
in vec3 vLocal;
in vec3 vScale;
in vec4 vColor;
in vec3 vWorld;
uniform float uTime;
out vec4 outColor;

void main() {
  // Distance (in world units) from this fragment to each pair of faces. On any face one
  // component is ~0, so the middle value is the distance to the nearest edge.
  vec3 d = (0.5 - abs(vLocal)) * vScale;
  float mn = min(d.x, min(d.y, d.z));
  float mx = max(d.x, max(d.y, d.z));
  float mid = d.x + d.y + d.z - mn - mx;
  float edge = 1.0 - smoothstep(0.025, 0.085, mid);
  float halo = exp(-mid * 9.0) * 0.35;

  vec3 N = normalize(vNormal);
  vec3 L = normalize(vec3(0.35, 0.9, 0.4));
  vec3 V = normalize(uCamPos - vWorld);
  float diff = 0.35 + 0.65 * max(dot(N, L), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float scan = 0.5 + 0.5 * sin(vWorld.y * 14.0 - uTime * 5.0);

  vec3 base = vColor.rgb;
  vec3 col = base * (0.13 * diff + 0.06 * scan);
  col += base * (edge * (1.0 + vColor.a * 1.6) + halo + rim * 0.45);

  outColor = vec4(applyFog(col, vWorld), 1.0);
}
`;

// ---------------------------------------------------------------- particles

export const PARTICLE_VS = HEADER + BEND + /* glsl */ `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aSize;
uniform mat4 uViewProj;
uniform float uPointScale;
out vec4 vColor;
void main() {
  vec4 clip = uViewProj * vec4(bend(aPos), 1.0);
  gl_Position = clip;
  gl_PointSize = clamp(aSize * uPointScale / max(clip.w, 0.1), 1.0, 96.0);
  vColor = aColor;
}
`;

export const PARTICLE_FS = HEADER + /* glsl */ `
in vec4 vColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = 1.0 - dot(c, c);
  if (a <= 0.0) discard;
  outColor = vec4(vColor.rgb * vColor.a * a * a * 1.8, 1.0);
}
`;

// ---------------------------------------------------------------- post-processing

/** Bright pass + 2x downsample with a 4-tap box filter. */
export const BRIGHT_FS = HEADER + /* glsl */ `
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2( 0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2(-0.5,  0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  outColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.6, l), 1.0);
}
`;

/** Separable 9-tap Gaussian using bilinear taps (5 fetches). */
export const BLUR_FS = HEADER + /* glsl */ `
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir; // texel-sized step along one axis
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(c, 1.0);
}
`;

export const COMPOSITE_FS = HEADER + /* glsl */ `
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uAberration;
uniform float uFlash;
uniform vec3 uFlashColor;
out vec4 outColor;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 dir = vUv - 0.5;
  vec2 off = dir * uAberration;
  vec3 col = vec3(
    texture(uScene, vUv + off).r,
    texture(uScene, vUv).g,
    texture(uScene, vUv - off).b
  );
  col += texture(uBloom, vUv).rgb * uBloomStrength;
  col = aces(col * 1.1);
  col *= mix(1.0, smoothstep(0.95, 0.35, length(dir)), 0.55);   // vignette
  col *= 0.97 + 0.03 * sin(gl_FragCoord.y * 3.14159);           // subtle scanlines
  col = mix(col, uFlashColor, uFlash);
  outColor = vec4(col, 1.0);
}
`;
