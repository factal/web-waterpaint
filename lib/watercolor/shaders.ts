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
uniform sampler2D uBristleMask;
uniform vec2 uMaskScale;
uniform float uMaskRotation;
uniform float uMaskStrength;
mat2 maskRotationMatrix(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}
float sampleBrushMask(vec2 uv, float radius) {
  float r = max(radius, 1e-6);
  vec2 local = (uv - uCenter) / r;
  vec2 rotated = maskRotationMatrix(uMaskRotation) * local;
  vec2 scaled = rotated * uMaskScale;
  vec2 maskUv = scaled * 0.5 + vec2(0.5);
  float mask = texture(uBristleMask, maskUv).r;
  float influence = clamp(uMaskStrength, 0.0, 1.0);
  return mix(1.0, mask, influence);
}
float splatFalloff(vec2 uv, float radius) {
  vec2 delta = uv - uCenter;
  float r = max(radius, 1e-6);
  float gaussian = exp(-9.0 * dot(delta, delta) / (r * r + 1e-6));
  float mask = sampleBrushMask(uv, radius);
  return gaussian * mask;
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
uniform float uLowSolvent;
uniform float uBoost;
void main() {
  vec4 src = texture(uSource, vUv);
  float fall = splatFalloff(vUv, uRadius);
  float gate = paperDryGate(vUv, uFlow);
  float pigmentMask = step(0.5, uToolType);
  float solvent = clamp(uLowSolvent, 0.0, 1.0);
  float boost = mix(1.0, max(uBoost, 1.0), solvent);
  float baseFlow = mix(uFlow, max(uFlow, 0.12), solvent);
  vec3 add = uPigment * (baseFlow * boost * fall * pigmentMask * gate);
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
  float fall = splatFalloff(vUv, uRadius);
  float gate = paperDryGate(vUv, uFlow);
  float mask = step(0.5, uToolType);
  float solvent = clamp(uLowSolvent, 0.0, 1.0);
  float baseFlow = mix(uFlow, max(uFlow, 0.35), solvent);
  float add = uBinderStrength * baseFlow * fall * mask * gate;
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
  float fall = splatFalloff(vUv, uRadius);
  float gate = paperDryGate(vUv, uFlow);
  float solvent = clamp(uLowSolvent, 0.0, 1.0);
  float boost = mix(1.0, max(uBoost, 1.0), solvent);
  float baseFlow = mix(uFlow, max(uFlow, 0.15), solvent);
  vec3 add = uPigment * (baseFlow * boost * solvent * fall * gate);
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
