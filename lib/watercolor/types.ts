import * as THREE from 'three'

export type BrushType = 'water' | 'pigment' | 'spatter'

export type BrushMaskKind = 'stroke' | 'droplet'

export interface BrushMaskInstance {
  kind: BrushMaskKind
  texture: THREE.Texture
  strength: number
  flowScale: number
  velocity?: [number, number]
  velocityStrength?: number
}

export interface BrushSettings {
  flow: number
  type: BrushType
  color: [number, number, number]
  dryness?: number
  dryThreshold?: number
  lowSolvent?: number
  binderBoost?: number
  pigmentBoost?: number
  depositBoost?: number
  mask: BrushMaskInstance
}

export type ChannelCoefficients = [number, number, number]

export type PigmentOpticalTable = readonly [
  ChannelCoefficients,
  ChannelCoefficients,
  ChannelCoefficients,
]

export interface PigmentOpticalSettings {
  absorption: PigmentOpticalTable
  scattering: PigmentOpticalTable
  binderScatter: number
}

export interface PigmentCoefficients {
  diffusion?: ChannelCoefficients
  settle?: ChannelCoefficients
  absorption?: PigmentOpticalTable
  scattering?: PigmentOpticalTable
  binderScatter?: number
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
}

export interface SurfaceTensionParams {
  enabled: boolean
  strength: number
  threshold: number
  breakThreshold: number
  snapStrength: number
  velocityLimit: number
}

export interface CapillaryFringeParams {
  enabled: boolean
  strength: number
  threshold: number
  noiseScale: number
}

export interface EvaporationRingParams {
  enabled: boolean
  strength: number
  filmThreshold: number
  filmFeather: number
  gradientScale: number
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
  sizingInfluence: number
  absorbExponent: number
  absorbTimeOffset: number
  absorbMinFlux: number
  cfl: number
  maxSubsteps: number
  binder: BinderParams
  reservoir: ReservoirParams
  surfaceTension: SurfaceTensionParams
  capillaryFringe: CapillaryFringeParams
  evaporationRings: EvaporationRingParams
  pigmentCoefficients?: PigmentCoefficients
}

type SwapTarget = {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
}

export type PingPongTarget = SwapTarget & {
  swap: () => void
}

type WetDiffusionUniforms = {
  uWet: THREE.IUniform
  uFiber: THREE.IUniform
  uTexel: THREE.IUniform
  uDt: THREE.IUniform
  uReplenish: THREE.IUniform
  uStrength: THREE.IUniform
  uFringeStrength: THREE.IUniform
  uFringeThreshold: THREE.IUniform
  uFringeNoiseScale: THREE.IUniform
}

export type DiffuseWetMaterial = THREE.RawShaderMaterial & {
  uniforms: WetDiffusionUniforms
}

export type MaterialMap = {
  zero: THREE.RawShaderMaterial
  strokeMask: THREE.RawShaderMaterial
  splatHeight: THREE.RawShaderMaterial
  splatVelocity: THREE.RawShaderMaterial
  splatPigment: THREE.RawShaderMaterial
  splatBinder: THREE.RawShaderMaterial
  splatDeposit: THREE.RawShaderMaterial
  splatRewetPigment: THREE.RawShaderMaterial
  splatRewetDeposit: THREE.RawShaderMaterial
  advectVelocity: THREE.RawShaderMaterial
  advectHeight: THREE.RawShaderMaterial
  surfaceTension: THREE.RawShaderMaterial
  advectPigment: THREE.RawShaderMaterial
  diffusePigment: THREE.RawShaderMaterial
  advectBinder: THREE.RawShaderMaterial
  binderForces: THREE.RawShaderMaterial
  absorbDeposit: THREE.RawShaderMaterial
  absorbHeight: THREE.RawShaderMaterial
  absorbPigment: THREE.RawShaderMaterial
  absorbWet: THREE.RawShaderMaterial
  absorbSettled: THREE.RawShaderMaterial
  evaporationRings: THREE.RawShaderMaterial
  diffuseWet: DiffuseWetMaterial
  composite: THREE.RawShaderMaterial
  divergence: THREE.RawShaderMaterial
  jacobi: THREE.RawShaderMaterial
  project: THREE.RawShaderMaterial
}
