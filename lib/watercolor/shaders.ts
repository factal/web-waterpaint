export const FULLSCREEN_VERTEX = `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const ZERO_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.0);
}
`

export const SPLAT_COMMON = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSource;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uFlow;
float splatFalloff(vec2 uv, float radius) {
  vec2 delta = uv - uCenter;
  float r = max(radius, 1e-6);
  return exp(-9.0 * dot(delta, delta) / (r * r + 1e-6));
}
`

export const SPLAT_PIGMENT_FRAGMENT = `
${SPLAT_COMMON}
uniform float uToolType;
uniform vec3 uPigment;
void main() {
  vec4 src = texture(uSource, vUv);
  float fall = splatFalloff(vUv, uRadius);
  float pigmentMask = step(0.5, uToolType);
  vec3 add = uPigment * (uFlow * fall * pigmentMask);
  fragColor = vec4(src.rgb + add, src.a);
}
`

export const SPLAT_BINDER_FRAGMENT = `
${SPLAT_COMMON}
uniform float uToolType;
uniform float uBinderStrength;
void main() {
  vec4 src = texture(uSource, vUv);
  float fall = splatFalloff(vUv, uRadius);
  float mask = step(0.5, uToolType);
  float add = uBinderStrength * uFlow * fall * mask;
  fragColor = vec4(src.r + add, 0.0, 0.0, 1.0);
}
`

const createLbmFragment = (body: string, group: number) => `#define LBM_GROUP ${group}\n${body}`

const LBM_CONSTANTS = `
const float W0 = 4.0 / 9.0;
const float W_AXIS = 1.0 / 9.0;
const float W_DIAG = 1.0 / 36.0;
const vec2 C1 = vec2(1.0, 0.0);
const vec2 C2 = vec2(0.0, 1.0);
const vec2 C3 = vec2(-1.0, 0.0);
const vec2 C4 = vec2(0.0, -1.0);
const vec2 C5 = vec2(1.0, 1.0);
const vec2 C6 = vec2(-1.0, 1.0);
const vec2 C7 = vec2(-1.0, -1.0);
const vec2 C8 = vec2(1.0, -1.0);

float computeEq(float weight, float rho, float dotCU, float uSq) {
  return weight * rho * (1.0 + 3.0 * dotCU + 4.5 * dotCU * dotCU - 1.5 * uSq);
}
`

const LBM_SPLAT_BASE = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uF2;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uFlow;
uniform float uToolType;
uniform vec2 uTexel;
${LBM_CONSTANTS}
vec2 uvFromCoord(ivec2 coord, ivec2 size) {
  return (vec2(coord) + vec2(0.5)) / vec2(size);
}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 data0 = texelFetch(uF0, coord, 0);
  vec4 data1 = texelFetch(uF1, coord, 0);
  vec4 data2 = texelFetch(uF2, coord, 0);
  float f0 = data0.x;
  float f1 = data0.y;
  float f2 = data0.z;
  float f3 = data0.w;
  float f4 = data1.x;
  float f5 = data1.y;
  float f6 = data1.z;
  float f7 = data1.w;
  float f8 = data2.x;
  float rho = max(f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8, 1e-6);
  vec2 momentum = vec2(
    f1 - f3 + f5 - f6 - f7 + f8,
    f2 - f4 + f5 + f6 - f7 - f8
  );
  vec2 vel = momentum / rho;
  ivec2 size = textureSize(uF0, 0);
  vec2 uvCoord = uvFromCoord(coord, size);
  vec2 delta = uvCoord - uCenter;
  float r = max(uRadius, 1e-6);
  float fall = exp(-9.0 * dot(delta, delta) / (r * r + 1e-6));
  float waterMul = mix(1.0, 0.7, step(0.5, uToolType));
  rho = max(rho + waterMul * uFlow * fall, 1e-6);
  float dist = length(delta);
  if (dist > 1e-6) {
    vec2 dir = delta / dist;
    vel += dir * (0.7 * uFlow * fall);
  }
  float uSq = dot(vel, vel);
  float dot1 = dot(C1, vel);
  float dot2 = dot(C2, vel);
  float dot3 = dot(C3, vel);
  float dot4 = dot(C4, vel);
  float dot5 = dot(C5, vel);
  float dot6 = dot(C6, vel);
  float dot7 = dot(C7, vel);
  float dot8 = dot(C8, vel);
  float eq0 = computeEq(W0, rho, 0.0, uSq);
  float eq1 = computeEq(W_AXIS, rho, dot1, uSq);
  float eq2 = computeEq(W_AXIS, rho, dot2, uSq);
  float eq3 = computeEq(W_AXIS, rho, dot3, uSq);
  float eq4 = computeEq(W_AXIS, rho, dot4, uSq);
  float eq5 = computeEq(W_DIAG, rho, dot5, uSq);
  float eq6 = computeEq(W_DIAG, rho, dot6, uSq);
  float eq7 = computeEq(W_DIAG, rho, dot7, uSq);
  float eq8 = computeEq(W_DIAG, rho, dot8, uSq);
#if LBM_GROUP == 0
  fragColor = vec4(eq0, eq1, eq2, eq3);
#elif LBM_GROUP == 1
  fragColor = vec4(eq4, eq5, eq6, eq7);
#else
  fragColor = vec4(eq8, 0.0, 0.0, 1.0);
#endif
}
`

export const LBM_SPLAT_FRAGMENTS = [
  createLbmFragment(LBM_SPLAT_BASE, 0),
  createLbmFragment(LBM_SPLAT_BASE, 1),
  createLbmFragment(LBM_SPLAT_BASE, 2),
] as const

export const LBM_FORCE_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uHeight;
uniform sampler2D uBinder;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform float uGrav;
uniform float uViscosity;
uniform float uBinderElasticity;
uniform float uBinderViscosity;
uniform float uBinderBuoyancy;
void main() {
  vec2 texel = uTexel;
  float hL = texture(uHeight, vUv - vec2(texel.x, 0.0)).r;
  float hR = texture(uHeight, vUv + vec2(texel.x, 0.0)).r;
  float hB = texture(uHeight, vUv - vec2(0.0, texel.y)).r;
  float hT = texture(uHeight, vUv + vec2(0.0, texel.y)).r;
  float hC = texture(uHeight, vUv).r;
  vec2 gradH = vec2(hR - hL, hT - hB) * 0.5;
  float bL = texture(uBinder, vUv - vec2(texel.x, 0.0)).r;
  float bR = texture(uBinder, vUv + vec2(texel.x, 0.0)).r;
  float bB = texture(uBinder, vUv - vec2(0.0, texel.y)).r;
  float bT = texture(uBinder, vUv + vec2(0.0, texel.y)).r;
  float bC = texture(uBinder, vUv).r;
  vec2 gradB = vec2(bR - bL, bT - bB) * 0.5;
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 force = vec2(0.0);
  force -= uGrav * gradH;
  force += uBinderElasticity * gradB;
  force -= clamp(uViscosity, 0.0, 4.0) * vel;
  force -= uBinderViscosity * bC * vel;
  force.y += uBinderBuoyancy * bC;
  float rawFilm = max(hC, 0.0);
  float thinFilm = clamp(rawFilm, 0.0, 1.0);
  const float densityThreshold = 1e-3;
  float filmMask = step(densityThreshold, rawFilm);
  force *= mix(0.3, 1.0, thinFilm) * thinFilm * filmMask;
  fragColor = vec4(force, 0.0, 1.0);
}
`

const LBM_COLLISION_BASE = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uF2;
uniform sampler2D uForce;
uniform float uVisc;
uniform float uDt;
${LBM_CONSTANTS}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 data0 = texelFetch(uF0, coord, 0);
  vec4 data1 = texelFetch(uF1, coord, 0);
  vec4 data2 = texelFetch(uF2, coord, 0);
  float f0 = data0.x;
  float f1 = data0.y;
  float f2 = data0.z;
  float f3 = data0.w;
  float f4 = data1.x;
  float f5 = data1.y;
  float f6 = data1.z;
  float f7 = data1.w;
  float f8 = data2.x;
  float rawRho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  float rho = max(rawRho, 1e-6);
  const float densityThreshold = 1e-3;
  vec2 force = texture(uForce, vUv).xy;
  vec2 momentum = vec2(
    f1 - f3 + f5 - f6 - f7 + f8,
    f2 - f4 + f5 + f6 - f7 - f8
  );
  if (rawRho < densityThreshold) {
    f0 = 0.0;
    f1 = 0.0;
    f2 = 0.0;
    f3 = 0.0;
    f4 = 0.0;
    f5 = 0.0;
    f6 = 0.0;
    f7 = 0.0;
    f8 = 0.0;
  } else {
    vec2 vel = momentum / rho;
    vec2 accel = force * uDt / rho;
    vel += 0.5 * accel;
    float uSq = dot(vel, vel);
    float dot1 = dot(C1, vel);
    float dot2 = dot(C2, vel);
    float dot3 = dot(C3, vel);
    float dot4 = dot(C4, vel);
    float dot5 = dot(C5, vel);
    float dot6 = dot(C6, vel);
    float dot7 = dot(C7, vel);
    float dot8 = dot(C8, vel);
    float eq0 = computeEq(W0, rho, 0.0, uSq);
    float eq1 = computeEq(W_AXIS, rho, dot1, uSq);
    float eq2 = computeEq(W_AXIS, rho, dot2, uSq);
    float eq3 = computeEq(W_AXIS, rho, dot3, uSq);
    float eq4 = computeEq(W_AXIS, rho, dot4, uSq);
    float eq5 = computeEq(W_DIAG, rho, dot5, uSq);
    float eq6 = computeEq(W_DIAG, rho, dot6, uSq);
    float eq7 = computeEq(W_DIAG, rho, dot7, uSq);
    float eq8 = computeEq(W_DIAG, rho, dot8, uSq);
    float tau = max(0.51, 0.5 + 3.0 * max(uVisc, 0.0));
    float omega = 1.0 / tau;
    float forceScale = (1.0 - 0.5 * omega) * uDt;
    float uDotF = dot(vel, force);
    float force0 = W0 * forceScale * (-3.0 * uDotF);
    float force1 = W_AXIS * forceScale * (3.0 * dot(C1, force) + 9.0 * dot1 * dot(C1, force) - 3.0 * uDotF);
    float force2 = W_AXIS * forceScale * (3.0 * dot(C2, force) + 9.0 * dot2 * dot(C2, force) - 3.0 * uDotF);
    float force3 = W_AXIS * forceScale * (3.0 * dot(C3, force) + 9.0 * dot3 * dot(C3, force) - 3.0 * uDotF);
    float force4 = W_AXIS * forceScale * (3.0 * dot(C4, force) + 9.0 * dot4 * dot(C4, force) - 3.0 * uDotF);
    float force5 = W_DIAG * forceScale * (3.0 * dot(C5, force) + 9.0 * dot5 * dot(C5, force) - 3.0 * uDotF);
    float force6 = W_DIAG * forceScale * (3.0 * dot(C6, force) + 9.0 * dot6 * dot(C6, force) - 3.0 * uDotF);
    float force7 = W_DIAG * forceScale * (3.0 * dot(C7, force) + 9.0 * dot7 * dot(C7, force) - 3.0 * uDotF);
    float force8 = W_DIAG * forceScale * (3.0 * dot(C8, force) + 9.0 * dot8 * dot(C8, force) - 3.0 * uDotF);
    f0 += omega * (eq0 - f0) + force0;
    f1 += omega * (eq1 - f1) + force1;
    f2 += omega * (eq2 - f2) + force2;
    f3 += omega * (eq3 - f3) + force3;
    f4 += omega * (eq4 - f4) + force4;
    f5 += omega * (eq5 - f5) + force5;
    f6 += omega * (eq6 - f6) + force6;
    f7 += omega * (eq7 - f7) + force7;
    f8 += omega * (eq8 - f8) + force8;
  }
  f0 = max(f0, 0.0);
  f1 = max(f1, 0.0);
  f2 = max(f2, 0.0);
  f3 = max(f3, 0.0);
  f4 = max(f4, 0.0);
  f5 = max(f5, 0.0);
  f6 = max(f6, 0.0);
  f7 = max(f7, 0.0);
  f8 = max(f8, 0.0);
#if LBM_GROUP == 0
  fragColor = vec4(f0, f1, f2, f3);
#elif LBM_GROUP == 1
  fragColor = vec4(f4, f5, f6, f7);
#else
  fragColor = vec4(f8, 0.0, 0.0, 1.0);
#endif
}
`

export const LBM_COLLISION_FRAGMENTS = [
  createLbmFragment(LBM_COLLISION_BASE, 0),
  createLbmFragment(LBM_COLLISION_BASE, 1),
  createLbmFragment(LBM_COLLISION_BASE, 2),
] as const

const LBM_STREAMING_BASE = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uF2;
ivec2 clampCoord(ivec2 coord, ivec2 size) {
  return ivec2(clamp(coord.x, 0, size.x - 1), clamp(coord.y, 0, size.y - 1));
}
void main() {
  ivec2 size = textureSize(uF0, 0);
  ivec2 coord = ivec2(gl_FragCoord.xy);
  float f0 = texelFetch(uF0, coord, 0).x;
  ivec2 fromEast = clampCoord(coord - ivec2(1, 0), size);
  ivec2 fromNorth = clampCoord(coord - ivec2(0, 1), size);
  ivec2 fromWest = clampCoord(coord + ivec2(1, 0), size);
  ivec2 fromSouth = clampCoord(coord + ivec2(0, 1), size);
  ivec2 fromNE = clampCoord(coord - ivec2(1, 1), size);
  ivec2 fromNW = clampCoord(coord + ivec2(1, -1), size);
  ivec2 fromSW = clampCoord(coord + ivec2(1, 1), size);
  ivec2 fromSE = clampCoord(coord + ivec2(-1, 1), size);
  float f1 = texelFetch(uF0, fromEast, 0).y;
  float f2 = texelFetch(uF0, fromNorth, 0).z;
  float f3 = texelFetch(uF0, fromWest, 0).w;
  float f4 = texelFetch(uF1, fromSouth, 0).x;
  float f5 = texelFetch(uF1, fromNE, 0).y;
  float f6 = texelFetch(uF1, fromNW, 0).z;
  float f7 = texelFetch(uF1, fromSW, 0).w;
  float f8 = texelFetch(uF2, fromSE, 0).x;
#if LBM_GROUP == 0
  fragColor = vec4(f0, f1, f2, f3);
#elif LBM_GROUP == 1
  fragColor = vec4(f4, f5, f6, f7);
#else
  fragColor = vec4(f8, 0.0, 0.0, 1.0);
#endif
}
`

export const LBM_STREAMING_FRAGMENTS = [
  createLbmFragment(LBM_STREAMING_BASE, 0),
  createLbmFragment(LBM_STREAMING_BASE, 1),
  createLbmFragment(LBM_STREAMING_BASE, 2),
] as const
const LBM_MATCH_BASE = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uF2;
uniform sampler2D uState;
uniform sampler2D uNewDensity;
${LBM_CONSTANTS}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 data0 = texelFetch(uF0, coord, 0);
  vec4 data1 = texelFetch(uF1, coord, 0);
  vec4 data2 = texelFetch(uF2, coord, 0);
  float f0 = data0.x;
  float f1 = data0.y;
  float f2 = data0.z;
  float f3 = data0.w;
  float f4 = data1.x;
  float f5 = data1.y;
  float f6 = data1.z;
  float f7 = data1.w;
  float f8 = data2.x;
  float rhoOld = texture(uState, vUv).z;
  float rhoNew = max(texture(uNewDensity, vUv).r, 0.0);
  if (rhoNew <= 1e-6) {
    f0 = 0.0;
    f1 = 0.0;
    f2 = 0.0;
    f3 = 0.0;
    f4 = 0.0;
    f5 = 0.0;
    f6 = 0.0;
    f7 = 0.0;
    f8 = 0.0;
  } else if (rhoOld <= 1e-6) {
    float uSq = 0.0;
    float eq0 = computeEq(W0, rhoNew, 0.0, uSq);
    float eqAxis = computeEq(W_AXIS, rhoNew, 0.0, uSq);
    float eqDiag = computeEq(W_DIAG, rhoNew, 0.0, uSq);
    f0 = eq0;
    f1 = eqAxis;
    f2 = eqAxis;
    f3 = eqAxis;
    f4 = eqAxis;
    f5 = eqDiag;
    f6 = eqDiag;
    f7 = eqDiag;
    f8 = eqDiag;
  } else {
    float scale = clamp(rhoNew / max(rhoOld, 1e-6), 0.0, 12.0);
    f0 *= scale;
    f1 *= scale;
    f2 *= scale;
    f3 *= scale;
    f4 *= scale;
    f5 *= scale;
    f6 *= scale;
    f7 *= scale;
    f8 *= scale;
  }
#if LBM_GROUP == 0
  fragColor = vec4(f0, f1, f2, f3);
#elif LBM_GROUP == 1
  fragColor = vec4(f4, f5, f6, f7);
#else
  fragColor = vec4(f8, 0.0, 0.0, 1.0);
#endif
}
`

export const LBM_MATCH_FRAGMENTS = [
  createLbmFragment(LBM_MATCH_BASE, 0),
  createLbmFragment(LBM_MATCH_BASE, 1),
  createLbmFragment(LBM_MATCH_BASE, 2),
] as const

export const LBM_MACROSCOPIC_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uF2;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 data0 = texelFetch(uF0, coord, 0);
  vec4 data1 = texelFetch(uF1, coord, 0);
  vec4 data2 = texelFetch(uF2, coord, 0);
  float f0 = data0.x;
  float f1 = data0.y;
  float f2 = data0.z;
  float f3 = data0.w;
  float f4 = data1.x;
  float f5 = data1.y;
  float f6 = data1.z;
  float f7 = data1.w;
  float f8 = data2.x;
  float rho = max(f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8, 1e-6);
  vec2 vel = vec2(
    f1 - f3 + f5 - f6 - f7 + f8,
    f2 - f4 + f5 + f6 - f7 - f8
  ) / rho;
  fragColor = vec4(vel, rho, 1.0);
}
`

export const LBM_DENSITY_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uState;
void main() {
  float rho = texture(uState, vUv).z;
  fragColor = vec4(max(rho, 0.0), 0.0, 0.0, 1.0);
}
`

export const ADVECT_PIGMENT_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPigment;
uniform sampler2D uVelocity;
uniform float uDt;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 back = vUv - uDt * vel;
  vec4 sample_color = texture(uPigment, back);
  fragColor = vec4(max(sample_color.rgb, vec3(0.0)), sample_color.a);
}
`

export const PIGMENT_DIFFUSION_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPigment;
uniform vec2 uTexel;
uniform float uDiffusion;
uniform float uDt;

vec3 sampleRGB(vec2 uv) {
  return texture(uPigment, uv).rgb;
}

void main() {
  vec4 center = texture(uPigment, vUv);
  vec2 du = vec2(uTexel.x, 0.0);
  vec2 dv = vec2(0.0, uTexel.y);
  vec3 left = sampleRGB(vUv - du);
  vec3 right = sampleRGB(vUv + du);
  vec3 bottom = sampleRGB(vUv - dv);
  vec3 top = sampleRGB(vUv + dv);
  vec3 laplacian = left + right + top + bottom - 4.0 * center.rgb;
  vec3 diffused = center.rgb + uDiffusion * laplacian * uDt;
  fragColor = vec4(max(diffused, vec3(0.0)), center.a);
}
`

export const ADVECT_BINDER_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uBinder;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDiffusion;
uniform float uDecay;

float sampleBinder(vec2 coord) {
  return texture(uBinder, coord).r;
}

void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 back = vUv - uDt * vel;
  float binder = texture(uBinder, back).r;
  float left = sampleBinder(vUv - vec2(uTexel.x, 0.0));
  float right = sampleBinder(vUv + vec2(uTexel.x, 0.0));
  float bottom = sampleBinder(vUv - vec2(0.0, uTexel.y));
  float top = sampleBinder(vUv + vec2(0.0, uTexel.y));
  float lap = left + right + top + bottom - 4.0 * binder;
  binder += uDiffusion * lap * uDt;
  binder = max(binder - uDecay * uDt, 0.0);
  fragColor = vec4(binder, 0.0, 0.0, 1.0);
}
`
export const ABSORB_COMMON = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uHeight;
uniform sampler2D uPigment;
uniform sampler2D uWet;
uniform sampler2D uDeposits;
uniform sampler2D uSettled;
uniform float uAbsorb;
uniform float uEvap;
uniform float uEdge;
uniform float uDepBase;
uniform float uBeta;
uniform float uAbsorbTime;
uniform float uAbsorbTimeOffset;
uniform float uAbsorbFloor;
uniform float uHumidity;
uniform float uSettle;
uniform float uGranStrength;
uniform float uBackrunStrength;
uniform vec2 uTexel;

struct AbsorbResult {
  float newH;
  float newWet;
  vec3 pigment;
  vec3 dep;
  vec3 settled;
};

AbsorbResult computeAbsorb(vec2 uv) {
  AbsorbResult res;
  float h = texture(uHeight, uv).r;
  vec3 pigment = texture(uPigment, uv).rgb;
  float wet = texture(uWet, uv).r;
  vec3 dep = texture(uDeposits, uv).rgb;
  vec3 settled = texture(uSettled, uv).rgb;

  vec2 du = vec2(uTexel.x, 0.0);
  vec2 dv = vec2(0.0, uTexel.y);
  float hx = texture(uHeight, uv + du).r - texture(uHeight, uv - du).r;
  float hy = texture(uHeight, uv + dv).r - texture(uHeight, uv - dv).r;
  float edgeBias = uEdge * 0.5 * sqrt(hx * hx + hy * hy);

  float wL = texture(uWet, uv - du).r;
  float wR = texture(uWet, uv + du).r;
  float wB = texture(uWet, uv - dv).r;
  float wT = texture(uWet, uv + dv).r;
  float outwardDiff = max(wet - wL, 0.0) + max(wet - wR, 0.0) + max(wet - wB, 0.0) + max(wet - wT, 0.0);
  float edgeAdvance = max(outwardDiff * 0.25 - 0.05, 0.0);
  float bloomFactor = clamp(uBackrunStrength * edgeAdvance, 0.0, 1.0) * step(1e-5, h);

  float humidity = clamp(1.0 - wet, 0.0, 1.0);
  float humidityFactor = pow(humidity, uBeta);
  float timeTerm = max(uAbsorbTime + uAbsorbTimeOffset, 1e-4);
  float decay = inversesqrt(timeTerm);
  float baseAbsorb = max(uAbsorb * decay, uAbsorbFloor);
  float absorbAmount = baseAbsorb * humidityFactor;
  float evapBase = uEvap * sqrt(max(h, 0.0));
  float evapRate = evapBase * mix(1.0, humidity, uHumidity);
  float totalOut = absorbAmount + evapRate;

  float newH = max(h - totalOut, 0.0);
  float remRaw = totalOut / max(h, 1e-6);
  if (h <= 1e-6) {
    remRaw = 1.0;
  }
  float remFrac = clamp(min(1.0, remRaw), 0.0, 1.0);
  float depFrac = clamp(remFrac * (0.5 + edgeBias) + uDepBase * edgeBias, 0.0, 1.0);
  vec3 depAdd = pigment * depFrac;
  dep += depAdd;
  pigment = max(pigment - depAdd, vec3(0.0));

  vec3 bloomDep = pigment * bloomFactor;
  dep += bloomDep;
  pigment = max(pigment - bloomDep, vec3(0.0));

  float settleRate = clamp(uSettle, 0.0, 1.0);
  vec3 settleAdd = pigment * settleRate;
  pigment = max(pigment - settleAdd, vec3(0.0));
  vec3 settledNew = settled + settleAdd;

  float granCoeff = clamp(uGranStrength * edgeBias, 0.0, 1.0);
  vec3 granSource = pigment + settledNew;
  vec3 granDep = granSource * granCoeff;
  vec3 totalSource = max(granSource, vec3(1e-5));
  vec3 fromPigment = granDep * (pigment / totalSource);
  vec3 fromSettled = granDep * (settledNew / totalSource);
  pigment = max(pigment - fromPigment, vec3(0.0));
  settledNew = max(settledNew - fromSettled, vec3(0.0));
  dep += granDep;

  float newWet = clamp(wet + absorbAmount, 0.0, 1.0);

  res.newH = newH;
  res.newWet = newWet;
  res.pigment = pigment;
  res.dep = dep;
  res.settled = settledNew;
  return res;
}
`

export const ABSORB_DEPOSIT_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.dep, 1.0);
}
`

export const ABSORB_HEIGHT_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.newH, 0.0, 0.0, 1.0);
}
`

export const ABSORB_PIGMENT_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.pigment, 1.0);
}
`

export const ABSORB_WET_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.newWet, 0.0, 0.0, 1.0);
}
`

export const ABSORB_SETTLED_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.settled, 1.0);
}
`

export const PAPER_DIFFUSION_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uWet;
uniform sampler2D uFiber;
uniform vec2 uTexel;
uniform float uDt;
uniform float uReplenish;
uniform float uStrength;
void main() {
  vec4 fiber = texture(uFiber, vUv);
  vec2 dir = fiber.xy;
  if (dot(dir, dir) < 1e-6) {
    dir = vec2(1.0, 0.0);
  } else {
    dir = normalize(dir);
  }
  vec2 dirTex = dir * uTexel;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 perpTex = perp * uTexel;

  float w = texture(uWet, vUv).r;
  float wParaPlus = texture(uWet, vUv + dirTex).r;
  float wParaMinus = texture(uWet, vUv - dirTex).r;
  float wPerpPlus = texture(uWet, vUv + perpTex).r;
  float wPerpMinus = texture(uWet, vUv - perpTex).r;

  float dPara = fiber.z;
  float dPerp = fiber.w;
  float lap = dPara * (wParaPlus - 2.0 * w + wParaMinus) + dPerp * (wPerpPlus - 2.0 * w + wPerpMinus);
  float diffusion = uStrength * lap;
  float replenish = uReplenish * (1.0 - w);
  float newW = clamp(w + uDt * (diffusion + replenish), 0.0, 1.0);
  fragColor = vec4(newW, 0.0, 0.0, 1.0);
}
`

export const COMPOSITE_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uDeposits;
uniform vec3 uPaper;
uniform vec3 uK[3];
uniform vec3 uS[3];
uniform float uLayerScale;

vec3 infiniteLayer(vec3 K, vec3 S) {
  vec3 safeS = max(S, vec3(1e-3));
  vec3 r = 1.0 + K / safeS;
  vec3 disc = max(r * r - vec3(1.0), vec3(0.0));
  return clamp(r - sqrt(disc), vec3(0.0), vec3(1.0));
}

void main() {
  vec3 dep = texture(uDeposits, vUv).rgb;
  vec3 K = dep.r * uK[0] + dep.g * uK[1] + dep.b * uK[2];
  vec3 S = vec3(0.4) + dep.r * uS[0] + dep.g * uS[1] + dep.b * uS[2];
  float density = dot(dep, vec3(1.0));
  float layerK = 1.0 + uLayerScale * density;
  float layerS = 1.0 + 0.5 * uLayerScale * density;
  vec3 R = infiniteLayer(K * layerK, S * layerS);
  vec3 col = clamp(R * uPaper, vec3(0.0), vec3(1.0));
  fragColor = vec4(col, 1.0);
}
`

export const VELOCITY_MAX_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform vec2 uTexel;

float velocityMag(vec2 coord) {
  vec2 vel = texture(uVelocity, coord).xy;
  return length(vel);
}

void main() {
  vec2 halfStep = 0.5 * uTexel;
  float m = velocityMag(vUv);
  m = max(m, velocityMag(vUv + vec2(-halfStep.x, -halfStep.y)));
  m = max(m, velocityMag(vUv + vec2(halfStep.x, -halfStep.y)));
  m = max(m, velocityMag(vUv + vec2(-halfStep.x, halfStep.y)));
  m = max(m, velocityMag(vUv + vec2(halfStep.x, halfStep.y)));
  fragColor = vec4(m, 0.0, 0.0, 1.0);
}
`
