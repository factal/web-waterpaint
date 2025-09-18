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

export function createMaterials(): MaterialMap {
  const zero = createMaterial(ZERO_FRAGMENT, {})

  const composite = createMaterial(COMPOSITE_FRAGMENT, {
    uDeposits: { value: null },
    uPaper: { value: PAPER_COLOR.clone() },
    uK: { value: PIGMENT_K.map((v) => v.clone()) },
    uS: { value: PIGMENT_S.map((v) => v.clone()) },
    uLayerScale: { value: KM_LAYER_SCALE },
  })

  return { zero, composite }
}
