import * as THREE from 'three'

import { COMPOSITE_FRAGMENT, FULLSCREEN_VERTEX, ZERO_FRAGMENT } from './shaders'
import { KM_LAYER_SCALE, PAPER_COLOR, PIGMENT_K, PIGMENT_S } from './constants'
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
