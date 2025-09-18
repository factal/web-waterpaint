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

export const SPLAT_HEIGHT_FRAGMENT = `
${SPLAT_COMMON}
out vec4 fragColor;
uniform float uToolType;
void main() {
  vec4 src = texture(uSource, vUv);
  float fall = splatFalloff(vUv, uRadius);
  float waterMul = mix(1.0, 0.7, step(0.5, uToolType));
  src.r += waterMul * uFlow * fall;
  fragColor = vec4(src.r, 0.0, 0.0, 1.0);
}
`

export const SPLAT_PIGMENT_FRAGMENT = `
${SPLAT_COMMON}
out vec4 fragColor;
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
out vec4 fragColor;
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

export const LBM_INIT_FRAGMENT = `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 frag0;
layout(location = 1) out vec4 frag1;
layout(location = 2) out vec4 frag2;
uniform float uBaseDensity;
const float W0 = 4.0 / 9.0;
const float W1 = 1.0 / 9.0;
const float W2 = 1.0 / 36.0;
void main() {
  float rho = uBaseDensity;
  frag0 = vec4(W0 * rho, W1 * rho, W1 * rho, W1 * rho);
  frag1 = vec4(W1 * rho, W2 * rho, W2 * rho, W2 * rho);
  frag2 = vec4(W2 * rho, 0.0, 0.0, 0.0);
}
`

export const LBM_STEP_FRAGMENT = `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 frag0;
layout(location = 1) out vec4 frag1;
layout(location = 2) out vec4 frag2;
uniform sampler2D uState0;
uniform sampler2D uState1;
uniform sampler2D uState2;
uniform sampler2D uHeight;
uniform sampler2D uBinder;
uniform vec2 uTexel;
uniform float uDt;
uniform float uGravity;
uniform float uViscosity;
uniform float uBinderViscosity;
uniform float uBaseDensity;

const float W0 = 4.0 / 9.0;
const float W1 = 1.0 / 9.0;
const float W2 = 1.0 / 36.0;

vec2 clampUv(vec2 uv, vec2 texel) {
  return clamp(uv, texel * 0.5, vec2(1.0) - texel * 0.5);
}

float sampleDir(int dir, vec2 coord) {
  if (dir == 0) {
    return texture(uState0, coord).x;
  }
  if (dir == 1) {
    return texture(uState0, coord).y;
  }
  if (dir == 2) {
    return texture(uState0, coord).z;
  }
  if (dir == 3) {
    return texture(uState0, coord).w;
  }
  if (dir == 4) {
    return texture(uState1, coord).x;
  }
  if (dir == 5) {
    return texture(uState1, coord).y;
  }
  if (dir == 6) {
    return texture(uState1, coord).z;
  }
  if (dir == 7) {
    return texture(uState1, coord).w;
  }
  return texture(uState2, coord).x;
}

void main() {
  vec2 texel = uTexel;
  float f0 = sampleDir(0, vUv);
  float f1 = sampleDir(1, clampUv(vUv - vec2(texel.x, 0.0), texel));
  float f2 = sampleDir(2, clampUv(vUv - vec2(0.0, texel.y), texel));
  float f3 = sampleDir(3, clampUv(vUv + vec2(texel.x, 0.0), texel));
  float f4 = sampleDir(4, clampUv(vUv + vec2(0.0, texel.y), texel));
  float f5 = sampleDir(5, clampUv(vUv - vec2(texel.x, texel.y), texel));
  float f6 = sampleDir(6, clampUv(vUv + vec2(texel.x, -texel.y), texel));
  float f7 = sampleDir(7, clampUv(vUv + vec2(texel.x, texel.y), texel));
  float f8 = sampleDir(8, clampUv(vUv - vec2(texel.x, -texel.y), texel));

  float rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  vec2 mom = vec2(
    (f1 - f3) + (f5 - f6) + (f8 - f7),
    (f2 - f4) + (f5 + f6) - (f7 + f8)
  );
  vec2 vel = mom / max(rho, 1e-5);

  float h = texture(uHeight, vUv).r;
  float hL = texture(uHeight, clampUv(vUv - vec2(texel.x, 0.0), texel)).r;
  float hR = texture(uHeight, clampUv(vUv + vec2(texel.x, 0.0), texel)).r;
  float hB = texture(uHeight, clampUv(vUv - vec2(0.0, texel.y), texel)).r;
  float hT = texture(uHeight, clampUv(vUv + vec2(0.0, texel.y), texel)).r;
  vec2 gradH = vec2((hR - hL) * 0.5, (hT - hB) * 0.5);
  vec2 force = -uGravity * gradH;
  vel += uDt * force;

  float binder = texture(uBinder, vUv).r;
  float nu = max(uViscosity + uBinderViscosity * binder, 1e-4);
  float tau = max(3.0 * nu + 0.5, 0.52);
  float omega = 1.0 / tau;

  float rhoTarget = max(uBaseDensity + h, 1e-5);
  float u2 = dot(vel, vel);

  float cu1 = 3.0 * vel.x;
  float cu2 = 3.0 * vel.y;
  float cu3 = -cu1;
  float cu4 = -cu2;
  float cu5 = 3.0 * dot(vel, vec2(1.0, 1.0));
  float cu6 = 3.0 * dot(vel, vec2(-1.0, 1.0));
  float cu7 = 3.0 * dot(vel, vec2(-1.0, -1.0));
  float cu8 = 3.0 * dot(vel, vec2(1.0, -1.0));

  float feq0 = W0 * rhoTarget * (1.0 - 1.5 * u2);
  float feq1 = W1 * rhoTarget * (1.0 + cu1 + 0.5 * cu1 * cu1 - 1.5 * u2);
  float feq2 = W1 * rhoTarget * (1.0 + cu2 + 0.5 * cu2 * cu2 - 1.5 * u2);
  float feq3 = W1 * rhoTarget * (1.0 + cu3 + 0.5 * cu3 * cu3 - 1.5 * u2);
  float feq4 = W1 * rhoTarget * (1.0 + cu4 + 0.5 * cu4 * cu4 - 1.5 * u2);
  float feq5 = W2 * rhoTarget * (1.0 + cu5 + 0.5 * cu5 * cu5 - 1.5 * u2);
  float feq6 = W2 * rhoTarget * (1.0 + cu6 + 0.5 * cu6 * cu6 - 1.5 * u2);
  float feq7 = W2 * rhoTarget * (1.0 + cu7 + 0.5 * cu7 * cu7 - 1.5 * u2);
  float feq8 = W2 * rhoTarget * (1.0 + cu8 + 0.5 * cu8 * cu8 - 1.5 * u2);

  float nf0 = f0 + omega * (feq0 - f0);
  float nf1 = f1 + omega * (feq1 - f1);
  float nf2 = f2 + omega * (feq2 - f2);
  float nf3 = f3 + omega * (feq3 - f3);
  float nf4 = f4 + omega * (feq4 - f4);
  float nf5 = f5 + omega * (feq5 - f5);
  float nf6 = f6 + omega * (feq6 - f6);
  float nf7 = f7 + omega * (feq7 - f7);
  float nf8 = f8 + omega * (feq8 - f8);

  frag0 = vec4(nf0, nf1, nf2, nf3);
  frag1 = vec4(nf4, nf5, nf6, nf7);
  frag2 = vec4(nf8, 0.0, 0.0, 0.0);
}
`

export const LBM_MACRO_FRAGMENT = `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
uniform sampler2D uState0;
uniform sampler2D uState1;
uniform sampler2D uState2;
uniform float uBaseDensity;
void main() {
  vec4 s0 = texture(uState0, vUv);
  vec4 s1 = texture(uState1, vUv);
  vec4 s2 = texture(uState2, vUv);
  float f0 = s0.x;
  float f1 = s0.y;
  float f2 = s0.z;
  float f3 = s0.w;
  float f4 = s1.x;
  float f5 = s1.y;
  float f6 = s1.z;
  float f7 = s1.w;
  float f8 = s2.x;
  float rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  vec2 mom = vec2(
    (f1 - f3) + (f5 - f6) + (f8 - f7),
    (f2 - f4) + (f5 + f6) - (f7 + f8)
  );
  vec2 vel = mom / max(rho, 1e-5);
  float height = max(rho - uBaseDensity, 0.0);
  fragColor = vec4(vel, height, 1.0);
}
`

export const ADVECT_HEIGHT_FRAGMENT = `
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
  vec4 sampleColor = texture(uHeight, back);
  float binder = texture(uBinder, vUv).r;
  float newH = max(sampleColor.r + uBinderBuoyancy * binder * uDt, 0.0);
  fragColor = vec4(newH, 0.0, 0.0, 1.0);
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
  vec4 sampleColor = texture(uPigment, back);
  fragColor = vec4(max(sampleColor.rgb, vec3(0.0)), sampleColor.a);
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

export const BINDER_UPDATE_FRAGMENT = `
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
uniform float uAbsorbMin;
uniform float uTimeOffset;
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
  float timeFactor = uTimeOffset > 0.0 ? inversesqrt(max(uTimeOffset + wet, 1e-3)) : 1.0;
  float absorbCandidate = uAbsorb * pow(humidity, uBeta) * timeFactor;
  float absorbRate = max(uAbsorbMin, absorbCandidate);
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
`

export const ABSORB_DEPOSIT_FRAGMENT = `
${ABSORB_COMMON}
out vec4 fragColor;
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.dep, 1.0);
}
`

export const ABSORB_HEIGHT_FRAGMENT = `
${ABSORB_COMMON}
out vec4 fragColor;
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.newH, 0.0, 0.0, 1.0);
}
`

export const ABSORB_PIGMENT_FRAGMENT = `
${ABSORB_COMMON}
out vec4 fragColor;
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.pigment, 1.0);
}
`

export const ABSORB_WET_FRAGMENT = `
${ABSORB_COMMON}
out vec4 fragColor;
void main() {
  AbsorbResult res = computeAbsorb(vUv);
  fragColor = vec4(res.newWet, 0.0, 0.0, 1.0);
}
`

export const ABSORB_SETTLED_FRAGMENT = `
${ABSORB_COMMON}
out vec4 fragColor;
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
uniform float uStrength;
uniform float uDt;
uniform float uReplenish;
uniform vec2 uTexel;
void main() {
  vec4 fiber = texture(uFiber, vUv);
  vec2 dir = normalize(fiber.xy * 2.0 - 1.0);
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
