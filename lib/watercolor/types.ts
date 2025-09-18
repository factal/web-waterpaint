import * as THREE from 'three'

export type BrushType = 'water' | 'pigment'

export interface BrushMaskParams {
  texture: THREE.Texture | null
  scale: [number, number]
  rotation: number
  strength: number
}

export interface BrushSettings {
  center: [number, number]
  radius: number
  flow: number
  type: BrushType
  color: [number, number, number]
  dryness?: number
  dryThreshold?: number
  lowSolvent?: number
  binderBoost?: number
  pigmentBoost?: number
  depositBoost?: number
  mask?: BrushMaskParams
}

export type ChannelCoefficients = [number, number, number]

export interface PigmentCoefficients {
  diffusion: ChannelCoefficients
  settle: ChannelCoefficients
}

export interface BinderParams {
  injection: number
  diffusion: number
  decay: number
  elasticity: number
  viscosity: number
  buoyancy: number
}

export interface ReservoirParams {
  waterCapacityWater: number
  waterCapacityPigment: number
  pigmentCapacity: number
  waterConsumption: number
  pigmentConsumption: number
  stampSpacing: number
}

export interface SimulationParams {
  grav: number
  visc: number
  absorb: number
  evap: number
  edge: number
  stateAbsorption: boolean
  granulation: boolean
  paperTextureStrength: number
  backrunStrength: number
  absorbExponent: number
  absorbTimeOffset: number
  absorbMinFlux: number
  cfl: number
  maxSubsteps: number
  binder: BinderParams
  reservoir: ReservoirParams
  pigmentCoefficients?: PigmentCoefficients
}

type SwapTarget = {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
}

export type PingPongTarget = SwapTarget & {
  swap: () => void
}

export type MaterialMap = {
  zero: THREE.RawShaderMaterial
  splatHeight: THREE.RawShaderMaterial
  splatVelocity: THREE.RawShaderMaterial
  splatPigment: THREE.RawShaderMaterial
  splatBinder: THREE.RawShaderMaterial
  splatDeposit: THREE.RawShaderMaterial
  splatRewetPigment: THREE.RawShaderMaterial
  splatRewetDeposit: THREE.RawShaderMaterial
  advectVelocity: THREE.RawShaderMaterial
  advectHeight: THREE.RawShaderMaterial
  advectPigment: THREE.RawShaderMaterial
  diffusePigment: THREE.RawShaderMaterial
  advectBinder: THREE.RawShaderMaterial
  binderForces: THREE.RawShaderMaterial
  absorbDeposit: THREE.RawShaderMaterial
  absorbHeight: THREE.RawShaderMaterial
  absorbPigment: THREE.RawShaderMaterial
  absorbWet: THREE.RawShaderMaterial
  absorbSettled: THREE.RawShaderMaterial
  diffuseWet: THREE.RawShaderMaterial
  composite: THREE.RawShaderMaterial
  divergence: THREE.RawShaderMaterial
  jacobi: THREE.RawShaderMaterial
  project: THREE.RawShaderMaterial
}
