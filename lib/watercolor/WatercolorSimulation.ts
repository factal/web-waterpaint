import * as THREE from 'three'

import { createMaterials, createVelocityMaxMaterial } from './materials'
import { createFiberField, createPingPong, createRenderTarget } from './targets'
import {
  DEFAULT_BINDER_PARAMS,
  DEFAULT_DT,
  DEPOSITION_BASE,
  GRANULATION_SETTLE_RATE,
  GRANULATION_STRENGTH,
  HUMIDITY_INFLUENCE,
  PIGMENT_DIFFUSION_COEFF,
} from './constants'
import {
  type BinderParams,
  type BrushSettings,
  type MaterialMap,
  type MaterialTriplet,
  type PingPongTarget,
  type SimulationParams,
} from './types'

// GPU-driven watercolor solver combining lattice-Boltzmann flow, pigment transport, and paper optics.
// WatercolorSimulation coordinates all render passes and exposes a simple API.
export default class WatercolorSimulation {
  private readonly renderer: THREE.WebGLRenderer
  private readonly size: number
  private readonly texelSize: THREE.Vector2
  private readonly targets: {
    H: PingPongTarget
    UV: PingPongTarget
    C: PingPongTarget
    B: PingPongTarget
    DEP: PingPongTarget
    W: PingPongTarget
    S: PingPongTarget
    F0: PingPongTarget
    F1: PingPongTarget
    F2: PingPongTarget
  }
  private readonly forceTarget: THREE.WebGLRenderTarget
  private readonly compositeTarget: THREE.WebGLRenderTarget
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>
  private readonly materials: MaterialMap
  private readonly fiberTexture: THREE.DataTexture
  private readonly lbmTargets: [PingPongTarget, PingPongTarget, PingPongTarget]
  private readonly velocityReductionTargets: THREE.WebGLRenderTarget[]
  private readonly velocityMaxMaterial: THREE.RawShaderMaterial
  private readonly velocityReadBuffer = new Float32Array(4)
  private binderSettings: BinderParams
  private absorbElapsed = 0

  // Set up render targets, materials, and state needed for the solver.
  constructor(renderer: THREE.WebGLRenderer, size = 512) {
    if (!renderer.capabilities.isWebGL2) {
      throw new Error('WatercolorSimulation requires a WebGL2 context')
    }

    this.renderer = renderer
    this.size = size
    this.texelSize = new THREE.Vector2(1 / size, 1 / size)

    const textureType = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.FloatType

    this.targets = {
      H: createPingPong(size, textureType),
      UV: createPingPong(size, textureType),
      C: createPingPong(size, textureType),
      B: createPingPong(size, textureType),
      DEP: createPingPong(size, textureType),
      W: createPingPong(size, textureType),
      S: createPingPong(size, textureType),
      F0: createPingPong(size, textureType),
      F1: createPingPong(size, textureType),
      F2: createPingPong(size, textureType),
    }
    this.forceTarget = createRenderTarget(size, textureType)
    this.compositeTarget = createRenderTarget(size, textureType)
    this.fiberTexture = createFiberField(size)

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.materials = createMaterials(this.texelSize, this.fiberTexture)
    this.lbmTargets = [this.targets.F0, this.targets.F1, this.targets.F2]

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materials.zero)
    this.scene.add(this.quad)

    this.velocityMaxMaterial = createVelocityMaxMaterial(this.texelSize)
    this.velocityReductionTargets = this.createVelocityReductionTargets(size)
    this.binderSettings = { ...DEFAULT_BINDER_PARAMS }

    this.reset()
  }

  get outputTexture(): THREE.Texture {
    return this.compositeTarget.texture
  }

  // Inject water or pigment into the simulation at a given position.
  splat(brush: BrushSettings) {
    const { center, radius, flow, type, color } = brush
    const toolType = type === 'water' ? 0 : 1

    this.runLbmTriplet(this.materials.lbmSplat, (material) => {
      const uniforms = material.uniforms as Record<string, THREE.IUniform>
      const centerUniform = uniforms.uCenter.value as THREE.Vector2
      centerUniform.set(center[0], center[1])
      uniforms.uRadius.value = radius
      uniforms.uFlow.value = flow
      uniforms.uToolType.value = toolType
    })


    const splatPigment = this.materials.splatPigment
    splatPigment.uniforms.uSource.value = this.targets.C.read.texture
    splatPigment.uniforms.uCenter.value.set(center[0], center[1])
    splatPigment.uniforms.uRadius.value = radius
    splatPigment.uniforms.uFlow.value = flow
    splatPigment.uniforms.uToolType.value = toolType
    splatPigment.uniforms.uPigment.value.set(color[0], color[1], color[2])
    this.renderToTarget(splatPigment, this.targets.C.write)
    this.targets.C.swap()

    const splatBinder = this.materials.splatBinder
    splatBinder.uniforms.uSource.value = this.targets.B.read.texture
    splatBinder.uniforms.uCenter.value.set(center[0], center[1])
    splatBinder.uniforms.uRadius.value = radius
    splatBinder.uniforms.uFlow.value = flow
    splatBinder.uniforms.uToolType.value = toolType
    splatBinder.uniforms.uBinderStrength.value = this.binderSettings.injection
    this.renderToTarget(splatBinder, this.targets.B.write)
    this.targets.B.swap()

    this.runLbmMacroscopic()

    const absorbReset = toolType === 0 ? 0.3 : 0.15
    this.absorbElapsed = Math.max(0, this.absorbElapsed - absorbReset * flow)
  }

  // Run one simulation step using LBM dynamics and watercolor-specific processes.
  step(params: SimulationParams, dt = DEFAULT_DT) {
    const {
      grav,
      visc,
      absorb,
      evap,
      edge,
      stateAbsorption,
      granulation,
      backrunStrength,
      absorbExponent,
      absorbTimeOffset,
      absorbMinFlux,
      cfl,
      maxSubsteps,
      binder,
    } = params

    this.binderSettings = { ...binder }

    const substeps = this.determineSubsteps(cfl, maxSubsteps, dt)
    const substepDt = dt / substeps

    for (let i = 0; i < substeps; i += 1) {
      const advectBinder = this.materials.advectBinder
      advectBinder.uniforms.uBinder.value = this.targets.B.read.texture
      advectBinder.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectBinder.uniforms.uDt.value = substepDt
      advectBinder.uniforms.uDiffusion.value = binder.diffusion
      advectBinder.uniforms.uDecay.value = binder.decay
      this.renderToTarget(advectBinder, this.targets.B.write)
      this.targets.B.swap()

      const lbmForce = this.materials.lbmForce
      lbmForce.uniforms.uHeight.value = this.targets.H.read.texture
      lbmForce.uniforms.uBinder.value = this.targets.B.read.texture
      lbmForce.uniforms.uVelocity.value = this.targets.UV.read.texture
      lbmForce.uniforms.uGrav.value = grav
      lbmForce.uniforms.uViscosity.value = visc
      lbmForce.uniforms.uBinderElasticity.value = binder.elasticity
      lbmForce.uniforms.uBinderViscosity.value = binder.viscosity
      lbmForce.uniforms.uBinderBuoyancy.value = binder.buoyancy
      this.renderToTarget(lbmForce, this.forceTarget)

      this.runLbmTriplet(this.materials.lbmCollision, (material) => {
        const uniforms = material.uniforms as Record<string, THREE.IUniform>
        uniforms.uForce.value = this.forceTarget.texture
        uniforms.uVisc.value = visc
        uniforms.uDt.value = substepDt
      })

      this.runLbmTriplet(this.materials.lbmStreaming)

      this.runLbmMacroscopic()

      const advectPigment = this.materials.advectPigment
      advectPigment.uniforms.uPigment.value = this.targets.C.read.texture
      advectPigment.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectPigment.uniforms.uDt.value = substepDt
      this.renderToTarget(advectPigment, this.targets.C.write)
      this.targets.C.swap()

      const diffusePigment = this.materials.diffusePigment
      diffusePigment.uniforms.uPigment.value = this.targets.C.read.texture
      diffusePigment.uniforms.uDiffusion.value = PIGMENT_DIFFUSION_COEFF
      diffusePigment.uniforms.uDt.value = substepDt
      this.renderToTarget(diffusePigment, this.targets.C.write)
      this.targets.C.swap()

      const absorbBase = absorb * substepDt
      const evapFactor = evap * substepDt
      const edgeFactor = edge * substepDt
      const beta = stateAbsorption ? absorbExponent : 1.0
      const humidityInfluence = stateAbsorption ? HUMIDITY_INFLUENCE : 0.0
      const settleBase = granulation ? GRANULATION_SETTLE_RATE : 0.0
      const granStrength = granulation ? GRANULATION_STRENGTH : 0.0
      const settleFactor = settleBase * substepDt
      const timeOffset = stateAbsorption ? Math.max(absorbTimeOffset, 1e-4) : 1.0
      const absorbTime = stateAbsorption ? this.absorbElapsed + 0.5 * substepDt : 0
      const absorbFloor = stateAbsorption ? Math.max(absorbMinFlux, 0) * substepDt : 0
      const decay = stateAbsorption ? 1 / Math.sqrt(absorbTime + timeOffset) : 1
      const paperReplenish = absorbBase * decay

      const absorbDeposit = this.materials.absorbDeposit
      this.assignAbsorbUniforms(
        absorbDeposit,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleFactor,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
      )
      this.renderToTarget(absorbDeposit, this.targets.DEP.write)

      const absorbHeight = this.materials.absorbHeight
      this.assignAbsorbUniforms(
        absorbHeight,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleFactor,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
      )
      this.renderToTarget(absorbHeight, this.targets.H.write)

      const absorbPigment = this.materials.absorbPigment
      this.assignAbsorbUniforms(
        absorbPigment,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleFactor,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
      )
      this.renderToTarget(absorbPigment, this.targets.C.write)

      const absorbWet = this.materials.absorbWet
      this.assignAbsorbUniforms(
        absorbWet,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleFactor,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
      )
      this.renderToTarget(absorbWet, this.targets.W.write)

      const absorbSettled = this.materials.absorbSettled
      this.assignAbsorbUniforms(
        absorbSettled,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleFactor,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
      )
      this.renderToTarget(absorbSettled, this.targets.S.write)

      this.targets.DEP.swap()
      this.targets.H.swap()
      this.targets.C.swap()
      this.targets.W.swap()
      this.targets.S.swap()

      this.applyPaperDiffusion(substepDt, paperReplenish)
      this.rescaleLbmDistributions()
      this.runLbmMacroscopic()
      if (stateAbsorption) {
        this.absorbElapsed += substepDt
      } else {
        this.absorbElapsed = 0
      }
    }

    const composite = this.materials.composite
    composite.uniforms.uDeposits.value = this.targets.DEP.read.texture
    this.renderToTarget(composite, this.compositeTarget)
  }

  // Diffuse moisture along the paper fiber field to keep edges alive.
  private applyPaperDiffusion(dt: number, replenish: number) {
    const diffuse = this.materials.diffuseWet
    diffuse.uniforms.uWet.value = this.targets.W.read.texture
    diffuse.uniforms.uDt.value = dt
    diffuse.uniforms.uReplenish.value = replenish
    this.renderToTarget(diffuse, this.targets.W.write)
    this.targets.W.swap()
  }

  private runLbmTriplet(
    triplet: MaterialTriplet,
    assign?: (material: THREE.RawShaderMaterial, index: number) => void,
  ) {
    const f0 = this.targets.F0.read.texture
    const f1 = this.targets.F1.read.texture
    const f2 = this.targets.F2.read.texture
    triplet.forEach((material, index) => {
      const uniforms = material.uniforms as Record<string, THREE.IUniform>
      uniforms.uF0.value = f0
      uniforms.uF1.value = f1
      uniforms.uF2.value = f2
      if (assign) assign(material, index)
      this.renderToTarget(material, this.lbmTargets[index].write)
    })
    this.lbmTargets.forEach((target) => target.swap())
  }

  private runLbmMacroscopic() {
    const macroscopic = this.materials.lbmMacroscopic
    macroscopic.uniforms.uF0.value = this.targets.F0.read.texture
    macroscopic.uniforms.uF1.value = this.targets.F1.read.texture
    macroscopic.uniforms.uF2.value = this.targets.F2.read.texture
    this.renderToTarget(macroscopic, this.targets.UV.write)
    this.targets.UV.swap()

    const density = this.materials.lbmDensity
    density.uniforms.uState.value = this.targets.UV.read.texture
    this.renderToTarget(density, this.targets.H.write)
    this.targets.H.swap()
  }

  private rescaleLbmDistributions() {
    const stateTexture = this.targets.UV.read.texture
    const densityTexture = this.targets.H.read.texture
    this.runLbmTriplet(this.materials.lbmMatch, (material) => {
      const uniforms = material.uniforms as Record<string, THREE.IUniform>
      uniforms.uState.value = stateTexture
      uniforms.uNewDensity.value = densityTexture
    })
  }

  // Clear all render targets so the canvas returns to a blank state.
  reset() {
    this.clearPingPong(this.targets.H)
    this.clearPingPong(this.targets.UV)
    this.clearPingPong(this.targets.C)
    this.clearPingPong(this.targets.B)
    this.clearPingPong(this.targets.DEP)
    this.clearPingPong(this.targets.W)
    this.clearPingPong(this.targets.S)
    this.clearPingPong(this.targets.F0)
    this.clearPingPong(this.targets.F1)
    this.clearPingPong(this.targets.F2)
    this.renderToTarget(this.materials.zero, this.forceTarget)
    this.renderToTarget(this.materials.zero, this.compositeTarget)
    this.absorbElapsed = 0
  }

  // Release GPU allocations when the simulation is no longer needed.
  dispose() {
    this.quad.geometry.dispose()
    Object.values(this.materials).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((mat) => mat.dispose())
      } else {
        value.dispose()
      }
    })
    this.velocityMaxMaterial.dispose()
    this.clearTargets()
    this.fiberTexture.dispose()
    this.velocityReductionTargets.forEach((target) => target.dispose())
  }

  // Dispose both read/write targets to avoid leaking GPU textures.
  private clearTargets() {
    this.targets.H.read.dispose()
    this.targets.H.write.dispose()
    this.targets.UV.read.dispose()
    this.targets.UV.write.dispose()
    this.targets.C.read.dispose()
    this.targets.C.write.dispose()
    this.targets.B.read.dispose()
    this.targets.B.write.dispose()
    this.targets.DEP.read.dispose()
    this.targets.DEP.write.dispose()
    this.targets.W.read.dispose()
    this.targets.W.write.dispose()
    this.targets.S.read.dispose()
    this.targets.S.write.dispose()
    this.targets.F0.read.dispose()
    this.targets.F0.write.dispose()
    this.targets.F1.read.dispose()
    this.targets.F1.write.dispose()
    this.targets.F2.read.dispose()
    this.targets.F2.write.dispose()
    this.forceTarget.dispose()
    this.compositeTarget.dispose()
  }

  // Fill both buffers of a ping-pong target with zeros.
  private clearPingPong(target: PingPongTarget) {
    this.renderToTarget(this.materials.zero, target.read)
    this.renderToTarget(this.materials.zero, target.write)
  }

  // Render a fullscreen quad with the provided material into a target.
  private renderToTarget(material: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    const previousTarget = this.renderer.getRenderTarget()
    const previousAutoClear = this.renderer.autoClear

    this.renderer.autoClear = false
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(previousTarget)
    this.renderer.autoClear = previousAutoClear
  }

  // Share the same uniform assignments across the different absorb passes.
  private assignAbsorbUniforms(
    material: THREE.RawShaderMaterial,
    absorb: number,
    evap: number,
    edge: number,
    settle: number,
    beta: number,
    humidity: number,
    granStrength: number,
    backrunStrength: number,
    absorbTime: number,
    timeOffset: number,
    absorbFloor: number,
  ) {
    const uniforms = material.uniforms as Record<string, THREE.IUniform>
    uniforms.uHeight.value = this.targets.H.read.texture
    uniforms.uPigment.value = this.targets.C.read.texture
    uniforms.uWet.value = this.targets.W.read.texture
    uniforms.uDeposits.value = this.targets.DEP.read.texture
    if (uniforms.uSettled) uniforms.uSettled.value = this.targets.S.read.texture
    uniforms.uAbsorb.value = absorb
    uniforms.uEvap.value = evap
    uniforms.uEdge.value = edge
    uniforms.uDepBase.value = DEPOSITION_BASE
    if (uniforms.uBeta) uniforms.uBeta.value = beta
    if (uniforms.uHumidity) uniforms.uHumidity.value = humidity
    if (uniforms.uSettle) uniforms.uSettle.value = settle
    if (uniforms.uGranStrength) uniforms.uGranStrength.value = granStrength
    if (uniforms.uBackrunStrength) uniforms.uBackrunStrength.value = backrunStrength
    if (uniforms.uAbsorbTime) uniforms.uAbsorbTime.value = absorbTime
    if (uniforms.uAbsorbTimeOffset) uniforms.uAbsorbTimeOffset.value = timeOffset
    if (uniforms.uAbsorbFloor) uniforms.uAbsorbFloor.value = absorbFloor
  }

  private createVelocityReductionTargets(size: number): THREE.WebGLRenderTarget[] {
    const targets: THREE.WebGLRenderTarget[] = []
    let currentSize = size
    while (currentSize > 1) {
      currentSize = Math.max(1, currentSize >> 1)
      const target = new THREE.WebGLRenderTarget(currentSize, currentSize, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        magFilter: THREE.NearestFilter,
        minFilter: THREE.NearestFilter,
      })
      target.texture.generateMipmaps = false
      target.texture.wrapS = THREE.ClampToEdgeWrapping
      target.texture.wrapT = THREE.ClampToEdgeWrapping
      target.texture.colorSpace = THREE.NoColorSpace
      targets.push(target)
    }
    return targets
  }

  private computeMaxVelocity(): number {
    if (this.velocityReductionTargets.length === 0) {
      return 0
    }

    let sourceTexture: THREE.Texture = this.targets.UV.read.texture
    let texelX = this.texelSize.x
    let texelY = this.texelSize.y
    const texelUniform = this.velocityMaxMaterial.uniforms.uTexel.value as THREE.Vector2

    for (let i = 0; i < this.velocityReductionTargets.length; i += 1) {
      const target = this.velocityReductionTargets[i]
      this.velocityMaxMaterial.uniforms.uVelocity.value = sourceTexture
      texelUniform.set(texelX, texelY)
      this.renderToTarget(this.velocityMaxMaterial, target)
      sourceTexture = target.texture
      texelX *= 2
      texelY *= 2
    }

    const finalTarget = this.velocityReductionTargets[this.velocityReductionTargets.length - 1]

    try {
      this.renderer.readRenderTargetPixels(finalTarget, 0, 0, 1, 1, this.velocityReadBuffer)
      return this.velocityReadBuffer[0]
    } catch {
      return 0
    }
  }

  private determineSubsteps(cfl: number, maxSubsteps: number, dt: number): number {
    const maxSteps = Math.max(1, Math.floor(maxSubsteps))
    if (cfl <= 0 || maxSteps <= 1) return 1

    const maxVelocity = this.computeMaxVelocity()
    if (maxVelocity <= 1e-6) return 1

    const dx = this.texelSize.x
    const maxDt = (cfl * dx) / maxVelocity
    if (!Number.isFinite(maxDt) || maxDt <= 0) return 1

    const needed = Math.ceil(dt / maxDt)
    if (needed <= 1) return 1

    return Math.min(maxSteps, Math.max(1, needed))
  }
}

export type { BrushType, BrushSettings, SimulationParams, BinderParams } from './types'
export {
  DEFAULT_BINDER_PARAMS,
  DEFAULT_ABSORB_EXPONENT,
  DEFAULT_ABSORB_TIME_OFFSET,
  DEFAULT_ABSORB_MIN_FLUX,
} from './constants'
