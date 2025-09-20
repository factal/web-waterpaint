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
uniform sampler2D uMask;
uniform float uFlow;
uniform float uMaskStrength;
uniform float uMaskFlow;
uniform sampler2D uPaperHeight;
uniform float uDryThreshold;
uniform float uDryInfluence;

float maskCoverage(vec2 uv) {
  float coverage = texture(uMask, uv).r;
  float strength = clamp(uMaskStrength, 0.0, 2.0);
  return clamp(coverage * strength, 0.0, 1.0);
}

float effectiveFlow() {
  return max(uFlow * uMaskFlow, 0.0);
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

export const STROKE_MASK_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSource;
uniform sampler2D uBristleMask;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec2 uMaskScale;
uniform float uMaskRotation;
uniform float uMaskStrength;

mat2 maskRotationMatrix(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

float stampCoverage(vec2 uv) {
  float r = max(uRadius, 1e-6);
  vec2 local = (uv - uCenter) / r;
  mat2 rot = maskRotationMatrix(uMaskRotation);
  vec2 rotated = rot * local;
  vec2 scaled = rotated * uMaskScale;
  vec2 maskUv = scaled * 0.5 + vec2(0.5);
  if (maskUv.x < 0.0 || maskUv.x > 1.0 || maskUv.y < 0.0 || maskUv.y > 1.0) {
    return 0.0;
  }
  float mask = texture(uBristleMask, maskUv).r;
  float strength = clamp(uMaskStrength, 0.0, 2.0);
  return clamp(mask * strength, 0.0, 1.0);
}

void main() {
  float prev = texture(uSource, vUv).r;
  float stamp = stampCoverage(vUv);
  float coverage = max(prev, stamp);
  fragColor = vec4(coverage, 0.0, 0.0, 1.0);
}
`

export const SPLAT_HEIGHT_FRAGMENT = `
${SPLAT_COMMON}
uniform float uToolType;
void main() {
  vec4 src = texture(uSource, vUv);
  float flow = effectiveFlow();
  float coverage = maskCoverage(vUv);
  float gate = paperDryGate(vUv, flow);
  float waterMul = mix(1.0, 0.7, step(0.5, uToolType));
  src.r += waterMul * flow * coverage * gate;
  fragColor = vec4(src.r, 0.0, 0.0, 1.0);
}
`

export const SPLAT_VELOCITY_FRAGMENT = `
${SPLAT_COMMON}
uniform vec2 uVelocityVector;
uniform float uVelocityStrength;
void main() {
  vec4 src = texture(uSource, vUv);
  float flow = effectiveFlow();
  float coverage = maskCoverage(vUv);
  float gate = paperDryGate(vUv, flow);
  vec2 dv = uVelocityVector * (uVelocityStrength * coverage * gate);
  fragColor = vec4(src.xy + dv, 0.0, 1.0);
}
`

export const SPLAT_PIGMENT_FRAGMENT = `
${SPLAT_COMMON}
uniform float uToolType;
uniform vec3 uPigment;
uniform float uLowSolvent;
uniform float uBoost;
void main() {
  vec4 src = texture(uSource, vUv);
  float flow = effectiveFlow();
  float coverage = maskCoverage(vUv);
  float gate = paperDryGate(vUv, flow);
  float pigmentMask = step(0.5, uToolType);
  float solvent = clamp(uLowSolvent, 0.0, 1.0);
  float boost = mix(1.0, max(uBoost, 1.0), solvent);
  float baseFlow = mix(flow, max(flow, 0.12), solvent);
  vec3 add = uPigment * (baseFlow * boost * coverage * pigmentMask * gate);
  fragColor = vec4(src.rgb + add, src.a);
}
`

export const SPLAT_BINDER_FRAGMENT = `
${SPLAT_COMMON}
uniform float uToolType;
uniform float uBinderStrength;
uniform float uLowSolvent;
void main() {
  vec4 src = texture(uSource, vUv);
  float flow = effectiveFlow();
  float coverage = maskCoverage(vUv);
  float gate = paperDryGate(vUv, flow);
  float mask = step(0.5, uToolType);
  float solvent = clamp(uLowSolvent, 0.0, 1.0);
  float baseFlow = mix(flow, max(flow, 0.35), solvent);
  float add = uBinderStrength * baseFlow * coverage * mask * gate;
  fragColor = vec4(src.r + add, 0.0, 0.0, 1.0);
}
`

export const SPLAT_DEPOSIT_FRAGMENT = `
${SPLAT_COMMON}
uniform vec3 uPigment;
uniform float uLowSolvent;
uniform float uBoost;
void main() {
  vec4 src = texture(uSource, vUv);
  float flow = effectiveFlow();
  float coverage = maskCoverage(vUv);
  float solvent = clamp(uLowSolvent, 0.0, 1.0);
  float boost = mix(1.0, max(uBoost, 1.0), solvent);
  float baseFlow = mix(flow, max(flow, 0.15), solvent);
  vec3 add = uPigment * (baseFlow * boost * solvent * coverage);
  fragColor = vec4(src.rgb + add, 1.0);
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
  float coverage = maskCoverage(vUv);
  float flow = effectiveFlow();
  float fraction = clamp(uRewetStrength * flow * coverage, 0.0, 1.0);
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
  float coverage = maskCoverage(vUv);
  float flow = effectiveFlow();
  float fraction = clamp(uRewetStrength * flow * coverage, 0.0, 1.0);
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

export const SURFACE_TENSION_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uHeight;
uniform sampler2D uWet;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform float uDt;
uniform float uStrength;
uniform float uThreshold;
uniform float uBreakThreshold;
uniform float uSnapStrength;
uniform float uVelocityLimit;

float sampleHeight(vec2 uv) {
  return texture(uHeight, uv).r;
}

void main() {
  float h = sampleHeight(vUv);
  float wet = clamp(texture(uWet, vUv).r, 0.0, 1.0);
  vec2 vel = texture(uVelocity, vUv).xy;
  float speed = length(vel);

  vec2 du = vec2(uTexel.x, 0.0);
  vec2 dv = vec2(0.0, uTexel.y);

  float left = sampleHeight(vUv - du);
  float right = sampleHeight(vUv + du);
  float bottom = sampleHeight(vUv - dv);
  float top = sampleHeight(vUv + dv);

  float neighborSum = left + right + top + bottom;
  float neighborAvg = neighborSum * 0.25;
  float laplacian = neighborSum - 4.0 * h;
  float maxNeighbour = max(max(left, right), max(top, bottom));

  float threshold = max(uThreshold, 1e-5);
  float breakThreshold = max(uBreakThreshold, 0.0);
  float velocityLimit = max(uVelocityLimit, 1e-4);

  float velocityGate = 1.0 - smoothstep(0.5 * velocityLimit, velocityLimit, speed);
  float wetGate = smoothstep(0.02, 0.35, wet);
  float thinPresence = smoothstep(1e-5, threshold, h);
  float isolation = 1.0 - smoothstep(threshold, threshold * 2.0, neighborAvg);
  float thinMask = thinPresence * isolation;

  float curvature = max(-laplacian, 0.0);
  float tension = uStrength * curvature * thinMask * wetGate * velocityGate * uDt;
  float newH = max(h - tension, 0.0);

  float snapMask = 1.0 - smoothstep(breakThreshold, breakThreshold * 2.0 + 1e-5, newH);
  float isolationTight = 1.0 - smoothstep(threshold * 0.5, threshold, maxNeighbour);
  float snapStrength = clamp(uSnapStrength, 0.0, 1.0);
  float snap = snapStrength * snapMask * isolationTight * wetGate * velocityGate;
  newH = mix(newH, 0.0, clamp(snap, 0.0, 1.0));

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
uniform float uLowSolvent;
uniform float uPasteClamp;
uniform float uPasteDamping;

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
  float solvent = clamp(uLowSolvent, 0.0, 1.0);
  float damping = clamp(uViscosity * binder * uDt + solvent * uPasteDamping, 0.0, 0.98);
  vel *= (1.0 - damping);
  float maxSpeed = max(1e-4, mix(1.0, uPasteClamp, solvent));
  float speed = length(vel);
  if (speed > maxSpeed) {
    vel *= maxSpeed / speed;
  }
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
uniform sampler2D uSizingMap;
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
uniform float uSizingInfluence;
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
  float sizing = texture(uSizingMap, uv).r;

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
  float sizingFactor = clamp(1.0 + uSizingInfluence * (0.5 - sizing), 0.1, 2.0);
  float absorbDemand = baseAbsorb * humidityFactor * sizingFactor;
  float evapBase = uEvap * sqrt(max(h, 0.0));
  float evapDemand = evapBase * mix(1.0, humidity, uHumidity);
  float totalDemand = absorbDemand + evapDemand;
  float available = max(h, 0.0);
  float demandScale = totalDemand > 1e-6 ? min(available / totalDemand, 1.0) : 0.0;
  float absorbAmount = absorbDemand * demandScale;
  float removal = totalDemand * demandScale;
  float newH = max(available - removal, 0.0);
  float remFrac = available > 1e-6 ? clamp(removal / available, 0.0, 1.0) : 0.0;
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

  vec3 settleBase = clamp(uSettle, vec3(0.0), vec3(1.0));
  vec3 settleRate = clamp(settleBase * valleyFactor, vec3(0.0), vec3(1.0));
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

export const EVAPORATION_RING_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uDeposits;
uniform sampler2D uWet;
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uStrength;
uniform float uDt;
uniform float uFilmThreshold;
uniform float uFilmFeather;
uniform float uGradientScale;

vec3 sampleDeposits(vec2 uv) {
  return texture(uDeposits, uv).rgb;
}

float sampleWet(vec2 uv) {
  return texture(uWet, uv).r;
}

float sampleHeight(vec2 uv) {
  return texture(uHeight, uv).r;
}

float filmMask(float h) {
  return 1.0 - smoothstep(uFilmThreshold, uFilmThreshold + uFilmFeather, h);
}

void main() {
  vec3 dep = sampleDeposits(vUv);
  float wet = clamp(sampleWet(vUv), 0.0, 1.0);
  float height = sampleHeight(vUv);
  float localThin = filmMask(height);
  float ringFactor = max(uStrength, 0.0) * max(uDt, 0.0);
  if (ringFactor <= 0.0) {
    fragColor = vec4(dep, 1.0);
    return;
  }

  vec2 offsets[4] = vec2[4](
    vec2(-uTexel.x, 0.0),
    vec2(uTexel.x, 0.0),
    vec2(0.0, -uTexel.y),
    vec2(0.0, uTexel.y)
  );

  vec3 incoming = vec3(0.0);
  float outgoing = 0.0;
  float gradScale = max(uGradientScale, 0.0);

  for (int i = 0; i < 4; i++) {
    vec2 off = offsets[i];
    float wetN = clamp(sampleWet(vUv + off), 0.0, 1.0);
    float heightN = sampleHeight(vUv + off);
    vec3 depN = sampleDeposits(vUv + off);

    float thinN = filmMask(heightN);
    float pairThin = max(localThin, thinN);
    float diff = wet - wetN;
    float magnitude = abs(diff);
    float gradientWeight = gradScale > 0.0 ? clamp(magnitude * gradScale, 0.0, 1.0) : 0.0;
    float drynessPair = clamp(1.0 - min(wet, wetN), 0.0, 1.0);
    float weight = pairThin * gradientWeight * drynessPair;
    if (weight <= 0.0) {
      continue;
    }

    if (diff > 0.0) {
      outgoing += weight * diff;
    } else if (diff < 0.0) {
      incoming += weight * (-diff) * depN;
    }
  }

  vec3 delta = ringFactor * (incoming - dep * outgoing);
  vec3 newDep = max(dep + delta, vec3(0.0));
  fragColor = vec4(newDep, 1.0);
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
uniform float uFringeStrength;
uniform float uFringeThreshold;
uniform float uFringeNoiseScale;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float fiberNoise(vec2 uv, vec2 dir, float scale) {
  float s = max(scale, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float along = dot(uv, dir) * s;
  float across = dot(uv, perp) * s * 0.75;
  float stripe = sin(along * 6.28318 + across * 1.7);
  float ripple = sin((along * 0.5 + across * 1.3) * 6.28318 + hash(vec2(along, across)) * 6.28318);
  float jitter = hash(vec2(along * 1.9, across * 2.3)) - 0.5;
  float noise = 0.5 + 0.35 * stripe + 0.25 * ripple + jitter * 0.3;
  return clamp(noise, 0.0, 1.0);
}

void main() {
  vec4 fiber = texture(uFiber, vUv);
  vec2 dir = fiber.xy;
  if (dot(dir, dir) < 1e-6) {
    dir = vec2(1.0, 0.0);
  } else {
    dir = normalize(dir);
  }
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 dirTex = dir * uTexel;
  vec2 perpTex = perp * uTexel;

  float w = texture(uWet, vUv).r;
  float wParaPlus = texture(uWet, vUv + dirTex).r;
  float wParaMinus = texture(uWet, vUv - dirTex).r;
  float wPerpPlus = texture(uWet, vUv + perpTex).r;
  float wPerpMinus = texture(uWet, vUv - perpTex).r;

  float lapPara = wParaPlus - 2.0 * w + wParaMinus;
  float lapPerp = wPerpPlus - 2.0 * w + wPerpMinus;

  float gradient = length(vec2(wParaPlus - wParaMinus, wPerpPlus - wPerpMinus)) * 0.5;
  float contrast = max(
    max(abs(w - wParaPlus), abs(w - wParaMinus)),
    max(abs(w - wPerpPlus), abs(w - wPerpMinus))
  );
  float edge = max(gradient, contrast);
  float frontMask = smoothstep(uFringeThreshold * 0.25, uFringeThreshold, edge);
  float moistureWindow = smoothstep(0.02, 0.45, w) * (1.0 - smoothstep(0.6, 0.95, w));
  frontMask *= moistureWindow;

  float freq = max(uFringeNoiseScale, 1.0);
  float noise = fiberNoise(vUv + fiber.xy, dir, freq);
  float signedNoise = noise * 2.0 - 1.0;
  float fringeIntensity = clamp(uFringeStrength * frontMask, 0.0, 2.0);

  float dPara = fiber.z;
  float dPerp = fiber.w;
  float paraMod = 1.0 + fringeIntensity * (0.45 + 0.55 * signedNoise);
  float perpMod = 1.0 - fringeIntensity * (0.35 + 0.45 * signedNoise);
  dPara = max(0.0, dPara * paraMod);
  dPerp = max(0.0, dPerp * perpMod);

  float lap = dPara * lapPara + dPerp * lapPerp;
  float neighborAvg = (wParaPlus + wParaMinus + wPerpPlus + wPerpMinus) * 0.25;
  float noiseKick = (neighborAvg - w) * signedNoise * fringeIntensity * 0.35;
  lap += noiseKick;
  float diffusion = uStrength * lap;
  float wetNeighborhood = max(w, neighborAvg);
  float replenishMask = smoothstep(1e-4, 0.02, wetNeighborhood);
  float replenish = uReplenish * (1.0 - w) * replenishMask;
  float newW = w + uDt * (diffusion + replenish);

  float thin = 1.0 - smoothstep(0.0, uFringeThreshold, w);
  float neighborMax = max(max(wParaPlus, wParaMinus), max(wPerpPlus, wPerpMinus));
  float isolation = 1.0 - smoothstep(uFringeThreshold * 0.5, uFringeThreshold, neighborMax);
  float dropProb = clamp(fringeIntensity * thin * isolation * 0.85, 0.0, 1.0);
  float random = hash(vUv * (freq * 1.37 + 3.1) + fiber.xy);
  float drop = step(random, dropProb);
  
  // newW = mix(newW, 0., drop);
  // this implementation causes patchy artifacts in the wetness.
  // temporally disabled
  newW = mix(newW, 0.0, 0.);

  newW = clamp(newW, 0.0, 1.0);
  fragColor = vec4(newW, 0.0, 0.0, 1.0);
}
`

export const COMPOSITE_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

const int SPECTRAL_SIZE = 38;
const float SPECTRAL_GAMMA = 2.4;

uniform sampler2D uDeposits;
uniform vec3 uPaper;
uniform float uPigmentKS[114];
uniform float uPigmentLuminance[3];
uniform float uPigmentStrength[3];
uniform float uBinderScatter;
uniform float uLayerScale;

float spectral_compand(float x) {
  return x < 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1.0 / SPECTRAL_GAMMA) - 0.055;
}

vec3 spectral_linear_to_srgb(vec3 lrgb) {
  return clamp(vec3(
    spectral_compand(lrgb.r),
    spectral_compand(lrgb.g),
    spectral_compand(lrgb.b)
  ), 0.0, 1.0);
}

vec3 spectral_xyz_to_srgb(vec3 xyz) {
  vec3 lrgb = vec3(
    3.2409699419045213 * xyz.x - 1.5373831775700940 * xyz.y - 0.4986107602930034 * xyz.z,
   -0.9692436362808796 * xyz.x + 1.8759675015077202 * xyz.y + 0.0415550574071756 * xyz.z,
    0.0556300796969936 * xyz.x - 0.2039769588889766 * xyz.y + 1.0569715142428786 * xyz.z
  );
  return spectral_linear_to_srgb(lrgb);
}

vec3 spectral_reflectance_to_xyz(float R[SPECTRAL_SIZE]) {
  vec3 xyz = vec3(0.0);
  xyz += R[0] * vec3(0.0000646919989576, 0.0000018442894440, 0.0003050171476380);
  xyz += R[1] * vec3(0.0002194098998132, 0.0000062053235865, 0.0010368066663574);
  xyz += R[2] * vec3(0.0011205743509343, 0.0000310096046799, 0.0053131363323992);
  xyz += R[3] * vec3(0.0037666134117111, 0.0001047483849269, 0.0179543925899536);
  xyz += R[4] * vec3(0.0118805536037990, 0.0003536405299538, 0.0570775815345485);
  xyz += R[5] * vec3(0.0232864424191771, 0.0009514714056444, 0.1136516189362870);
  xyz += R[6] * vec3(0.0345594181969747, 0.0022822631748318, 0.1733587261835500);
  xyz += R[7] * vec3(0.0372237901162006, 0.0042073290434730, 0.1962065755586570);
  xyz += R[8] * vec3(0.0324183761091486, 0.0066887983719014, 0.1860823707062960);
  xyz += R[9] * vec3(0.0212332056093810, 0.0098883960193565, 0.1399504753832070);
  xyz += R[10] * vec3(0.0104909907685421, 0.0152494514496311, 0.0891745294268649);
  xyz += R[11] * vec3(0.0032958375797931, 0.0214183109449723, 0.0478962113517075);
  xyz += R[12] * vec3(0.0005070351633801, 0.0334229301575068, 0.0281456253957952);
  xyz += R[13] * vec3(0.0009486742057141, 0.0513100134918512, 0.0161376622950514);
  xyz += R[14] * vec3(0.0062737180998318, 0.0704020839399490, 0.0077591019215214);
  xyz += R[15] * vec3(0.0168646241897775, 0.0878387072603517, 0.0042961483736618);
  xyz += R[16] * vec3(0.0286896490259810, 0.0942490536184085, 0.0020055092122156);
  xyz += R[17] * vec3(0.0426748124691731, 0.0979566702718931, 0.0008614711098802);
  xyz += R[18] * vec3(0.0562547481311377, 0.0941521856862608, 0.0003690387177652);
  xyz += R[19] * vec3(0.0694703972677158, 0.0867810237486753, 0.0001914287288574);
  xyz += R[20] * vec3(0.0830531516998291, 0.0788565338632013, 0.0001495555858975);
  xyz += R[21] * vec3(0.0861260963002257, 0.0635267026203555, 0.0000923109285104);
  xyz += R[22] * vec3(0.0904661376847769, 0.0537414167568200, 0.0000681349182337);
  xyz += R[23] * vec3(0.0850038650591277, 0.0426460643574120, 0.0000288263655696);
  xyz += R[24] * vec3(0.0709066691074488, 0.0316173492792708, 0.0000157671820553);
  xyz += R[25] * vec3(0.0506288916373645, 0.0208852059213910, 0.0000039406041027);
  xyz += R[26] * vec3(0.0354739618852640, 0.0138601101360152, 0.0000015840125870);
  xyz += R[27] * vec3(0.0214682102597065, 0.0081026402038399, 0.0000000000000000);
  xyz += R[28] * vec3(0.0125164567619117, 0.0046301022588030, 0.0000000000000000);
  xyz += R[29] * vec3(0.0068045816390165, 0.0024913800051319, 0.0000000000000000);
  xyz += R[30] * vec3(0.0034645657946526, 0.0012593033677378, 0.0000000000000000);
  xyz += R[31] * vec3(0.0014976097506959, 0.0005416465221680, 0.0000000000000000);
  xyz += R[32] * vec3(0.0007697004809280, 0.0002779528920067, 0.0000000000000000);
  xyz += R[33] * vec3(0.0004073680581315, 0.0001471080673854, 0.0000000000000000);
  xyz += R[34] * vec3(0.0001690104031614, 0.0000610327472927, 0.0000000000000000);
  xyz += R[35] * vec3(0.0000952245150365, 0.0000343873229523, 0.0000000000000000);
  xyz += R[36] * vec3(0.0000490309872958, 0.0000177059860053, 0.0000000000000000);
  xyz += R[37] * vec3(0.0000199961492222, 0.0000072209749130, 0.0000000000000000);
  return xyz;
}

float KM(float KS) {
  return 1.0 + KS - sqrt(KS * KS + 2.0 * KS);
}

float fetchPigmentKS(int pigment, int band) {
  int index = pigment * SPECTRAL_SIZE + band;
  return uPigmentKS[index];
}

void accumulatePigment(
  int pigment,
  float amount,
  inout float ksAccum[SPECTRAL_SIZE],
  inout float totalConcentration
) {
  float clamped = clamp(amount, 0.0, 6.0);
  if (clamped <= 1e-6) {
    return;
  }
  float strength = max(uPigmentStrength[pigment], 0.0);
  float luminance = max(uPigmentLuminance[pigment], 1e-6);
  float concentration = clamped * clamped * strength * strength * luminance;
  totalConcentration += concentration;
  for (int i = 0; i < SPECTRAL_SIZE; ++i) {
    ksAccum[i] += fetchPigmentKS(pigment, i) * concentration;
  }
}

void main() {
  vec3 dep = texture(uDeposits, vUv).rgb;
  float ksAccum[SPECTRAL_SIZE];
  for (int i = 0; i < SPECTRAL_SIZE; ++i) {
    ksAccum[i] = 0.0;
  }

  float totalConcentration = 0.0;
  accumulatePigment(0, dep.r, ksAccum, totalConcentration);
  accumulatePigment(1, dep.g, ksAccum, totalConcentration);
  accumulatePigment(2, dep.b, ksAccum, totalConcentration);

  float reflectance[SPECTRAL_SIZE];
  if (totalConcentration <= 1e-6) {
    for (int i = 0; i < SPECTRAL_SIZE; ++i) {
      reflectance[i] = 1.0;
    }
  } else {
    float invTotal = 1.0 / totalConcentration;
    float density = max(dep.r + dep.g + dep.b, 0.0);
    float thickness = 1.0 + max(uLayerScale, 0.0) * min(density, 4.0);
    for (int i = 0; i < SPECTRAL_SIZE; ++i) {
      float ks = ksAccum[i] * invTotal;
      reflectance[i] = KM(max(ks * thickness, 0.0));
    }
  }

  vec3 xyz = spectral_reflectance_to_xyz(reflectance);
  vec3 srgb = spectral_xyz_to_srgb(xyz);
  float haze = clamp(uBinderScatter, 0.0, 1.0);
  srgb = mix(srgb, vec3(1.0), haze);
  vec3 color = clamp(srgb * uPaper, vec3(0.0), vec3(1.0));

  fragColor = vec4(color, 1.0);
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
