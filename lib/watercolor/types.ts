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
  absorbExponent: number
  absorbTimeOffset: number
  absorbMinFlux: number
  cfl: number
  maxSubsteps: number
  binder: BinderParams
  reservoir: ReservoirParams
}

export interface MaterialMap {
  zero: THREE.RawShaderMaterial
  composite: THREE.RawShaderMaterial
}
