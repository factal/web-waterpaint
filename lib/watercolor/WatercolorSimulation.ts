import * as THREE from 'three'

import { createMaterials } from './materials'
import {
  createLBMPingPong,
  createPingPong,
  createRenderTarget,
  type PingPongTarget,
} from './targets'
import {
  DEFAULT_ABSORB_EXPONENT,
  DEFAULT_ABSORB_MIN_FLUX,
  DEFAULT_ABSORB_TIME_OFFSET,
  DEFAULT_BINDER_PARAMS,
  DEFAULT_DT,
  DEPOSITION_BASE,
  GRANULATION_SETTLE_RATE,
  GRANULATION_STRENGTH,
  HUMIDITY_INFLUENCE,
  PAPER_DIFFUSION_STRENGTH,
  PIGMENT_DIFFUSION_COEFF,
} from './constants'
import {
  type BinderParams,
  type BrushSettings,
  type MaterialMap,
  type SimulationParams,
} from './types'

const EPSILON = 1e-6

function createFiberField(size: number): THREE.DataTexture {
  const data = new Float32Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const nx = u - 0.5
      const ny = v - 0.5
      const swirl = Math.sin((nx + ny) * Math.PI * 4.0)
      const wave = Math.cos(nx * 6.0 - ny * 5.0)
      const angle = Math.atan2(ny, nx + 1e-6) * 0.35 + swirl * 0.6
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)
      const dPara = 0.7 + 0.25 * wave
      const dPerp = 0.18 + 0.12 * Math.sin((nx - ny) * Math.PI * 6.0)
      data[idx + 0] = 0.5 * (dirX + 1.0)
      data[idx + 1] = 0.5 * (dirY + 1.0)
      data[idx + 2] = Math.max(0.2, dPara)
      data[idx + 3] = Math.max(0.05, dPerp)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

type RenderTargetLike = THREE.WebGLRenderTarget | THREE.WebGLMultipleRenderTargets

type FluidTargets = PingPongTarget<THREE.WebGLMultipleRenderTargets>

type ScalarTargets = PingPongTarget<THREE.WebGLRenderTarget>

export default class WatercolorSimulation {
  private readonly renderer: THREE.WebGLRenderer
  private readonly size: number
  private readonly texelSize: THREE.Vector2
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>
  private readonly materials: MaterialMap
  private readonly fiberTexture: THREE.DataTexture
  private readonly fluid: FluidTargets
  private readonly targets: {
    H: ScalarTargets
    C: ScalarTargets
    B: ScalarTargets
    DEP: ScalarTargets
    W: ScalarTargets
    S: ScalarTargets
  }
  private readonly velocityTarget: THREE.WebGLRenderTarget
  private readonly compositeTarget: THREE.WebGLRenderTarget
  private readonly velocityReductionTargets: THREE.WebGLRenderTarget[]
  private readonly velocityReadBuffer = new Float32Array(4)
  private binderSettings: BinderParams

  constructor(renderer: THREE.WebGLRenderer, size = 512) {
    if (!renderer.capabilities.isWebGL2) {
      throw new Error('WatercolorSimulation requires a WebGL2 context')
    }

    this.renderer = renderer
    this.size = size
    this.texelSize = new THREE.Vector2(1 / size, 1 / size)

    const textureType = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.FloatType

    this.materials = createMaterials(size)
    this.fiberTexture = createFiberField(size)

    this.fluid = createLBMPingPong(size, textureType)
    this.targets = {
      H: createPingPong(size, textureType),
      C: createPingPong(size, textureType),
      B: createPingPong(size, textureType),
      DEP: createPingPong(size, textureType),
      W: createPingPong(size, textureType),
      S: createPingPong(size, textureType),
    }

    this.velocityTarget = createRenderTarget(size, textureType)
    this.compositeTarget = createRenderTarget(size, textureType)
    this.velocityReductionTargets = this.createVelocityReductionTargets(textureType)

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materials.zero)
    this.scene.add(this.quad)

    this.binderSettings = { ...DEFAULT_BINDER_PARAMS }

    this.activeSlot.fill(-1)
    for (let i = SPH_MAX_PARTICLES - 1; i >= 0; i -= 1) {
      this.freeList.push(i)
      this.mass[i] = SPH_PARTICLE_MASS
      this.density[i] = this.restDensity
      this.infiltration[i] = ABSORPTION_MIN_LENGTH
    }

    this.gridCellSize = this.smoothingRadius
    this.gridResolution = Math.max(1, Math.ceil(1 / this.gridCellSize))
    this.gridHead = new Int32Array(this.gridResolution * this.gridResolution)
    this.gridNext = new Int32Array(SPH_MAX_PARTICLES)

    this.poly6Coeff = 4 / (Math.PI * Math.pow(this.smoothingRadius, 8))
    this.spikyGradCoeff = -30 / (Math.PI * Math.pow(this.smoothingRadius, 5))
    this.viscLaplacianCoeff = 40 / (Math.PI * Math.pow(this.smoothingRadius, 5))

    this.reset()
  }

  get outputTexture(): THREE.Texture {
    return this.compositeTarget.texture
  }

  reset() {
    const zero = this.materials.zero
    this.renderToTarget(zero, this.targets.H.read)
    this.renderToTarget(zero, this.targets.H.write)
    this.renderToTarget(zero, this.targets.C.read)
    this.renderToTarget(zero, this.targets.C.write)
    this.renderToTarget(zero, this.targets.B.read)
    this.renderToTarget(zero, this.targets.B.write)
    this.renderToTarget(zero, this.targets.DEP.read)
    this.renderToTarget(zero, this.targets.DEP.write)
    this.renderToTarget(zero, this.targets.W.read)
    this.renderToTarget(zero, this.targets.W.write)
    this.renderToTarget(zero, this.targets.S.read)
    this.renderToTarget(zero, this.targets.S.write)
    this.renderToTarget(zero, this.velocityTarget)
    this.renderToTarget(zero, this.compositeTarget)

    const lbmInit = this.materials.lbmInit
    this.renderToTarget(lbmInit, this.fluid.read)
    this.renderToTarget(lbmInit, this.fluid.write)

    const composite = this.materials.composite
    composite.uniforms.uDeposits.value = this.targets.DEP.read.texture
    this.renderToTarget(composite, this.compositeTarget)
  }

  dispose() {
    this.quad.geometry.dispose()
    Object.values(this.materials).forEach((material) => material.dispose())
    this.fiberTexture.dispose()
    this.velocityTarget.dispose()
    this.compositeTarget.dispose()
    this.fluid.read.dispose()
    this.fluid.write.dispose()
    Object.values(this.targets).forEach((target) => {
      target.read.dispose()
      target.write.dispose()
    })
    this.velocityReductionTargets.forEach((target) => target.dispose())
  }

  splat(brush: BrushSettings) {
    const { center, radius, flow, type, color } = brush
    const toolType = type === 'pigment' ? 1 : 0

    const centerVec = new THREE.Vector2(center[0], center[1])

    const splatHeight = this.materials.splatHeight
    splatHeight.uniforms.uSource.value = this.targets.H.read.texture
    splatHeight.uniforms.uCenter.value.copy(centerVec)
    splatHeight.uniforms.uRadius.value = radius
    splatHeight.uniforms.uFlow.value = flow
    splatHeight.uniforms.uToolType.value = toolType
    this.renderToTarget(splatHeight, this.targets.H.write)
    this.targets.H.swap()

    if (type === 'pigment') {
      const splatPigment = this.materials.splatPigment
      splatPigment.uniforms.uSource.value = this.targets.C.read.texture
      splatPigment.uniforms.uCenter.value.copy(centerVec)
      splatPigment.uniforms.uRadius.value = radius
      splatPigment.uniforms.uFlow.value = flow
      splatPigment.uniforms.uToolType.value = toolType
      splatPigment.uniforms.uPigment.value.set(color[0], color[1], color[2])
      this.renderToTarget(splatPigment, this.targets.C.write)
      this.targets.C.swap()

      const splatBinder = this.materials.splatBinder
      splatBinder.uniforms.uSource.value = this.targets.B.read.texture
      splatBinder.uniforms.uCenter.value.copy(centerVec)
      splatBinder.uniforms.uRadius.value = radius
      splatBinder.uniforms.uFlow.value = flow
      splatBinder.uniforms.uToolType.value = toolType
      splatBinder.uniforms.uBinderStrength.value = this.binderSettings.injection
      this.renderToTarget(splatBinder, this.targets.B.write)
      this.targets.B.swap()
    }
  }

  step(params: SimulationParams, dt = DEFAULT_DT) {
    if (dt <= 0) {
      return
    }

    this.binderSettings = { ...params.binder }

    const substeps = this.determineSubsteps(params, dt)
    const subDt = dt / substeps

    for (let i = 0; i < substeps; i += 1) {
      this.integrate(subDt, params)
    }

    this.renderComposite()
  }

  private integrate(dt: number, params: SimulationParams) {
    this.simulateFluid(dt, params)
    this.updateBinder(dt)
    this.updateHeight(dt)
    this.updatePigment(dt)
    this.applyAbsorption(dt, params)
    this.applyPaperDiffusion(dt, params.absorb * dt)
  }

  private simulateFluid(dt: number, params: SimulationParams) {
    const lbmStep = this.materials.lbmStep
    lbmStep.uniforms.uState0.value = this.fluid.read.texture[0]
    lbmStep.uniforms.uState1.value = this.fluid.read.texture[1]
    lbmStep.uniforms.uState2.value = this.fluid.read.texture[2]
    lbmStep.uniforms.uHeight.value = this.targets.H.read.texture
    lbmStep.uniforms.uBinder.value = this.targets.B.read.texture
    lbmStep.uniforms.uDt.value = dt
    lbmStep.uniforms.uGravity.value = params.grav
    lbmStep.uniforms.uViscosity.value = params.visc
    lbmStep.uniforms.uBinderViscosity.value = this.binderSettings.viscosity
    this.renderToTarget(lbmStep, this.fluid.write)
    this.fluid.swap()

    const lbmMacro = this.materials.lbmMacro
    lbmMacro.uniforms.uState0.value = this.fluid.read.texture[0]
    lbmMacro.uniforms.uState1.value = this.fluid.read.texture[1]
    lbmMacro.uniforms.uState2.value = this.fluid.read.texture[2]
    this.renderToTarget(lbmMacro, this.velocityTarget)
  }

  private updateBinder(dt: number) {
    const binderUpdate = this.materials.binderUpdate
    binderUpdate.uniforms.uBinder.value = this.targets.B.read.texture
    binderUpdate.uniforms.uVelocity.value = this.velocityTarget.texture
    binderUpdate.uniforms.uDt.value = dt
    binderUpdate.uniforms.uDiffusion.value = this.binderSettings.diffusion
    binderUpdate.uniforms.uDecay.value = this.binderSettings.decay
    this.renderToTarget(binderUpdate, this.targets.B.write)
    this.targets.B.swap()
  }

  private updateHeight(dt: number) {
    const advectHeight = this.materials.advectHeight
    advectHeight.uniforms.uHeight.value = this.targets.H.read.texture
    advectHeight.uniforms.uVelocity.value = this.velocityTarget.texture
    advectHeight.uniforms.uBinder.value = this.targets.B.read.texture
    advectHeight.uniforms.uBinderBuoyancy.value = this.binderSettings.buoyancy
    advectHeight.uniforms.uDt.value = dt
    this.renderToTarget(advectHeight, this.targets.H.write)
    this.targets.H.swap()
  }

  private updatePigment(dt: number) {
    const advectPigment = this.materials.advectPigment
    advectPigment.uniforms.uPigment.value = this.targets.C.read.texture
    advectPigment.uniforms.uVelocity.value = this.velocityTarget.texture
    advectPigment.uniforms.uDt.value = dt
    this.renderToTarget(advectPigment, this.targets.C.write)
    this.targets.C.swap()

    const diffusePigment = this.materials.diffusePigment
    diffusePigment.uniforms.uPigment.value = this.targets.C.read.texture
    diffusePigment.uniforms.uDiffusion.value = PIGMENT_DIFFUSION_COEFF
    diffusePigment.uniforms.uDt.value = dt
    this.renderToTarget(diffusePigment, this.targets.C.write)
    this.targets.C.swap()
  }

  private applyAbsorption(dt: number, params: SimulationParams) {
    const absorbFactor = params.absorb * dt
    const evapFactor = params.evap * dt
    const edgeFactor = params.edge * dt
    const settleFactor = params.granulation ? GRANULATION_SETTLE_RATE * dt : 0
    const granStrength = params.granulation ? GRANULATION_STRENGTH : 0
    const beta = params.stateAbsorption ? params.absorbExponent ?? DEFAULT_ABSORB_EXPONENT : 1
    const humidityInfluence = params.stateAbsorption ? HUMIDITY_INFLUENCE : 0
    const absorbMin = params.absorbMinFlux ?? DEFAULT_ABSORB_MIN_FLUX
    const timeOffset = params.absorbTimeOffset ?? DEFAULT_ABSORB_TIME_OFFSET

    const absorbDeposit = this.materials.absorbDeposit
    this.assignAbsorbUniforms(
      absorbDeposit,
      absorbFactor,
      evapFactor,
      edgeFactor,
      settleFactor,
      beta,
      humidityInfluence,
      granStrength,
      params.backrunStrength,
      absorbMin,
      timeOffset,
    )
    this.renderToTarget(absorbDeposit, this.targets.DEP.write)

    const absorbHeight = this.materials.absorbHeight
    this.assignAbsorbUniforms(
      absorbHeight,
      absorbFactor,
      evapFactor,
      edgeFactor,
      settleFactor,
      beta,
      humidityInfluence,
      granStrength,
      params.backrunStrength,
      absorbMin,
      timeOffset,
    )
    this.renderToTarget(absorbHeight, this.targets.H.write)

    const absorbPigment = this.materials.absorbPigment
    this.assignAbsorbUniforms(
      absorbPigment,
      absorbFactor,
      evapFactor,
      edgeFactor,
      settleFactor,
      beta,
      humidityInfluence,
      granStrength,
      params.backrunStrength,
      absorbMin,
      timeOffset,
    )
    this.renderToTarget(absorbPigment, this.targets.C.write)

    const absorbWet = this.materials.absorbWet
    this.assignAbsorbUniforms(
      absorbWet,
      absorbFactor,
      evapFactor,
      edgeFactor,
      settleFactor,
      beta,
      humidityInfluence,
      granStrength,
      params.backrunStrength,
      absorbMin,
      timeOffset,
    )
    this.renderToTarget(absorbWet, this.targets.W.write)

    const absorbSettled = this.materials.absorbSettled
    this.assignAbsorbUniforms(
      absorbSettled,
      absorbFactor,
      evapFactor,
      edgeFactor,
      settleFactor,
      beta,
      humidityInfluence,
      granStrength,
      params.backrunStrength,
      absorbMin,
      timeOffset,
    )
    this.renderToTarget(absorbSettled, this.targets.S.write)

    this.targets.DEP.swap()
    this.targets.H.swap()
    this.targets.C.swap()
    this.targets.W.swap()
    this.targets.S.swap()
  }

  private applyPaperDiffusion(dt: number, replenish: number) {
    const diffuseWet = this.materials.paperDiffuse
    diffuseWet.uniforms.uWet.value = this.targets.W.read.texture
    diffuseWet.uniforms.uFiber.value = this.fiberTexture
    diffuseWet.uniforms.uStrength.value = PAPER_DIFFUSION_STRENGTH
    diffuseWet.uniforms.uDt.value = dt
    diffuseWet.uniforms.uReplenish.value = replenish
    this.renderToTarget(diffuseWet, this.targets.W.write)
    this.targets.W.swap()
  }

  private determineSubsteps(params: SimulationParams, dt: number): number {
    const maxSubsteps = Math.max(1, Math.floor(params.maxSubsteps))
    const maxVelocity = this.computeMaxVelocity()
    if (maxVelocity < EPSILON) {
      return 1
    }

    const maxDt = params.cfl / Math.max(maxVelocity * this.size, EPSILON)
    const needed = Math.ceil(dt / Math.max(maxDt, EPSILON))
    return Math.max(1, Math.min(maxSubsteps, needed))
  }

  private computeMaxVelocity(): number {
    let source: RenderTargetLike = this.velocityTarget
    const velocityMax = this.materials.velocityMax

    for (let i = 0; i < this.velocityReductionTargets.length; i += 1) {
      const target = this.velocityReductionTargets[i]
      const width = source instanceof THREE.WebGLMultipleRenderTargets ? source.width : source.width
      const height = source instanceof THREE.WebGLMultipleRenderTargets ? source.height : source.height
      velocityMax.uniforms.uVelocity.value =
        source instanceof THREE.WebGLMultipleRenderTargets ? source.texture[0] : source.texture
      velocityMax.uniforms.uTexel.value.set(1 / width, 1 / height)
      this.renderToTarget(velocityMax, target)
      source = target
    }

    const last = this.velocityReductionTargets[this.velocityReductionTargets.length - 1]
    this.renderer.readRenderTargetPixels(last, 0, 0, 1, 1, this.velocityReadBuffer)
    return this.velocityReadBuffer[0]
  }

  private renderComposite() {
    const composite = this.materials.composite
    composite.uniforms.uDeposits.value = this.targets.DEP.read.texture
    this.renderToTarget(composite, this.compositeTarget)
  }

  private renderToTarget(material: THREE.RawShaderMaterial, target: RenderTargetLike) {
    const previous = this.renderer.getRenderTarget()
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(previous)
  }

  private assignAbsorbUniforms(
    material: THREE.RawShaderMaterial,
    absorb: number,
    evap: number,
    edge: number,
    settle: number,
    beta: number,
    humidityInfluence: number,
    granulation: number,
    backrun: number,
    absorbMin: number,
    timeOffset: number,
  ) {
    material.uniforms.uHeight.value = this.targets.H.read.texture
    material.uniforms.uPigment.value = this.targets.C.read.texture
    material.uniforms.uWet.value = this.targets.W.read.texture
    material.uniforms.uDeposits.value = this.targets.DEP.read.texture
    material.uniforms.uSettled.value = this.targets.S.read.texture
    material.uniforms.uAbsorb.value = absorb
    material.uniforms.uEvap.value = evap
    material.uniforms.uEdge.value = edge
    material.uniforms.uDepBase.value = DEPOSITION_BASE
    material.uniforms.uBeta.value = beta
    material.uniforms.uHumidity.value = humidityInfluence
    material.uniforms.uSettle.value = settle
    material.uniforms.uGranStrength.value = granulation
    material.uniforms.uBackrunStrength.value = backrun
    material.uniforms.uAbsorbMin.value = absorbMin
    material.uniforms.uTimeOffset.value = timeOffset
  }

  private createVelocityReductionTargets(type: THREE.TextureDataType): THREE.WebGLRenderTarget[] {
    const targets: THREE.WebGLRenderTarget[] = []
    let width = this.size
    let height = this.size
    while (width > 1 || height > 1) {
      width = Math.max(1, Math.floor(width / 2))
      height = Math.max(1, Math.floor(height / 2))
      const target = createRenderTarget(width, type)
      targets.push(target)
      if (width === 1 && height === 1) {
        break
      }
    }
    if (targets.length === 0) {
      targets.push(createRenderTarget(1, type))
    }
    return targets
  }
}
