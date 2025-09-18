import * as THREE from 'three'

export type BrushType = 'water' | 'pigment'

export interface BrushSettings {
  center: [number, number]
  radius: number
  flow: number
  type: BrushType
  color: [number, number, number]
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
  backrunStrength: number
  paperTextureStrength: number
  absorbExponent: number
  absorbTimeOffset: number
  absorbMinFlux: number
  cfl: number
  maxSubsteps: number
  binder: BinderParams
  reservoir: ReservoirParams
}

type SwapTarget = {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
}

export type PingPongTarget = SwapTarget & {
  swap: () => void
}

export type MaterialTriplet = [
  THREE.RawShaderMaterial,
  THREE.RawShaderMaterial,
  THREE.RawShaderMaterial,
]

export type MaterialMap = {
  zero: THREE.RawShaderMaterial
  splatPigment: THREE.RawShaderMaterial
  splatBinder: THREE.RawShaderMaterial
  advectPigment: THREE.RawShaderMaterial
  diffusePigment: THREE.RawShaderMaterial
  advectBinder: THREE.RawShaderMaterial
  absorbDeposit: THREE.RawShaderMaterial
  absorbHeight: THREE.RawShaderMaterial
  absorbPigment: THREE.RawShaderMaterial
  absorbWet: THREE.RawShaderMaterial
  absorbSettled: THREE.RawShaderMaterial
  diffuseWet: THREE.RawShaderMaterial
  composite: THREE.RawShaderMaterial
  lbmForce: THREE.RawShaderMaterial
  lbmSplat: MaterialTriplet
  lbmCollision: MaterialTriplet
  lbmStreaming: MaterialTriplet
  lbmMatch: MaterialTriplet
  lbmMacroscopic: THREE.RawShaderMaterial
  lbmDensity: THREE.RawShaderMaterial
}
