import * as THREE from 'three'

import { createMaterials, createVelocityMaxMaterial } from './materials'
import { createFiberField, createPaperHeightField, createPingPong, createRenderTarget } from './targets'
import {
  DEFAULT_BINDER_PARAMS,
  DEFAULT_DT,
  DEPOSITION_BASE,
  GRANULATION_SETTLE_RATE,
  GRANULATION_STRENGTH,
  HUMIDITY_INFLUENCE,
  PIGMENT_DIFFUSION_COEFF,
  DEFAULT_SURFACE_TENSION_PARAMS,
  DEFAULT_FRINGE_PARAMS,
} from './constants'
import {
  type BinderParams,
  type BrushSettings,
  type CapillaryFringeParams,
  type MaterialMap,
  type PingPongTarget,
  type SimulationParams,
  type SurfaceTensionParams,
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
  private readonly paperHeightMap: THREE.DataTexture
  private readonly pressure: PingPongTarget
  private readonly divergence: THREE.WebGLRenderTarget
  private readonly pressureIterations = 20
  private readonly velocityReductionTargets: THREE.WebGLRenderTarget[]
  private readonly velocityMaxMaterial: THREE.RawShaderMaterial
  private readonly velocityReadBuffer = new Float32Array(4)
  private binderSettings: BinderParams
  private absorbElapsed = 0
  private binderBoostFactor = 1
  private pasteIntensity = 0

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
    this.paperHeightMap = createPaperHeightField(size)

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.materials = createMaterials(this.texelSize, this.fiberTexture, this.paperHeightMap)

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

  get paperHeightTexture(): THREE.DataTexture {
    return this.paperHeightMap
  }

  // Inject water or pigment into the simulation at a given position.
  splat(brush: BrushSettings) {
    const {
      center,
      radius,
      flow,
      type,
      color,
      dryness = 0,
      dryThreshold,
      lowSolvent = 0,
      binderBoost = 1,
      pigmentBoost = 1,
      depositBoost,
      mask,
    } = brush
    const toolType = type === 'water' ? 0 : 1

    const normalizedFlow = THREE.MathUtils.clamp(flow, 0, 1)
    const dryBase = type === 'water' ? 0 : THREE.MathUtils.clamp(dryness, 0, 1)
    const dryInfluence = THREE.MathUtils.clamp(dryBase * (1 - 0.55 * normalizedFlow), 0, 1)
    const computedThreshold = THREE.MathUtils.lerp(-0.15, 0.7, dryInfluence)
    const threshold = THREE.MathUtils.clamp(dryThreshold ?? computedThreshold, -0.25, 1.0)

    const solvent = THREE.MathUtils.clamp(lowSolvent, 0, 1)
    const pigmentTarget = Math.max(pigmentBoost, 1)
    const depositTarget = Math.max(depositBoost ?? pigmentTarget, 1)
    const binderTarget = Math.max(binderBoost, 1)
    const binderMultiplier = THREE.MathUtils.lerp(1, binderTarget, solvent)
    const pasteActive = toolType === 1 && solvent > 0
    if (pasteActive) {
      this.pasteIntensity = Math.max(this.pasteIntensity, solvent)
      this.binderBoostFactor = Math.max(this.binderBoostFactor, binderMultiplier)
    }

    const splatMaterials = [
      this.materials.splatHeight,
      this.materials.splatVelocity,
      this.materials.splatPigment,
      this.materials.splatBinder,
      this.materials.splatDeposit,
    ]

    const rewetMaterials = [
      this.materials.splatRewetPigment,
      this.materials.splatRewetDeposit,
    ]

    const allSplatMaterials = [...splatMaterials, ...rewetMaterials]

    const defaultMaskTexture =
      (this.materials.splatHeight.uniforms.uBristleMask.value as THREE.Texture | null) ??
      null
    const maskTexture = (mask?.texture as THREE.Texture | null) ?? defaultMaskTexture
    const maskRotation = mask?.rotation ?? 0
    const maskStrength = THREE.MathUtils.clamp(mask?.strength ?? 0, 0, 1)
    const maskScale = mask?.scale ?? [1, 1]

    allSplatMaterials.forEach((material) => {
      const uniforms = material.uniforms as Record<string, THREE.IUniform>
      uniforms.uPaperHeight.value = this.paperHeightMap
      uniforms.uDryThreshold.value = threshold
      uniforms.uDryInfluence.value = dryInfluence
      if (uniforms.uBristleMask) {
        uniforms.uBristleMask.value = maskTexture
      }
      if (uniforms.uMaskScale) {
        const scaleUniform = uniforms.uMaskScale.value as THREE.Vector2
        scaleUniform.set(maskScale[0], maskScale[1])
      }
      if (uniforms.uMaskRotation) {
        uniforms.uMaskRotation.value = maskRotation
      }
      if (uniforms.uMaskStrength) {
        uniforms.uMaskStrength.value = maskStrength
      }
    })

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
    const pigmentUniform = splatPigment.uniforms.uPigment.value as THREE.Vector3
    pigmentUniform.set(color[0], color[1], color[2])
    splatPigment.uniforms.uLowSolvent.value = solvent
    splatPigment.uniforms.uBoost.value = pigmentTarget
    this.renderToTarget(splatPigment, this.targets.C.write)
    this.targets.C.swap()

    const splatBinder = this.materials.splatBinder
    splatBinder.uniforms.uSource.value = this.targets.B.read.texture
    splatBinder.uniforms.uCenter.value.set(center[0], center[1])
    splatBinder.uniforms.uRadius.value = radius
    splatBinder.uniforms.uFlow.value = flow
    splatBinder.uniforms.uToolType.value = toolType
    splatBinder.uniforms.uBinderStrength.value = this.binderSettings.injection * binderMultiplier
    splatBinder.uniforms.uLowSolvent.value = solvent
    this.renderToTarget(splatBinder, this.targets.B.write)
    this.targets.B.swap()

    if (pasteActive) {
      const splatDeposit = this.materials.splatDeposit
      splatDeposit.uniforms.uSource.value = this.targets.DEP.read.texture
      splatDeposit.uniforms.uCenter.value.set(center[0], center[1])
      splatDeposit.uniforms.uRadius.value = radius
      splatDeposit.uniforms.uFlow.value = flow
      const depositPigment = splatDeposit.uniforms.uPigment.value as THREE.Vector3
      depositPigment.set(color[0], color[1], color[2])
      splatDeposit.uniforms.uLowSolvent.value = solvent
      splatDeposit.uniforms.uBoost.value = depositTarget
      this.renderToTarget(splatDeposit, this.targets.DEP.write)
      this.targets.DEP.swap()
    }

    if (toolType === 0 && flow > 0) {
      const rewetPigment = this.materials.splatRewetPigment
      rewetPigment.uniforms.uSource.value = this.targets.C.read.texture
      rewetPigment.uniforms.uDeposits.value = this.targets.DEP.read.texture
      rewetPigment.uniforms.uCenter.value.set(center[0], center[1])
      rewetPigment.uniforms.uRadius.value = radius
      rewetPigment.uniforms.uFlow.value = flow
      this.renderToTarget(rewetPigment, this.targets.C.write)
      this.targets.C.swap()

      const rewetDeposit = this.materials.splatRewetDeposit
      rewetDeposit.uniforms.uSource.value = this.targets.DEP.read.texture
      rewetDeposit.uniforms.uCenter.value.set(center[0], center[1])
      rewetDeposit.uniforms.uRadius.value = radius
      rewetDeposit.uniforms.uFlow.value = flow
      this.renderToTarget(rewetDeposit, this.targets.DEP.write)
      this.targets.DEP.swap()
    }

    const absorbReset = toolType === 0 ? 0.3 : 0.15
    this.absorbElapsed = Math.max(0, this.absorbElapsed - absorbReset * flow)
    if (pasteActive) {
      const evapBoost = THREE.MathUtils.lerp(0.8, 1.6, solvent)
      this.absorbElapsed += evapBoost
    }
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
      paperTextureStrength,
      backrunStrength,
      absorbExponent,
      absorbTimeOffset,
      absorbMinFlux,
      cfl,
      maxSubsteps,
      binder,
      surfaceTension,
      capillaryFringe,
      pigmentCoefficients,
    } = params

    this.binderSettings = { ...binder }

    const substeps = this.determineSubsteps(cfl, maxSubsteps, dt)
    const substepDt = dt / substeps

    const surfaceParams = {
      ...DEFAULT_SURFACE_TENSION_PARAMS,
      ...surfaceTension,
    }

    const fringeParams: CapillaryFringeParams = {
      ...DEFAULT_FRINGE_PARAMS,
      ...capillaryFringe,
    }

    const diffusionCoefficients = new THREE.Vector3(
      pigmentCoefficients?.diffusion?.[0] ?? PIGMENT_DIFFUSION_COEFF,
      pigmentCoefficients?.diffusion?.[1] ?? PIGMENT_DIFFUSION_COEFF,
      pigmentCoefficients?.diffusion?.[2] ?? PIGMENT_DIFFUSION_COEFF,
    )
    const settleCoefficients = new THREE.Vector3(
      pigmentCoefficients?.settle?.[0] ?? GRANULATION_SETTLE_RATE,
      pigmentCoefficients?.settle?.[1] ?? GRANULATION_SETTLE_RATE,
      pigmentCoefficients?.settle?.[2] ?? GRANULATION_SETTLE_RATE,
    )
    const settleVector = new THREE.Vector3()

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
      const pasteIntensity = THREE.MathUtils.clamp(this.pasteIntensity, 0, 1)
      const binderMultiplier = pasteIntensity > 0 ? this.binderBoostFactor : 1
      binderForces.uniforms.uVelocity.value = this.targets.UV.read.texture
      binderForces.uniforms.uBinder.value = this.targets.B.read.texture
      binderForces.uniforms.uDt.value = substepDt
      binderForces.uniforms.uElasticity.value = binder.elasticity * binderMultiplier
      binderForces.uniforms.uViscosity.value = binder.viscosity * binderMultiplier
      binderForces.uniforms.uLowSolvent.value = pasteIntensity
      binderForces.uniforms.uPasteClamp.value = THREE.MathUtils.lerp(1.0, 0.05, pasteIntensity)
      binderForces.uniforms.uPasteDamping.value = THREE.MathUtils.lerp(0.0, 0.85, pasteIntensity)
      this.renderToTarget(binderForces, this.targets.UV.write)
      this.targets.UV.swap()
      if (pasteIntensity > 0) {
        this.pasteIntensity = Math.max(0, pasteIntensity - substepDt * 1.8)
      } else {
        this.pasteIntensity = 0
      }
      this.binderBoostFactor = THREE.MathUtils.lerp(this.binderBoostFactor, 1, substepDt * 1.5)
      if (this.binderBoostFactor < 1.0001) {
        this.binderBoostFactor = 1
      }

      const advectVel = this.materials.advectVelocity
      advectVel.uniforms.uHeight.value = this.targets.H.read.texture
      advectVel.uniforms.uVelocity.value = this.targets.UV.read.texture
      advectVel.uniforms.uDt.value = substepDt
      advectVel.uniforms.uGrav.value = grav
      advectVel.uniforms.uVisc.value = visc
      this.renderToTarget(advectVel, this.targets.UV.write)
      this.targets.UV.swap()
      this.projectVelocity()

      if (surfaceParams.enabled && surfaceParams.strength > 0) {
        this.applySurfaceTension(surfaceParams, substepDt)
      }

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
      const diffusionUniform =
        diffusePigment.uniforms.uDiffusion.value as THREE.Vector3
      diffusionUniform.copy(diffusionCoefficients)
      diffusePigment.uniforms.uDt.value = substepDt
      this.renderToTarget(diffusePigment, this.targets.C.write)
      this.targets.C.swap()

      const absorbBase = absorb * substepDt
      const evapFactor = evap * substepDt
      const edgeFactor = edge * substepDt
      const beta = stateAbsorption ? absorbExponent : 1.0
      const humidityInfluence = stateAbsorption ? HUMIDITY_INFLUENCE : 0.0
      const granStrength = granulation ? GRANULATION_STRENGTH : 0.0
      if (granulation) {
        settleVector.copy(settleCoefficients).multiplyScalar(substepDt)
      } else {
        settleVector.set(0, 0, 0)
      }
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
        settleVector,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
        paperTextureStrength,
      )
      this.renderToTarget(absorbDeposit, this.targets.DEP.write)

      const absorbHeight = this.materials.absorbHeight
      this.assignAbsorbUniforms(
        absorbHeight,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleVector,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
        paperTextureStrength,
      )
      this.renderToTarget(absorbHeight, this.targets.H.write)

      const absorbPigment = this.materials.absorbPigment
      this.assignAbsorbUniforms(
        absorbPigment,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleVector,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
        paperTextureStrength,
      )
      this.renderToTarget(absorbPigment, this.targets.C.write)

      const absorbWet = this.materials.absorbWet
      this.assignAbsorbUniforms(
        absorbWet,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleVector,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
        paperTextureStrength,
      )
      this.renderToTarget(absorbWet, this.targets.W.write)

      const absorbSettled = this.materials.absorbSettled
      this.assignAbsorbUniforms(
        absorbSettled,
        absorbBase,
        evapFactor,
        edgeFactor,
        settleVector,
        beta,
        humidityInfluence,
        granStrength,
        backrunStrength,
        absorbTime,
        timeOffset,
        absorbFloor,
        paperTextureStrength,
      )
      this.renderToTarget(absorbSettled, this.targets.S.write)

      this.targets.DEP.swap()
      this.targets.H.swap()
      this.targets.C.swap()
      this.targets.W.swap()
      this.targets.S.swap()

      this.applyPaperDiffusion(substepDt, paperReplenish, fringeParams)
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
  private applyPaperDiffusion(dt: number, replenish: number, fringe: CapillaryFringeParams) {
    const diffuse = this.materials.diffuseWet
    diffuse.uniforms.uWet.value = this.targets.W.read.texture
    diffuse.uniforms.uDt.value = dt
    diffuse.uniforms.uReplenish.value = replenish
    diffuse.uniforms.uFringeStrength.value = fringe.enabled ? fringe.strength : 0
    diffuse.uniforms.uFringeThreshold.value = Math.max(fringe.threshold, 1e-4)
    diffuse.uniforms.uFringeNoiseScale.value = Math.max(fringe.noiseScale, 0)
    this.renderToTarget(diffuse, this.targets.W.write)
    this.targets.W.swap()
  }

  private applySurfaceTension(params: SurfaceTensionParams, dt: number) {
    const surfaceTension = this.materials.surfaceTension
    const uniforms = surfaceTension.uniforms as Record<string, THREE.IUniform>
    uniforms.uHeight.value = this.targets.H.read.texture
    uniforms.uWet.value = this.targets.W.read.texture
    uniforms.uVelocity.value = this.targets.UV.read.texture
    const texelUniform = uniforms.uTexel?.value
    if (texelUniform instanceof THREE.Vector2) {
      texelUniform.copy(this.texelSize)
    }
    uniforms.uDt.value = dt
    uniforms.uStrength.value = params.strength
    uniforms.uThreshold.value = Math.max(params.threshold, 0)
    uniforms.uBreakThreshold.value = Math.max(params.breakThreshold, 0)
    uniforms.uSnapStrength.value = params.snapStrength
    uniforms.uVelocityLimit.value = Math.max(params.velocityLimit, 1e-4)
    this.renderToTarget(surfaceTension, this.targets.H.write)
    this.targets.H.swap()
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
    this.binderBoostFactor = 1
    this.pasteIntensity = 0
  }

  // Release GPU allocations when the simulation is no longer needed.
  dispose() {
    this.quad.geometry.dispose()
    Object.values(this.materials).forEach((mat) => mat.dispose())
    this.velocityMaxMaterial.dispose()
    this.clearTargets()
    this.fiberTexture.dispose()
    this.paperHeightMap.dispose()
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
    settle: THREE.Vector3,
    beta: number,
    humidity: number,
    granStrength: number,
    backrunStrength: number,
    absorbTime: number,
    timeOffset: number,
    absorbFloor: number,
    paperTextureStrength: number,
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
    if (uniforms.uSettle) {
      const settleUniform = uniforms.uSettle.value as THREE.Vector3
      settleUniform.copy(settle)
    }
    if (uniforms.uGranStrength) uniforms.uGranStrength.value = granStrength
    if (uniforms.uBackrunStrength) uniforms.uBackrunStrength.value = backrunStrength
    if (uniforms.uAbsorbTime) uniforms.uAbsorbTime.value = absorbTime
    if (uniforms.uAbsorbTimeOffset) uniforms.uAbsorbTimeOffset.value = timeOffset
    if (uniforms.uAbsorbFloor) uniforms.uAbsorbFloor.value = absorbFloor
    if (uniforms.uPaperHeightStrength) uniforms.uPaperHeightStrength.value = paperTextureStrength
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

export type {
  BrushType,
  BrushSettings,
  SimulationParams,
  BinderParams,
  PigmentCoefficients,
  ChannelCoefficients,
  SurfaceTensionParams,
  CapillaryFringeParams,
} from './types'
export {
  DEFAULT_BINDER_PARAMS,
  DEFAULT_ABSORB_EXPONENT,
  DEFAULT_ABSORB_TIME_OFFSET,
  DEFAULT_ABSORB_MIN_FLUX,
  DEFAULT_REWET_STRENGTH,
  PIGMENT_REWET,
  DEFAULT_PAPER_TEXTURE_STRENGTH,
  DEFAULT_SURFACE_TENSION_PARAMS,
  DEFAULT_FRINGE_PARAMS,
} from './constants'
