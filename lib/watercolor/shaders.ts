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
uniform sampler2D uPaperHeight;
uniform float uDryThreshold;
uniform float uDryInfluence;
float splatFalloff(vec2 uv, float radius) {
  vec2 delta = uv - uCenter;
  float r = max(radius, 1e-6);
  return exp(-9.0 * dot(delta, delta) / (r * r + 1e-6));
}
float paperDryGate(vec2 uv, float flow) {
  float height = texture(uPaperHeight, uv).r;
  float wetness = clamp(flow, 0.0, 1.0);
  float dryMix = clamp(uDryInfluence, 0.0, 1.0);
  float feather = mix(0.03, 0.18, 1.0 - wetness);
  float ramp = smoothstep(uDryThreshold - feather, uDryThreshold + feather, height);
  return mix(1.0, 1.0 - ramp, dryMix);
}
`

export const SPLAT_HEIGHT_FRAGMENT = `
${SPLAT_COMMON}
uniform float uToolType;
void main() {
  vec4 src = texture(uSource, vUv);
  float fall = splatFalloff(vUv, uRadius);
  float gate = paperDryGate(vUv, uFlow);
  float waterMul = mix(1.0, 0.7, step(0.5, uToolType));
  src.r += waterMul * uFlow * fall * gate;
  fragColor = vec4(src.r, 0.0, 0.0, 1.0);
}
`

export const SPLAT_VELOCITY_FRAGMENT = `
${SPLAT_COMMON}
void main() {
  vec4 src = texture(uSource, vUv);
  vec2 delta = vUv - uCenter;
  float fall = splatFalloff(vUv, uRadius);
  float gate = paperDryGate(vUv, uFlow);
  float len = length(delta);
  vec2 dir = len > 1e-6 ? delta / len : vec2(0.0);
  vec2 dv = dir * (0.7 * uFlow * fall * gate);
  fragColor = vec4(src.xy + dv, 0.0, 1.0);
}
`

export const SPLAT_PIGMENT_FRAGMENT = `
${SPLAT_COMMON}
uniform float uToolType;
uniform vec3 uPigment;
void main() {
  vec4 src = texture(uSource, vUv);
  float fall = splatFalloff(vUv, uRadius);
  float gate = paperDryGate(vUv, uFlow);
  float pigmentMask = step(0.5, uToolType);
  vec3 add = uPigment * (uFlow * fall * pigmentMask * gate);
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
  float gate = paperDryGate(vUv, uFlow);
  float mask = step(0.5, uToolType);
  float add = uBinderStrength * uFlow * fall * mask * gate;
  fragColor = vec4(src.r + add, 0.0, 0.0, 1.0);
}
`

export const SPLAT_REWET_PIGMENT_FRAGMENT = `
${SPLAT_COMMON}
uniform sampler2D uDeposits;
uniform float uRewetStrength;
uniform vec3 uRewetPerChannel;
void main() {
  vec4 src = texture(uSource, vUv);
  vec3 dep = texture(uDeposits, vUv).rgb;
  float fall = splatFalloff(vUv, uRadius);
  float fraction = clamp(uRewetStrength * uFlow * fall, 0.0, 1.0);
  vec3 weights = clamp(uRewetPerChannel, vec3(0.0), vec3(1.0));
  vec3 dissolved = min(dep, dep * (weights * fraction));
  fragColor = vec4(src.rgb + dissolved, src.a);
}
`

export const SPLAT_REWET_DEPOSIT_FRAGMENT = `
${SPLAT_COMMON}
uniform float uRewetStrength;
uniform vec3 uRewetPerChannel;
void main() {
  vec4 src = texture(uSource, vUv);
  vec3 dep = src.rgb;
  float fall = splatFalloff(vUv, uRadius);
  float fraction = clamp(uRewetStrength * uFlow * fall, 0.0, 1.0);
  vec3 weights = clamp(uRewetPerChannel, vec3(0.0), vec3(1.0));
  vec3 dissolved = min(dep, dep * (weights * fraction));
  vec3 newDep = max(dep - dissolved, vec3(0.0));
  fragColor = vec4(newDep, 1.0);
}
`

export const ADVECT_VELOCITY_FRAGMENT = `
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
  vec4 sample_color = texture(uHeight, back);
  float binder = texture(uBinder, vUv).r;
  float newH = max(sample_color.r + uBinderBuoyancy * binder * uDt, 0.0);
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
uniform vec3 uDiffusion;
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
  vec3 diffused = center.rgb + (uDiffusion * laplacian) * uDt;
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

export const BINDER_FORCE_FRAGMENT = `
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

export const ABSORB_COMMON = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uHeight;
uniform sampler2D uPigment;
uniform sampler2D uWet;
uniform sampler2D uDeposits;
uniform sampler2D uSettled;
uniform sampler2D uPaperHeight;
uniform float uAbsorb;
uniform float uEvap;
uniform float uEdge;
uniform float uDepBase;
uniform float uBeta;
uniform float uAbsorbTime;
uniform float uAbsorbTimeOffset;
uniform float uAbsorbFloor;
uniform float uHumidity;
uniform vec3 uSettle;
uniform float uGranStrength;
uniform float uBackrunStrength;
uniform float uPaperHeightStrength;
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
  float paperHeight = texture(uPaperHeight, uv).r;

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
  float valleyFactor = 1.0 + uPaperHeightStrength * (0.5 - paperHeight);
  valleyFactor = clamp(valleyFactor, 0.1, 3.0);
  float depBase = clamp(remFrac * (0.5 + edgeBias) + uDepBase * edgeBias, 0.0, 1.0);
  float depFrac = clamp(depBase * valleyFactor, 0.0, 1.0);
  vec3 depAdd = pigment * depFrac;
  dep += depAdd;
  pigment = max(pigment - depAdd, vec3(0.0));

  vec3 bloomDep = pigment * bloomFactor;
  dep += bloomDep;
  pigment = max(pigment - bloomDep, vec3(0.0));

  float settleBase = clamp(uSettle, 0.0, 1.0);
  float settleRate = clamp(settleBase * valleyFactor, 0.0, 1.0);
  vec3 settleAdd = pigment * settleRate;
  pigment = max(pigment - settleAdd, vec3(0.0));
  vec3 settledNew = settled + settleAdd;

  float granBase = clamp(uGranStrength * edgeBias, 0.0, 1.0);
  float granCoeff = clamp(granBase * valleyFactor, 0.0, 1.0);
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

export const PRESSURE_DIVERGENCE_FRAGMENT = `
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
`

export const PRESSURE_JACOBI_FRAGMENT = `
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
`

export const PRESSURE_PROJECT_FRAGMENT = `
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
