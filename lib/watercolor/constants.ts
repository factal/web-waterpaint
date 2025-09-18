import * as THREE from 'three'

import { type BinderParams, type CapillaryFringeParams, type SurfaceTensionParams } from './types'

export const DEFAULT_DT = 1 / 90
export const DEPOSITION_BASE = 0.02
export const PAPER_COLOR = new THREE.Vector3(0.92, 0.91, 0.88)
export const PAPER_DIFFUSION_STRENGTH = 6.0
export const PIGMENT_DIFFUSION_COEFF = 0.08
export const KM_LAYER_SCALE = 1.4
export const DEFAULT_ABSORB_EXPONENT = 0.5
export const DEFAULT_ABSORB_TIME_OFFSET = 0.15
export const DEFAULT_ABSORB_MIN_FLUX = 0.02
export const HUMIDITY_INFLUENCE = 0.6
export const GRANULATION_SETTLE_RATE = 0.28
export const GRANULATION_STRENGTH = 0.45
export const DEFAULT_REWET_STRENGTH = 0.45

// Per-pigment rewet multipliers – higher values dissolve more deposits when water is added.
// Staining pigments can opt out by setting their channel to zero.
export const PIGMENT_REWET = new THREE.Vector3(0.75, 0.6, 0.0)

export const DEFAULT_PAPER_TEXTURE_STRENGTH = 0.8

export const PIGMENT_K = [
  new THREE.Vector3(1.6, 0.1, 0.1),
  new THREE.Vector3(0.1, 1.4, 0.15),
  new THREE.Vector3(0.05, 0.1, 1.2),
] as const

export const PIGMENT_S = [
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

export const DEFAULT_SURFACE_TENSION_PARAMS: SurfaceTensionParams = {
  enabled: true,
  strength: 2.8,
  threshold: 0.12,
  breakThreshold: 0.025,
  snapStrength: 0.6,
  velocityLimit: 0.65,
}

export const DEFAULT_FRINGE_PARAMS: CapillaryFringeParams = {
  enabled: true,
  strength: 0.65,
  threshold: 0.18,
  noiseScale: 32,
}
