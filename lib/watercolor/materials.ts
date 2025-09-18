import * as THREE from 'three'

import {
  ABSORB_DEPOSIT_FRAGMENT,
  ABSORB_HEIGHT_FRAGMENT,
  ABSORB_PIGMENT_FRAGMENT,
  ABSORB_SETTLED_FRAGMENT,
  ABSORB_WET_FRAGMENT,
  ADVECT_BINDER_FRAGMENT,
  ADVECT_HEIGHT_FRAGMENT,
  ADVECT_PIGMENT_FRAGMENT,
  ADVECT_VELOCITY_FRAGMENT,
  BINDER_FORCE_FRAGMENT,
  COMPOSITE_FRAGMENT,
  FULLSCREEN_VERTEX,
  PAPER_DIFFUSION_FRAGMENT,
  PIGMENT_DIFFUSION_FRAGMENT,
  PRESSURE_DIVERGENCE_FRAGMENT,
  PRESSURE_JACOBI_FRAGMENT,
  PRESSURE_PROJECT_FRAGMENT,
  SPLAT_BINDER_FRAGMENT,
  SPLAT_HEIGHT_FRAGMENT,
  SPLAT_PIGMENT_FRAGMENT,
  SPLAT_VELOCITY_FRAGMENT,
  ZERO_FRAGMENT,
  VELOCITY_MAX_FRAGMENT,
} from './shaders'
import {
  DEFAULT_ABSORB_EXPONENT,
  DEFAULT_ABSORB_MIN_FLUX,
  DEFAULT_ABSORB_TIME_OFFSET,
  DEFAULT_BINDER_PARAMS,
  DEFAULT_DT,
  DEPOSITION_BASE,
  GRANULATION_STRENGTH,
  HUMIDITY_INFLUENCE,
  KM_LAYER_SCALE,
  PAPER_COLOR,
  PAPER_DIFFUSION_STRENGTH,
  PIGMENT_DIFFUSION_COEFF,
  PIGMENT_K,
  PIGMENT_S,
} from './constants'
import { type MaterialMap } from './types'

const sanitizeShader = (code: string) => code.trimStart()

function createMaterial(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.RawShaderMaterial {
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

export function createMaterials(
  texelSize: THREE.Vector2,
  fiberTexture: THREE.DataTexture,
  paperHeightTexture: THREE.DataTexture,
): MaterialMap {
  const centerUniform = () => ({ value: new THREE.Vector2(0, 0) })
  const pigmentUniform = () => ({ value: new THREE.Vector3(0, 0, 0) })

  const zero = createMaterial(ZERO_FRAGMENT, {})

  const splatHeight = createMaterial(SPLAT_HEIGHT_FRAGMENT, {
    uSource: { value: null },
    uCenter: centerUniform(),
    uRadius: { value: 0 },
    uFlow: { value: 0 },
    uToolType: { value: 0 },
    uPaperHeight: { value: paperHeightTexture },
    uDryThreshold: { value: 0.45 },
    uDryInfluence: { value: 0 },
  })

  const splatVelocity = createMaterial(SPLAT_VELOCITY_FRAGMENT, {
    uSource: { value: null },
    uCenter: centerUniform(),
    uRadius: { value: 0 },
    uFlow: { value: 0 },
    uPaperHeight: { value: paperHeightTexture },
    uDryThreshold: { value: 0.45 },
    uDryInfluence: { value: 0 },
  })

  const splatPigment = createMaterial(SPLAT_PIGMENT_FRAGMENT, {
    uSource: { value: null },
    uCenter: centerUniform(),
    uRadius: { value: 0 },
    uFlow: { value: 0 },
    uToolType: { value: 0 },
    uPigment: pigmentUniform(),
    uPaperHeight: { value: paperHeightTexture },
    uDryThreshold: { value: 0.45 },
    uDryInfluence: { value: 0 },
  })

  const splatBinder = createMaterial(SPLAT_BINDER_FRAGMENT, {
    uSource: { value: null },
    uCenter: centerUniform(),
    uRadius: { value: 0 },
    uFlow: { value: 0 },
    uToolType: { value: 0 },
    uBinderStrength: { value: DEFAULT_BINDER_PARAMS.injection },
    uPaperHeight: { value: paperHeightTexture },
    uDryThreshold: { value: 0.45 },
    uDryInfluence: { value: 0 },
  })

  const advectVelocity = createMaterial(ADVECT_VELOCITY_FRAGMENT, {
    uHeight: { value: null },
    uVelocity: { value: null },
    uDt: { value: DEFAULT_DT },
    uGrav: { value: 0.9 },
    uVisc: { value: 0.02 },
    uTexel: { value: texelSize.clone() },
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
    uTexel: { value: texelSize.clone() },
    uDiffusion: { value: PIGMENT_DIFFUSION_COEFF },
    uDt: { value: DEFAULT_DT },
  })

  const advectBinder = createMaterial(ADVECT_BINDER_FRAGMENT, {
    uBinder: { value: null },
    uVelocity: { value: null },
    uTexel: { value: texelSize.clone() },
    uDt: { value: DEFAULT_DT },
    uDiffusion: { value: DEFAULT_BINDER_PARAMS.diffusion },
    uDecay: { value: DEFAULT_BINDER_PARAMS.decay },
  })

  const binderForces = createMaterial(BINDER_FORCE_FRAGMENT, {
    uVelocity: { value: null },
    uBinder: { value: null },
    uTexel: { value: texelSize.clone() },
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
    uBeta: { value: DEFAULT_ABSORB_EXPONENT },
    uAbsorbTime: { value: 0 },
    uAbsorbTimeOffset: { value: DEFAULT_ABSORB_TIME_OFFSET },
    uAbsorbFloor: { value: DEFAULT_ABSORB_MIN_FLUX },
    uHumidity: { value: HUMIDITY_INFLUENCE },
    uSettle: { value: 0 },
    uGranStrength: { value: GRANULATION_STRENGTH },
    uBackrunStrength: { value: 0 },
    uTexel: { value: texelSize.clone() },
  })

  const absorbDeposit = createMaterial(ABSORB_DEPOSIT_FRAGMENT, absorbUniforms())
  const absorbHeight = createMaterial(ABSORB_HEIGHT_FRAGMENT, absorbUniforms())
  const absorbPigment = createMaterial(ABSORB_PIGMENT_FRAGMENT, absorbUniforms())
  const absorbWet = createMaterial(ABSORB_WET_FRAGMENT, absorbUniforms())
  const absorbSettled = createMaterial(ABSORB_SETTLED_FRAGMENT, absorbUniforms())

  const diffuseWet = createMaterial(PAPER_DIFFUSION_FRAGMENT, {
    uWet: { value: null },
    uFiber: { value: fiberTexture },
    uTexel: { value: texelSize.clone() },
    uDt: { value: DEFAULT_DT },
    uReplenish: { value: 0 },
    uStrength: { value: PAPER_DIFFUSION_STRENGTH },
  })

  const divergence = createMaterial(PRESSURE_DIVERGENCE_FRAGMENT, {
    uVelocity: { value: null },
    uTexel: { value: texelSize.clone() },
  })

  const jacobi = createMaterial(PRESSURE_JACOBI_FRAGMENT, {
    uPressure: { value: null },
    uDivergence: { value: null },
    uTexel: { value: texelSize.clone() },
  })

  const project = createMaterial(PRESSURE_PROJECT_FRAGMENT, {
    uVelocity: { value: null },
    uPressure: { value: null },
    uTexel: { value: texelSize.clone() },
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

export function createVelocityMaxMaterial(texelSize: THREE.Vector2): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    uniforms: {
      uVelocity: { value: null },
      uTexel: { value: texelSize.clone() },
    },
    vertexShader: sanitizeShader(FULLSCREEN_VERTEX),
    fragmentShader: sanitizeShader(VELOCITY_MAX_FRAGMENT),
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
}
