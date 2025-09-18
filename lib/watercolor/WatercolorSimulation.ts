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
  type PingPongTarget,
  type SimulationParams,
} from './types'

// GPU-driven watercolor solver combining shallow-water flow, pigment transport, and paper optics.
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
  }
  private readonly compositeTarget: THREE.WebGLRenderTarget
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>
  private readonly materials: MaterialMap
  private readonly fiberTexture: THREE.DataTexture
  private readonly pressure: PingPongTarget
  private readonly divergence: THREE.WebGLRenderTarget
  private readonly pressureIterations = 20
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
    }
    this.compositeTarget = createRenderTarget(size, textureType)
    this.pressure = createPingPong(size, textureType)
    this.divergence = createRenderTarget(size, textureType)
    this.fiberTexture = createFiberField(size)

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.materials = createMaterials(this.texelSize, this.fiberTexture)

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

    const splatHeight = this.materials.splatHeight
    splatHeight.uniforms.uSource.value = this.targets.H.read.texture
    splatHeight.uniforms.uCenter.value.set(center[0], center[1])
    splatHeight.uniforms.uRadius.value = radius
    splatHeight.uniforms.uFlow.value = flow
    splatHeight.uniforms.uToolType.value = toolType
    this.renderToTarget(splatHeight, this.targets.H.write)
    this.targets.H.swap()

    const splatVelocity = this.materials.splatVelocity
    splatVelocity.uniforms.uSource.value = this.targets.UV.read.texture
    splatVelocity.uniforms.uCenter.value.set(center[0], center[1])
    splatVelocity.uniforms.uRadius.value = radius
    splatVelocity.uniforms.uFlow.value = flow
    this.renderToTarget(splatVelocity, this.targets.UV.write)
    this.targets.UV.swap()


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

    const absorbReset = toolType === 0 ? 0.3 : 0.15
    this.absorbElapsed = Math.max(0, this.absorbElapsed - absorbReset * flow)
  }

  // Run one simulation step using semi-Lagrangian advection and absorption.
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

      const binderForces = this.materials.binderForces
      binderForces.uniforms.uVelocity.value = this.targets.UV.read.texture
      binderForces.uniforms.uBinder.value = this.targets.B.read.texture
      binderForces.uniforms.uDt.value = substepDt
      binderForces.uniforms.uElasticity.value = binder.elasticity
      binderForces.uniforms.uViscosity.value = binder.viscosity
      this.renderToTarget(binderForces, this.targets.UV.write)
      this.targets.UV.swap()

      const advectVel = this.materials.advectVelocity
      advectVel.uniforms.uHeight.value = this.targets.H.read.texture
      advectVel.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectVel.uniforms.uDt.value = substepDt
      advectVel.uniforms.uGrav.value = grav
      advectVel.uniforms.uVisc.value = visc
      this.renderToTarget(advectVel, this.targets.UV.write)
      this.targets.UV.swap()
      this.projectVelocity()

      const advectHeight = this.materials.advectHeight
      advectHeight.uniforms.uHeight.value = this.targets.H.read.texture
      advectHeight.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectHeight.uniforms.uBinder.value = this.targets.B.read.texture
      advectHeight.uniforms.uBinderBuoyancy.value = binder.buoyancy
      advectHeight.uniforms.uDt.value = substepDt
      this.renderToTarget(advectHeight, this.targets.H.write)
      this.targets.H.swap()

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


  // Enforce incompressibility by solving a pressure Poisson equation.
  private projectVelocity() {
    const divergence = this.materials.divergence
    divergence.uniforms.uVelocity.value = this.targets.UV.read.texture
    this.renderToTarget(divergence, this.divergence)

    const zero = this.materials.zero
    this.renderToTarget(zero, this.pressure.read)
    this.renderToTarget(zero, this.pressure.write)

    const jacobi = this.materials.jacobi
    jacobi.uniforms.uDivergence.value = this.divergence.texture
    for (let i = 0; i < this.pressureIterations; i += 1) {
      jacobi.uniforms.uPressure.value = this.pressure.read.texture
      this.renderToTarget(jacobi, this.pressure.write)
      this.pressure.swap()
    }

    const project = this.materials.project
    project.uniforms.uVelocity.value = this.targets.UV.read.texture
    project.uniforms.uPressure.value = this.pressure.read.texture
    this.renderToTarget(project, this.targets.UV.write)
    this.targets.UV.swap()
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
    this.clearPingPong(this.pressure)
    this.renderToTarget(this.materials.zero, this.divergence)
    this.renderToTarget(this.materials.zero, this.compositeTarget)
    this.absorbElapsed = 0
  }

  // Release GPU allocations when the simulation is no longer needed.
  dispose() {
    this.quad.geometry.dispose()
    Object.values(this.materials).forEach((mat) => mat.dispose())
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
    this.pressure.read.dispose()
    this.pressure.write.dispose()
    this.divergence.dispose()
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
