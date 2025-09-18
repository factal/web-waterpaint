import * as THREE from 'three'

import {
  ABSORB_DEPOSIT_FRAGMENT,
  ABSORB_HEIGHT_FRAGMENT,
  ABSORB_PIGMENT_FRAGMENT,
  ABSORB_SETTLED_FRAGMENT,
  ABSORB_WET_FRAGMENT,
  ADVECT_HEIGHT_FRAGMENT,
  ADVECT_PIGMENT_FRAGMENT,
  BINDER_UPDATE_FRAGMENT,
  COMPOSITE_FRAGMENT,
  FULLSCREEN_VERTEX,
  LBM_INIT_FRAGMENT,
  LBM_MACRO_FRAGMENT,
  LBM_STEP_FRAGMENT,
  PAPER_DIFFUSION_FRAGMENT,
  PIGMENT_DIFFUSION_FRAGMENT,
  SPLAT_BINDER_FRAGMENT,
  SPLAT_HEIGHT_FRAGMENT,
  SPLAT_PIGMENT_FRAGMENT,
  VELOCITY_MAX_FRAGMENT,
  ZERO_FRAGMENT,
} from './shaders'
import {
  KM_LAYER_SCALE,
  PAPER_COLOR,
  PIGMENT_K,
  PIGMENT_S,
  LBM_BASE_DENSITY,
} from './constants'
import { type MaterialMap } from './types'

const sanitizeShader = (code: string) => code.trimStart()

function createMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial {
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

export function createMaterials(size: number): MaterialMap {
  const texel = new THREE.Vector2(1 / size, 1 / size)

  const zero = createMaterial(ZERO_FRAGMENT, {})

  const splatHeight = createMaterial(SPLAT_HEIGHT_FRAGMENT, {
    uSource: { value: null },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: 0 },
    uFlow: { value: 0 },
    uToolType: { value: 0 },
  })

  const splatPigment = createMaterial(SPLAT_PIGMENT_FRAGMENT, {
    uSource: { value: null },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: 0 },
    uFlow: { value: 0 },
    uToolType: { value: 0 },
    uPigment: { value: new THREE.Vector3() },
  })

  const splatBinder = createMaterial(SPLAT_BINDER_FRAGMENT, {
    uSource: { value: null },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: 0 },
    uFlow: { value: 0 },
    uToolType: { value: 0 },
    uBinderStrength: { value: 0 },
  })

  const lbmInit = createMaterial(LBM_INIT_FRAGMENT, {
    uBaseDensity: { value: LBM_BASE_DENSITY },
  })
  lbmInit.extensions = { drawBuffers: true }

  const lbmStep = createMaterial(LBM_STEP_FRAGMENT, {
    uState0: { value: null },
    uState1: { value: null },
    uState2: { value: null },
    uHeight: { value: null },
    uBinder: { value: null },
    uTexel: { value: texel.clone() },
    uDt: { value: 0 },
    uGravity: { value: 0 },
    uViscosity: { value: 0 },
    uBinderViscosity: { value: 0 },
    uBaseDensity: { value: LBM_BASE_DENSITY },
  })
  lbmStep.extensions = { drawBuffers: true }

  const lbmMacro = createMaterial(LBM_MACRO_FRAGMENT, {
    uState0: { value: null },
    uState1: { value: null },
    uState2: { value: null },
    uBaseDensity: { value: LBM_BASE_DENSITY },
  })
  lbmMacro.extensions = { drawBuffers: true }

  const advectHeight = createMaterial(ADVECT_HEIGHT_FRAGMENT, {
    uHeight: { value: null },
    uVelocity: { value: null },
    uBinder: { value: null },
    uDt: { value: 0 },
    uBinderBuoyancy: { value: 0 },
  })

  const advectPigment = createMaterial(ADVECT_PIGMENT_FRAGMENT, {
    uPigment: { value: null },
    uVelocity: { value: null },
    uDt: { value: 0 },
  })

  const diffusePigment = createMaterial(PIGMENT_DIFFUSION_FRAGMENT, {
    uPigment: { value: null },
    uTexel: { value: texel.clone() },
    uDiffusion: { value: 0 },
    uDt: { value: 0 },
  })

  const binderUpdate = createMaterial(BINDER_UPDATE_FRAGMENT, {
    uBinder: { value: null },
    uVelocity: { value: null },
    uTexel: { value: texel.clone() },
    uDt: { value: 0 },
    uDiffusion: { value: 0 },
    uDecay: { value: 0 },
  })

  const absorbUniforms = {
    uHeight: { value: null as THREE.Texture | null },
    uPigment: { value: null as THREE.Texture | null },
    uWet: { value: null as THREE.Texture | null },
    uDeposits: { value: null as THREE.Texture | null },
    uSettled: { value: null as THREE.Texture | null },
    uAbsorb: { value: 0 },
    uEvap: { value: 0 },
    uEdge: { value: 0 },
    uDepBase: { value: 0 },
    uBeta: { value: 1 },
    uHumidity: { value: 0 },
    uSettle: { value: 0 },
    uGranStrength: { value: 0 },
    uBackrunStrength: { value: 0 },
    uAbsorbMin: { value: 0 },
    uTimeOffset: { value: 0 },
    uTexel: { value: texel.clone() },
  }

  const absorbDeposit = createMaterial(ABSORB_DEPOSIT_FRAGMENT, { ...absorbUniforms })
  const absorbHeight = createMaterial(ABSORB_HEIGHT_FRAGMENT, { ...absorbUniforms })
  const absorbPigment = createMaterial(ABSORB_PIGMENT_FRAGMENT, { ...absorbUniforms })
  const absorbWet = createMaterial(ABSORB_WET_FRAGMENT, { ...absorbUniforms })
  const absorbSettled = createMaterial(ABSORB_SETTLED_FRAGMENT, { ...absorbUniforms })

  const paperDiffuse = createMaterial(PAPER_DIFFUSION_FRAGMENT, {
    uWet: { value: null },
    uFiber: { value: null },
    uStrength: { value: 0 },
    uDt: { value: 0 },
    uReplenish: { value: 0 },
    uTexel: { value: texel.clone() },
  })

  const velocityMax = createMaterial(VELOCITY_MAX_FRAGMENT, {
    uVelocity: { value: null },
    uTexel: { value: texel.clone() },
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
    composite,
    splatHeight,
    splatPigment,
    splatBinder,
    lbmInit,
    lbmStep,
    lbmMacro,
    advectHeight,
    advectPigment,
    diffusePigment,
    binderUpdate,
    absorbDeposit,
    absorbHeight,
    absorbPigment,
    absorbWet,
    absorbSettled,
    paperDiffuse,
    velocityMax,
  }
}
