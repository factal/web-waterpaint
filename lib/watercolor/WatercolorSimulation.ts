import * as THREE from 'three'

// GPU-driven watercolor solver combining shallow-water flow, pigment transport, and paper optics.
export type BrushType = 'water' | 'pigment'

export interface BrushSettings {
  center: [number, number]
  radius: number
  flow: number
  type: BrushType
  color: [number, number, number]
}

export interface BinderParams {
  injection: number
  diffusion: number
  decay: number
  elasticity: number
  viscosity: number
  buoyancy: number
}

export interface SimulationParams {
  grav: number
  visc: number
  absorb: number
  evap: number
  edge: number
  stateAbsorption: boolean
  granulation: boolean
  backrunStrength: number
  cfl: number
  maxSubsteps: number
  binder: BinderParams
  reservoir: {
    waterCapacityWater: number
    waterCapacityPigment: number
    pigmentCapacity: number
    waterConsumption: number
    pigmentConsumption: number
    stampSpacing: number
  }
}

// Convenience wrapper for render targets that alternate between read/write.
type PingPongTarget = {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
  swap: () => void
}

// Shared GLSL utilities for the screen-space simulation steps.
const FULLSCREEN_VERTEX = `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const ZERO_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.0);
}
`

const SPLAT_COMMON = `
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

const SPLAT_HEIGHT_FRAGMENT = `
${SPLAT_COMMON}
uniform float uToolType;
void main() {
  vec4 src = texture(uSource, vUv);
  float fall = splatFalloff(vUv, uRadius);
  float waterMul = mix(1.0, 0.7, step(0.5, uToolType));
  src.r += waterMul * uFlow * fall;
  fragColor = vec4(src.r, 0.0, 0.0, 1.0);
}
`

const SPLAT_VELOCITY_FRAGMENT = `
${SPLAT_COMMON}
void main() {
  vec4 src = texture(uSource, vUv);
  vec2 delta = vUv - uCenter;
  float fall = splatFalloff(vUv, uRadius);
  float len = length(delta);
  vec2 dir = len > 1e-6 ? delta / len : vec2(0.0);
  vec2 dv = dir * (0.7 * uFlow * fall);
  fragColor = vec4(src.xy + dv, 0.0, 1.0);
}
`

const SPLAT_PIGMENT_FRAGMENT = `
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

const SPLAT_BINDER_FRAGMENT = `
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

const ADVECT_VELOCITY_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uHeight;
uniform sampler2D uVelocity;
uniform float uDt;
uniform float uGrav;
uniform float uVisc;
uniform vec2 uTexel;
vec2 sampleGrad(vec2 uv) {
  float hm = texture(uHeight, uv - vec2(uTexel.x, 0.0)).r;
  float hp = texture(uHeight, uv + vec2(uTexel.x, 0.0)).r;
  float hm2 = texture(uHeight, uv - vec2(0.0, uTexel.y)).r;
  float hp2 = texture(uHeight, uv + vec2(0.0, uTexel.y)).r;
  return vec2((hp - hm) * 0.5, (hp2 - hm2) * 0.5);
}
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 grad = sampleGrad(vUv);
  vel += -uDt * uGrav * grad;
  vel *= (1.0 - uVisc * uDt);
  fragColor = vec4(vel, 0.0, 1.0);
}
`

const ADVECT_HEIGHT_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uHeight;
uniform sampler2D uVelocity;
uniform sampler2D uBinder;
uniform float uDt;
uniform float uBinderBuoyancy;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 back = vUv - uDt * vel;
  vec4 sample_color = texture(uHeight, back);
  float binder = texture(uBinder, vUv).r;
  float newH = max(sample_color.r + uBinderBuoyancy * binder * uDt, 0.0);
  fragColor = vec4(newH, 0.0, 0.0, 1.0);
}
`

const ADVECT_PIGMENT_FRAGMENT = `
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

const PIGMENT_DIFFUSION_FRAGMENT = `
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

const ADVECT_BINDER_FRAGMENT = `
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

const BINDER_FORCE_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uBinder;
uniform vec2 uTexel;
uniform float uDt;
uniform float uElasticity;
uniform float uViscosity;

vec2 binderGradient(vec2 uv) {
  float left = texture(uBinder, uv - vec2(uTexel.x, 0.0)).r;
  float right = texture(uBinder, uv + vec2(uTexel.x, 0.0)).r;
  float bottom = texture(uBinder, uv - vec2(0.0, uTexel.y)).r;
  float top = texture(uBinder, uv + vec2(0.0, uTexel.y)).r;
  return vec2(right - left, top - bottom) * 0.5;
}

void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  float binder = texture(uBinder, vUv).r;
  vec2 grad = binderGradient(vUv);
  vec2 springForce = -uElasticity * grad;
  vel += springForce * uDt;
  float damping = clamp(uViscosity * binder * uDt, 0.0, 0.95);
  vel *= (1.0 - damping);
  fragColor = vec4(vel, 0.0, 1.0);
}
`

const ABSORB_COMMON = `
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
  float absorbRate = uAbsorb * pow(humidity, uBeta);
  float evapBase = uEvap * sqrt(max(h, 0.0));
  float evapRate = evapBase * mix(1.0, humidity, uHumidity);
  float totalOut = absorbRate + evapRate;

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

  float newWet = clamp(wet + absorbRate, 0.0, 1.0);

  res.newH = newH;
  res.newWet = newWet;
  res.pigment = pigment;
  res.dep = dep;
  res.settled = settledNew;
  return res;
}
`;

const VELOCITY_MAX_FRAGMENT = `
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
`;

const ABSORB_DEPOSIT_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.dep, 1.0);
}
`;

const ABSORB_HEIGHT_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.newH, 0.0, 0.0, 1.0);
}
`;

const ABSORB_PIGMENT_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.pigment, 1.0);
}
`;

const ABSORB_WET_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.newWet, 0.0, 0.0, 1.0);
}
`;

const ABSORB_SETTLED_FRAGMENT = `
${ABSORB_COMMON}
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.settled, 1.0);
}
`;

const PRESSURE_DIVERGENCE_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float left = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float right = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float top = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  float divergence = 0.5 * ((right - left) + (top - bottom));
  fragColor = vec4(divergence, 0.0, 0.0, 1.0);
}
`;

const PRESSURE_JACOBI_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main() {
  float left = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).r;
  float right = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).r;
  float bottom = texture(uPressure, vUv - vec2(0.0, uTexel.y)).r;
  float top = texture(uPressure, vUv + vec2(0.0, uTexel.y)).r;
  float divergence = texture(uDivergence, vUv).r;
  float pressure = (left + right + top + bottom - divergence) * 0.25;
  fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

const PRESSURE_PROJECT_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uPressure;
uniform vec2 uTexel;
void main() {
  float left = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).r;
  float right = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).r;
  float bottom = texture(uPressure, vUv - vec2(0.0, uTexel.y)).r;
  float top = texture(uPressure, vUv + vec2(0.0, uTexel.y)).r;
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 gradient = vec2(right - left, top - bottom) * 0.5;
  vec2 projected = vel - gradient;
  fragColor = vec4(projected, 0.0, 1.0);
}
`;
const PAPER_DIFFUSION_FRAGMENT = `

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
`;
const COMPOSITE_FRAGMENT = `
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
`;

// Tunable constants describing the paper model and numerical scheme.
const DEFAULT_DT = 1 / 90
const DEPOSITION_BASE = 0.02
const PAPER_COLOR = new THREE.Vector3(0.92, 0.91, 0.88)
const PAPER_DIFFUSION_STRENGTH = 6.0
const PIGMENT_DIFFUSION_COEFF = 0.08
const KM_LAYER_SCALE = 1.4
const ABSORB_EXPONENT = 1.4
const HUMIDITY_INFLUENCE = 0.6
const GRANULATION_SETTLE_RATE = 0.28
const GRANULATION_STRENGTH = 0.45
const PIGMENT_K = [
  new THREE.Vector3(1.6, 0.1, 0.1),
  new THREE.Vector3(0.1, 1.4, 0.15),
  new THREE.Vector3(0.05, 0.1, 1.2),
] as const
const PIGMENT_S = [
  new THREE.Vector3(0.5, 0.55, 0.6),
  new THREE.Vector3(0.55, 0.45, 0.5),
  new THREE.Vector3(0.6, 0.55, 0.35),
] as const

export const DEFAULT_BINDER_PARAMS: BinderParams = {
  injection: 0.65,
  diffusion: 0.12,
  decay: 0.08,
  elasticity: 1.25,
  viscosity: 0.65,
  buoyancy: 0.12,
}

// Cache RawShaderMaterials reused across simulation passes.
type MaterialMap = {
  zero: THREE.RawShaderMaterial
  splatHeight: THREE.RawShaderMaterial
  splatVelocity: THREE.RawShaderMaterial
  splatPigment: THREE.RawShaderMaterial
  splatBinder: THREE.RawShaderMaterial
  advectVelocity: THREE.RawShaderMaterial
  advectHeight: THREE.RawShaderMaterial
  advectPigment: THREE.RawShaderMaterial
  diffusePigment: THREE.RawShaderMaterial
  advectBinder: THREE.RawShaderMaterial
  binderForces: THREE.RawShaderMaterial
  absorbDeposit: THREE.RawShaderMaterial
  absorbHeight: THREE.RawShaderMaterial
  absorbPigment: THREE.RawShaderMaterial
  absorbWet: THREE.RawShaderMaterial
  absorbSettled: THREE.RawShaderMaterial
  diffuseWet: THREE.RawShaderMaterial
  composite: THREE.RawShaderMaterial
  divergence: THREE.RawShaderMaterial
  jacobi: THREE.RawShaderMaterial
  project: THREE.RawShaderMaterial
}

// Helper to build render targets with consistent filtering and wrapping.
function createRenderTarget(size: number, type: THREE.TextureDataType) {
  const target = new THREE.WebGLRenderTarget(size, size, {
    type,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  })
  target.texture.generateMipmaps = false
  target.texture.wrapS = THREE.ClampToEdgeWrapping
  target.texture.wrapT = THREE.ClampToEdgeWrapping
  target.texture.colorSpace = THREE.NoColorSpace
  return target
}

// Pair of render targets that can swap roles between passes.
function createPingPong(size: number, type: THREE.TextureDataType): PingPongTarget {
  const a = createRenderTarget(size, type)
  const b = createRenderTarget(size, type)
  return {
    read: a,
    write: b,
    swap() {
      const temp = this.read
      this.read = this.write
      this.write = temp
    },
  }
}

// Procedural paper fiber map introduces anisotropic wetness diffusion.
function createFiberField(size: number): THREE.DataTexture {
  const data = new Float32Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const nx = u - 0.5
      const ny = v - 0.5
      const swirl = Math.sin((nx + ny) * Math.PI * 4.0)
      const wave = Math.cos((nx * 6.0) - (ny * 5.0))
      const angle = Math.atan2(ny, nx + 1e-6) * 0.35 + swirl * 0.6
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)
      const dPara = 0.7 + 0.25 * wave
      const dPerp = 0.18 + 0.12 * Math.sin((nx - ny) * Math.PI * 6.0)
      data[idx + 0] = dirX
      data[idx + 1] = dirY
      data[idx + 2] = Math.max(0.2, dPara)
      data[idx + 3] = Math.max(0.05, dPerp)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
  return texture
}
// Construct a RawShaderMaterial using the shared fullscreen vertex shader.
function createMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial {
  const sanitizeShader = (code: string) => code.trimStart()

  return new THREE.RawShaderMaterial({
    uniforms,
    vertexShader: sanitizeShader(FULLSCREEN_VERTEX),
    fragmentShader: sanitizeShader(fragmentShader),
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
}

// WatercolorSimulation coordinates all render passes and exposes a simple API.
export default class WatercolorSimulation {
  private readonly renderer: THREE.WebGLRenderer
  private readonly size: number
  private readonly texelSize: THREE.Vector2
  private readonly targets: {
    H: PingPongTarget
    UV: PingPongTarget
    C: PingPongTarget
    B: PingPongTarget
    DEP: PingPongTarget
    W: PingPongTarget
    S: PingPongTarget
  }
  private readonly compositeTarget: THREE.WebGLRenderTarget
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>
  private readonly materials: MaterialMap
  private readonly fiberTexture: THREE.DataTexture
  private readonly pressure: PingPongTarget
  private readonly divergence: THREE.WebGLRenderTarget
  private readonly pressureIterations = 20
  private readonly velocityReductionTargets: THREE.WebGLRenderTarget[]
  private readonly velocityMaxMaterial: THREE.RawShaderMaterial
  private readonly velocityReadBuffer = new Float32Array(4)
  private binderSettings: BinderParams

  // Set up render targets, materials, and state needed for the solver.
  constructor(renderer: THREE.WebGLRenderer, size = 512) {
    if (!renderer.capabilities.isWebGL2) {
      throw new Error('WatercolorSimulation requires a WebGL2 context')
    }

    this.renderer = renderer
    this.size = size
    this.texelSize = new THREE.Vector2(1 / size, 1 / size)

    const textureType = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.FloatType

    this.targets = {
      H: createPingPong(size, textureType),
      UV: createPingPong(size, textureType),
      C: createPingPong(size, textureType),
      B: createPingPong(size, textureType),
      DEP: createPingPong(size, textureType),
      W: createPingPong(size, textureType),
      S: createPingPong(size, textureType),
    }
    this.compositeTarget = createRenderTarget(size, textureType)
    this.pressure = createPingPong(size, textureType)
    this.divergence = createRenderTarget(size, textureType)
    this.fiberTexture = createFiberField(size)

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.materials = this.createMaterials()

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materials.zero)
    this.scene.add(this.quad)

    this.velocityMaxMaterial = this.createVelocityMaxMaterial()
    this.velocityReductionTargets = this.createVelocityReductionTargets(size)
    this.binderSettings = { ...DEFAULT_BINDER_PARAMS }

    this.reset()
  }

  get outputTexture(): THREE.Texture {
    return this.compositeTarget.texture
  }

  // Inject water or pigment into the simulation at a given position.
  splat(brush: BrushSettings) {
    const { center, radius, flow, type, color } = brush
    const toolType = type === 'water' ? 0 : 1

    const splatHeight = this.materials.splatHeight
    splatHeight.uniforms.uSource.value = this.targets.H.read.texture
    splatHeight.uniforms.uCenter.value.set(center[0], center[1])
    splatHeight.uniforms.uRadius.value = radius
    splatHeight.uniforms.uFlow.value = flow
    splatHeight.uniforms.uToolType.value = toolType
    this.renderToTarget(splatHeight, this.targets.H.write)
    this.targets.H.swap()

    const splatVelocity = this.materials.splatVelocity
    splatVelocity.uniforms.uSource.value = this.targets.UV.read.texture
    splatVelocity.uniforms.uCenter.value.set(center[0], center[1])
    splatVelocity.uniforms.uRadius.value = radius
    splatVelocity.uniforms.uFlow.value = flow
    this.renderToTarget(splatVelocity, this.targets.UV.write)
    this.targets.UV.swap()


    const splatPigment = this.materials.splatPigment
    splatPigment.uniforms.uSource.value = this.targets.C.read.texture
    splatPigment.uniforms.uCenter.value.set(center[0], center[1])
    splatPigment.uniforms.uRadius.value = radius
    splatPigment.uniforms.uFlow.value = flow
    splatPigment.uniforms.uToolType.value = toolType
    splatPigment.uniforms.uPigment.value.set(color[0], color[1], color[2])
    this.renderToTarget(splatPigment, this.targets.C.write)
    this.targets.C.swap()

    const splatBinder = this.materials.splatBinder
    splatBinder.uniforms.uSource.value = this.targets.B.read.texture
    splatBinder.uniforms.uCenter.value.set(center[0], center[1])
    splatBinder.uniforms.uRadius.value = radius
    splatBinder.uniforms.uFlow.value = flow
    splatBinder.uniforms.uToolType.value = toolType
    splatBinder.uniforms.uBinderStrength.value = this.binderSettings.injection
    this.renderToTarget(splatBinder, this.targets.B.write)
    this.targets.B.swap()
  }

  // Run one simulation step using semi-Lagrangian advection and absorption.
  step(params: SimulationParams, dt = DEFAULT_DT) {
    const {
      grav,
      visc,
      absorb,
      evap,
      edge,
      stateAbsorption,
      granulation,
      backrunStrength,
      cfl,
      maxSubsteps,
      binder,
    } = params

    this.binderSettings = { ...binder }

    const substeps = this.determineSubsteps(cfl, maxSubsteps, dt)
    const substepDt = dt / substeps

    for (let i = 0; i < substeps; i += 1) {
      const advectBinder = this.materials.advectBinder
      advectBinder.uniforms.uBinder.value = this.targets.B.read.texture
      advectBinder.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectBinder.uniforms.uDt.value = substepDt
      advectBinder.uniforms.uDiffusion.value = binder.diffusion
      advectBinder.uniforms.uDecay.value = binder.decay
      this.renderToTarget(advectBinder, this.targets.B.write)
      this.targets.B.swap()

      const binderForces = this.materials.binderForces
      binderForces.uniforms.uVelocity.value = this.targets.UV.read.texture
      binderForces.uniforms.uBinder.value = this.targets.B.read.texture
      binderForces.uniforms.uDt.value = substepDt
      binderForces.uniforms.uElasticity.value = binder.elasticity
      binderForces.uniforms.uViscosity.value = binder.viscosity
      this.renderToTarget(binderForces, this.targets.UV.write)
      this.targets.UV.swap()

      const advectVel = this.materials.advectVelocity
      advectVel.uniforms.uHeight.value = this.targets.H.read.texture
      advectVel.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectVel.uniforms.uDt.value = substepDt
      advectVel.uniforms.uGrav.value = grav
      advectVel.uniforms.uVisc.value = visc
      this.renderToTarget(advectVel, this.targets.UV.write)
      this.targets.UV.swap()
      this.projectVelocity()

      const advectHeight = this.materials.advectHeight
      advectHeight.uniforms.uHeight.value = this.targets.H.read.texture
      advectHeight.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectHeight.uniforms.uBinder.value = this.targets.B.read.texture
      advectHeight.uniforms.uBinderBuoyancy.value = binder.buoyancy
      advectHeight.uniforms.uDt.value = substepDt
      this.renderToTarget(advectHeight, this.targets.H.write)
      this.targets.H.swap()

      const advectPigment = this.materials.advectPigment
      advectPigment.uniforms.uPigment.value = this.targets.C.read.texture
      advectPigment.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectPigment.uniforms.uDt.value = substepDt
      this.renderToTarget(advectPigment, this.targets.C.write)
      this.targets.C.swap()

      const diffusePigment = this.materials.diffusePigment
      diffusePigment.uniforms.uPigment.value = this.targets.C.read.texture
      diffusePigment.uniforms.uDiffusion.value = PIGMENT_DIFFUSION_COEFF
      diffusePigment.uniforms.uDt.value = substepDt
      this.renderToTarget(diffusePigment, this.targets.C.write)
      this.targets.C.swap()

      const absorbFactor = absorb * substepDt
      const evapFactor = evap * substepDt
      const edgeFactor = edge * substepDt
      const beta = stateAbsorption ? ABSORB_EXPONENT : 1.0
      const humidityInfluence = stateAbsorption ? HUMIDITY_INFLUENCE : 0.0
      const settleBase = granulation ? GRANULATION_SETTLE_RATE : 0.0
      const granStrength = granulation ? GRANULATION_STRENGTH : 0.0
      const settleFactor = settleBase * substepDt

      const absorbDeposit = this.materials.absorbDeposit
      this.assignAbsorbUniforms(absorbDeposit, absorbFactor, evapFactor, edgeFactor, settleFactor, beta, humidityInfluence, granStrength, backrunStrength)
      this.renderToTarget(absorbDeposit, this.targets.DEP.write)

      const absorbHeight = this.materials.absorbHeight
      this.assignAbsorbUniforms(absorbHeight, absorbFactor, evapFactor, edgeFactor, settleFactor, beta, humidityInfluence, granStrength, backrunStrength)
      this.renderToTarget(absorbHeight, this.targets.H.write)

      const absorbPigment = this.materials.absorbPigment
      this.assignAbsorbUniforms(absorbPigment, absorbFactor, evapFactor, edgeFactor, settleFactor, beta, humidityInfluence, granStrength, backrunStrength)
      this.renderToTarget(absorbPigment, this.targets.C.write)

      const absorbWet = this.materials.absorbWet
      this.assignAbsorbUniforms(absorbWet, absorbFactor, evapFactor, edgeFactor, settleFactor, beta, humidityInfluence, granStrength, backrunStrength)
      this.renderToTarget(absorbWet, this.targets.W.write)

      const absorbSettled = this.materials.absorbSettled
      this.assignAbsorbUniforms(absorbSettled, absorbFactor, evapFactor, edgeFactor, settleFactor, beta, humidityInfluence, granStrength, backrunStrength)
      this.renderToTarget(absorbSettled, this.targets.S.write)

      this.targets.DEP.swap()
      this.targets.H.swap()
      this.targets.C.swap()
      this.targets.W.swap()
      this.targets.S.swap()

      this.applyPaperDiffusion(substepDt, absorbFactor)
    }

    const composite = this.materials.composite
    composite.uniforms.uDeposits.value = this.targets.DEP.read.texture
    this.renderToTarget(composite, this.compositeTarget)
  }

  // Diffuse moisture along the paper fiber field to keep edges alive.
  private applyPaperDiffusion(dt: number, replenish: number) {
    const diffuse = this.materials.diffuseWet
    diffuse.uniforms.uWet.value = this.targets.W.read.texture
    diffuse.uniforms.uDt.value = dt
    diffuse.uniforms.uReplenish.value = replenish
    this.renderToTarget(diffuse, this.targets.W.write)
    this.targets.W.swap()
  }


  // Enforce incompressibility by solving a pressure Poisson equation.
  private projectVelocity() {
    const divergence = this.materials.divergence
    divergence.uniforms.uVelocity.value = this.targets.UV.read.texture
    this.renderToTarget(divergence, this.divergence)

    const zero = this.materials.zero
    this.renderToTarget(zero, this.pressure.read)
    this.renderToTarget(zero, this.pressure.write)

    const jacobi = this.materials.jacobi
    jacobi.uniforms.uDivergence.value = this.divergence.texture
    for (let i = 0; i < this.pressureIterations; i += 1) {
      jacobi.uniforms.uPressure.value = this.pressure.read.texture
      this.renderToTarget(jacobi, this.pressure.write)
      this.pressure.swap()
    }

    const project = this.materials.project
    project.uniforms.uVelocity.value = this.targets.UV.read.texture
    project.uniforms.uPressure.value = this.pressure.read.texture
    this.renderToTarget(project, this.targets.UV.write)
    this.targets.UV.swap()
  }

  // Clear all render targets so the canvas returns to a blank state.
  reset() {
    this.clearPingPong(this.targets.H)
    this.clearPingPong(this.targets.UV)
    this.clearPingPong(this.targets.C)
    this.clearPingPong(this.targets.B)
    this.clearPingPong(this.targets.DEP)
    this.clearPingPong(this.targets.W)
    this.clearPingPong(this.targets.S)
    this.clearPingPong(this.pressure)
    this.renderToTarget(this.materials.zero, this.divergence)
    this.renderToTarget(this.materials.zero, this.compositeTarget)
  }

  // Release GPU allocations when the simulation is no longer needed.
  dispose() {
    this.quad.geometry.dispose()
    Object.values(this.materials).forEach((mat) => mat.dispose())
    this.velocityMaxMaterial.dispose()
    this.clearTargets()
    this.fiberTexture.dispose()
    this.velocityReductionTargets.forEach((target) => target.dispose())
  }

  // Dispose both read/write targets to avoid leaking GPU textures.
  private clearTargets() {
    this.targets.H.read.dispose()
    this.targets.H.write.dispose()
    this.targets.UV.read.dispose()
    this.targets.UV.write.dispose()
    this.targets.C.read.dispose()
    this.targets.C.write.dispose()
    this.targets.B.read.dispose()
    this.targets.B.write.dispose()
    this.targets.DEP.read.dispose()
    this.targets.DEP.write.dispose()
    this.targets.W.read.dispose()
    this.targets.W.write.dispose()
    this.targets.S.read.dispose()
    this.targets.S.write.dispose()
    this.pressure.read.dispose()
    this.pressure.write.dispose()
    this.divergence.dispose()
    this.compositeTarget.dispose()
  }

  // Fill both buffers of a ping-pong target with zeros.
  private clearPingPong(target: PingPongTarget) {
    this.renderToTarget(this.materials.zero, target.read)
    this.renderToTarget(this.materials.zero, target.write)
  }

  // Render a fullscreen quad with the provided material into a target.
  private renderToTarget(material: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    const previousTarget = this.renderer.getRenderTarget()
    const previousAutoClear = this.renderer.autoClear

    this.renderer.autoClear = false
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(previousTarget)
    this.renderer.autoClear = previousAutoClear
  }

  // Build the shader materials backing every simulation pass.
  private createMaterials(): MaterialMap {
    const centerUniform = () => ({ value: new THREE.Vector2(0, 0) })
    const pigmentUniform = () => ({ value: new THREE.Vector3(0, 0, 0) })

    const zero = createMaterial(ZERO_FRAGMENT, {})

    const splatHeight = createMaterial(SPLAT_HEIGHT_FRAGMENT, {
      uSource: { value: null },
      uCenter: centerUniform(),
      uRadius: { value: 0 },
      uFlow: { value: 0 },
      uToolType: { value: 0 },
    })

    const splatVelocity = createMaterial(SPLAT_VELOCITY_FRAGMENT, {
      uSource: { value: null },
      uCenter: centerUniform(),
      uRadius: { value: 0 },
      uFlow: { value: 0 },
    })

    const splatPigment = createMaterial(SPLAT_PIGMENT_FRAGMENT, {
      uSource: { value: null },
      uCenter: centerUniform(),
      uRadius: { value: 0 },
      uFlow: { value: 0 },
      uToolType: { value: 0 },
      uPigment: pigmentUniform(),
    })

    const splatBinder = createMaterial(SPLAT_BINDER_FRAGMENT, {
      uSource: { value: null },
      uCenter: centerUniform(),
      uRadius: { value: 0 },
      uFlow: { value: 0 },
      uToolType: { value: 0 },
      uBinderStrength: { value: DEFAULT_BINDER_PARAMS.injection },
    })

    const advectVelocity = createMaterial(ADVECT_VELOCITY_FRAGMENT, {
      uHeight: { value: null },
      uVelocity: { value: null },
      uDt: { value: DEFAULT_DT },
      uGrav: { value: 0.9 },
      uVisc: { value: 0.02 },
      uTexel: { value: this.texelSize },
    })

    const advectHeight = createMaterial(ADVECT_HEIGHT_FRAGMENT, {
      uHeight: { value: null },
      uVelocity: { value: null },
      uBinder: { value: null },
      uDt: { value: DEFAULT_DT },
      uBinderBuoyancy: { value: DEFAULT_BINDER_PARAMS.buoyancy },
    })

    const advectPigment = createMaterial(ADVECT_PIGMENT_FRAGMENT, {
      uPigment: { value: null },
      uVelocity: { value: null },
      uDt: { value: DEFAULT_DT },
    })

    const diffusePigment = createMaterial(PIGMENT_DIFFUSION_FRAGMENT, {
      uPigment: { value: null },
      uTexel: { value: this.texelSize },
      uDiffusion: { value: PIGMENT_DIFFUSION_COEFF },
      uDt: { value: DEFAULT_DT },
    })

    const advectBinder = createMaterial(ADVECT_BINDER_FRAGMENT, {
      uBinder: { value: null },
      uVelocity: { value: null },
      uTexel: { value: this.texelSize },
      uDt: { value: DEFAULT_DT },
      uDiffusion: { value: DEFAULT_BINDER_PARAMS.diffusion },
      uDecay: { value: DEFAULT_BINDER_PARAMS.decay },
    })

    const binderForces = createMaterial(BINDER_FORCE_FRAGMENT, {
      uVelocity: { value: null },
      uBinder: { value: null },
      uTexel: { value: this.texelSize },
      uDt: { value: DEFAULT_DT },
      uElasticity: { value: DEFAULT_BINDER_PARAMS.elasticity },
      uViscosity: { value: DEFAULT_BINDER_PARAMS.viscosity },
    })

    const absorbUniforms = () => ({
      uHeight: { value: null },
      uPigment: { value: null },
      uWet: { value: null },
      uDeposits: { value: null },
      uSettled: { value: null },
      uAbsorb: { value: 0 },
      uEvap: { value: 0 },
      uEdge: { value: 0 },
      uDepBase: { value: DEPOSITION_BASE },
      uBeta: { value: ABSORB_EXPONENT },
      uHumidity: { value: HUMIDITY_INFLUENCE },
      uSettle: { value: 0 },
      uGranStrength: { value: GRANULATION_STRENGTH },
      uBackrunStrength: { value: 0 },
      uTexel: { value: this.texelSize },
    })

    const absorbDeposit = createMaterial(ABSORB_DEPOSIT_FRAGMENT, absorbUniforms())
    const absorbHeight = createMaterial(ABSORB_HEIGHT_FRAGMENT, absorbUniforms())
    const absorbPigment = createMaterial(ABSORB_PIGMENT_FRAGMENT, absorbUniforms())
    const absorbWet = createMaterial(ABSORB_WET_FRAGMENT, absorbUniforms())
    const absorbSettled = createMaterial(ABSORB_SETTLED_FRAGMENT, absorbUniforms())

    const diffuseWet = createMaterial(PAPER_DIFFUSION_FRAGMENT, {
      uWet: { value: null },
      uFiber: { value: this.fiberTexture },
      uTexel: { value: this.texelSize },
      uDt: { value: DEFAULT_DT },
      uReplenish: { value: 0 },
      uStrength: { value: PAPER_DIFFUSION_STRENGTH },
    })

    const divergence = createMaterial(PRESSURE_DIVERGENCE_FRAGMENT, {
      uVelocity: { value: null },
      uTexel: { value: this.texelSize },
    })

    const jacobi = createMaterial(PRESSURE_JACOBI_FRAGMENT, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexel: { value: this.texelSize },
    })

    const project = createMaterial(PRESSURE_PROJECT_FRAGMENT, {
      uVelocity: { value: null },
      uPressure: { value: null },
      uTexel: { value: this.texelSize },
    })

    const composite = createMaterial(COMPOSITE_FRAGMENT, {
      uDeposits: { value: null },
      uPaper: { value: PAPER_COLOR.clone() },
      uK: { value: PIGMENT_K.map((v) => v.clone()) },
      uS: { value: PIGMENT_S.map((v) => v.clone()) },
      uLayerScale: { value: KM_LAYER_SCALE },
    })

    return {
      zero,
      splatHeight,
      splatVelocity,
      splatPigment,
      splatBinder,
      advectVelocity,
      advectHeight,
      advectPigment,
      diffusePigment,
      advectBinder,
      binderForces,
      absorbDeposit,
      absorbHeight,
      absorbPigment,
      absorbWet,
      absorbSettled,
      diffuseWet,
      composite,
      divergence,
      jacobi,
      project,
    }
  }

  // Share the same uniform assignments across the different absorb passes.
  private assignAbsorbUniforms(material: THREE.RawShaderMaterial, absorb: number, evap: number, edge: number, settle: number, beta: number, humidity: number, granStrength: number, backrunStrength: number) {
    const uniforms = material.uniforms as Record<string, THREE.IUniform>
    uniforms.uHeight.value = this.targets.H.read.texture
    uniforms.uPigment.value = this.targets.C.read.texture
    uniforms.uWet.value = this.targets.W.read.texture
    uniforms.uDeposits.value = this.targets.DEP.read.texture
    if (uniforms.uSettled) uniforms.uSettled.value = this.targets.S.read.texture
    uniforms.uAbsorb.value = absorb
    uniforms.uEvap.value = evap
    uniforms.uEdge.value = edge
    uniforms.uDepBase.value = DEPOSITION_BASE
    if (uniforms.uBeta) uniforms.uBeta.value = beta
    if (uniforms.uHumidity) uniforms.uHumidity.value = humidity
    if (uniforms.uSettle) uniforms.uSettle.value = settle
    if (uniforms.uGranStrength) uniforms.uGranStrength.value = granStrength
    if (uniforms.uBackrunStrength) uniforms.uBackrunStrength.value = backrunStrength
  }

  private createVelocityMaxMaterial(): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      uniforms: {
        uVelocity: { value: null },
        uTexel: { value: this.texelSize.clone() },
      },
      vertexShader: FULLSCREEN_VERTEX.trimStart(),
      fragmentShader: VELOCITY_MAX_FRAGMENT.trimStart(),
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  }

  private createVelocityReductionTargets(size: number): THREE.WebGLRenderTarget[] {
    const targets: THREE.WebGLRenderTarget[] = []
    let currentSize = size
    while (currentSize > 1) {
      currentSize = Math.max(1, currentSize >> 1)
      const target = new THREE.WebGLRenderTarget(currentSize, currentSize, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        magFilter: THREE.NearestFilter,
        minFilter: THREE.NearestFilter,
      })
      target.texture.generateMipmaps = false
      target.texture.wrapS = THREE.ClampToEdgeWrapping
      target.texture.wrapT = THREE.ClampToEdgeWrapping
      target.texture.colorSpace = THREE.NoColorSpace
      targets.push(target)
    }
    return targets
  }

  private computeMaxVelocity(): number {
    if (this.velocityReductionTargets.length === 0) {
      return 0
    }

    let sourceTexture: THREE.Texture = this.targets.UV.read.texture
    let texelX = this.texelSize.x
    let texelY = this.texelSize.y
    const texelUniform = this.velocityMaxMaterial.uniforms.uTexel.value as THREE.Vector2

    for (let i = 0; i < this.velocityReductionTargets.length; i += 1) {
      const target = this.velocityReductionTargets[i]
      this.velocityMaxMaterial.uniforms.uVelocity.value = sourceTexture
      texelUniform.set(texelX, texelY)
      this.renderToTarget(this.velocityMaxMaterial, target)
      sourceTexture = target.texture
      texelX *= 2
      texelY *= 2
    }

    const finalTarget = this.velocityReductionTargets[this.velocityReductionTargets.length - 1]

    try {
      this.renderer.readRenderTargetPixels(finalTarget, 0, 0, 1, 1, this.velocityReadBuffer)
      return this.velocityReadBuffer[0]
    } catch {
      return 0
    }
  }

  private determineSubsteps(cfl: number, maxSubsteps: number, dt: number): number {
    const maxSteps = Math.max(1, Math.floor(maxSubsteps))
    if (cfl <= 0 || maxSteps <= 1) return 1

    const maxVelocity = this.computeMaxVelocity()
    if (maxVelocity <= 1e-6) return 1

    const dx = this.texelSize.x
    const maxDt = (cfl * dx) / maxVelocity
    if (!Number.isFinite(maxDt) || maxDt <= 0) return 1

    const needed = Math.ceil(dt / maxDt)
    if (needed <= 1) return 1

    return Math.min(maxSteps, Math.max(1, needed))
  }
}




















