import * as THREE from 'three'

import {
  type BinderParams,
  type CapillaryFringeParams,
  type EvaporationRingParams,
  type PigmentChannels,
  type SurfaceTensionParams,
} from './types'

export const DEFAULT_DT = 1 / 90
export const DEPOSITION_BASE = 0.02
export const PAPER_COLOR = new THREE.Vector3(0.92, 0.91, 0.88)
export const PAPER_DIFFUSION_STRENGTH = 6.0
export const PIGMENT_DIFFUSION_COEFF = 0.08
export const DEFAULT_ABSORB_EXPONENT = 0.5
export const DEFAULT_ABSORB_TIME_OFFSET = 0.15
export const DEFAULT_ABSORB_MIN_FLUX = 0.02
export const HUMIDITY_INFLUENCE = 0.6
export const GRANULATION_SETTLE_RATE = 0.28
export const GRANULATION_STRENGTH = 0.45
export const DEFAULT_REWET_STRENGTH = 0.45

// Per-pigment rewet multipliers – higher values dissolve more deposits when water is added.
// Staining pigments can opt out by setting their channel to zero.
export const PIGMENT_CHANNELS = 7
export const PIGMENT_CHANNEL_LABELS = ['R', 'G', 'B', 'W', 'C', 'M', 'Y'] as const

const filled = (value: number): PigmentChannels => Object.freeze([
  value,
  value,
  value,
  value,
  value,
  value,
  value,
]) as PigmentChannels

export const DEFAULT_PIGMENT_DIFFUSION = filled(PIGMENT_DIFFUSION_COEFF)
export const DEFAULT_PIGMENT_SETTLE = filled(GRANULATION_SETTLE_RATE)
export const PIGMENT_REWET = Object.freeze([0.72, 0.68, 0.62, 0.4, 0.58, 0.52, 0.45]) as PigmentChannels

export const DEFAULT_PAPER_TEXTURE_STRENGTH = 0.8
export const DEFAULT_SIZING_INFLUENCE = 0.18

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

export const DEFAULT_RING_PARAMS: EvaporationRingParams = {
  enabled: true,
  strength: 2.4,
  filmThreshold: 0.075,
  filmFeather: 0.045,
  gradientScale: 12,
}
