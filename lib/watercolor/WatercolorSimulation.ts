import * as THREE from 'three'


import { createMaterials } from './materials'
import { createRenderTarget } from './targets'
import {
  ABSORPTION_CAPILLARY_RADIUS,
  ABSORPTION_CONTACT_ANGLE,
  ABSORPTION_MIN_LENGTH,
  ABSORPTION_SURFACE_TENSION,
  DEFAULT_ABSORB_EXPONENT,
  DEFAULT_ABSORB_MIN_FLUX,
  DEFAULT_ABSORB_TIME_OFFSET,
  DEFAULT_BINDER_PARAMS,
  DEFAULT_DT,
  PIGMENT_DIFFUSION_COEFF,
  SPH_BOUNDARY_DAMPING,
  SPH_ITERATIONS,
  SPH_MAX_PARTICLES,
  SPH_PARTICLE_MASS,
  SPH_PRESSURE_RELAXATION,
  SPH_REST_DENSITY,
  SPH_SMOOTHING_RADIUS,
  SPH_SPAWN_MULTIPLIER,
} from './constants'
import {
  type BinderParams,
  type BrushSettings,
  type MaterialMap,
  type SimulationParams,
} from './types'

const TWO_PI = Math.PI * 2
const EPSILON = 1e-6

export default class WatercolorSimulation {
  private readonly renderer: THREE.WebGLRenderer
  private readonly size: number
  private readonly materials: MaterialMap
  private readonly compositeTarget: THREE.WebGLRenderTarget
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>
  private readonly depositData: Float32Array
  private readonly wetnessData: Float32Array
  private readonly depositTexture: THREE.DataTexture

  private readonly posX = new Float32Array(SPH_MAX_PARTICLES)
  private readonly posY = new Float32Array(SPH_MAX_PARTICLES)
  private readonly velX = new Float32Array(SPH_MAX_PARTICLES)
  private readonly velY = new Float32Array(SPH_MAX_PARTICLES)
  private readonly baseVelX = new Float32Array(SPH_MAX_PARTICLES)
  private readonly baseVelY = new Float32Array(SPH_MAX_PARTICLES)
  private readonly predPosX = new Float32Array(SPH_MAX_PARTICLES)
  private readonly predPosY = new Float32Array(SPH_MAX_PARTICLES)
  private readonly predVelX = new Float32Array(SPH_MAX_PARTICLES)
  private readonly predVelY = new Float32Array(SPH_MAX_PARTICLES)
  private readonly density = new Float32Array(SPH_MAX_PARTICLES)
  private readonly pressure = new Float32Array(SPH_MAX_PARTICLES)
  private readonly densityError = new Float32Array(SPH_MAX_PARTICLES)
  private readonly binder = new Float32Array(SPH_MAX_PARTICLES)
  private readonly binderNext = new Float32Array(SPH_MAX_PARTICLES)
  private readonly pigmentR = new Float32Array(SPH_MAX_PARTICLES)
  private readonly pigmentG = new Float32Array(SPH_MAX_PARTICLES)
  private readonly pigmentB = new Float32Array(SPH_MAX_PARTICLES)
  private readonly pigmentNextR = new Float32Array(SPH_MAX_PARTICLES)
  private readonly pigmentNextG = new Float32Array(SPH_MAX_PARTICLES)
  private readonly pigmentNextB = new Float32Array(SPH_MAX_PARTICLES)
  private readonly infiltration = new Float32Array(SPH_MAX_PARTICLES)
  private readonly absorbClock = new Float32Array(SPH_MAX_PARTICLES)
  private readonly mass = new Float32Array(SPH_MAX_PARTICLES)
  private readonly activeFlags = new Uint8Array(SPH_MAX_PARTICLES)

  private readonly activeList: number[] = []
  private readonly activeSlot = new Int32Array(SPH_MAX_PARTICLES)
  private readonly freeList: number[] = []

  private readonly gridResolution: number
  private readonly gridCellSize: number
  private readonly gridHead: Int32Array
  private readonly gridNext: Int32Array

  private readonly smoothingRadius = SPH_SMOOTHING_RADIUS
  private readonly smoothingRadius2 = SPH_SMOOTHING_RADIUS * SPH_SMOOTHING_RADIUS
  private readonly poly6Coeff: number
  private readonly spikyGradCoeff: number
  private readonly viscLaplacianCoeff: number
  private readonly restDensity = SPH_REST_DENSITY

  private binderSettings: BinderParams

  constructor(renderer: THREE.WebGLRenderer, size = 512) {
    if (!renderer.capabilities.isWebGL2) {
      throw new Error('WatercolorSimulation requires a WebGL2 context')
    }

    this.renderer = renderer
    this.size = size
    this.materials = createMaterials()

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materials.zero)
    this.scene.add(this.quad)

    const textureType = renderer.capabilities.isWebGL2 ? THREE.FloatType : THREE.FloatType
    this.compositeTarget = createRenderTarget(size, textureType)

    this.depositData = new Float32Array(size * size * 4)
    this.wetnessData = new Float32Array(size * size)
    this.depositTexture = new THREE.DataTexture(
      this.depositData,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    )
    this.depositTexture.wrapS = THREE.ClampToEdgeWrapping
    this.depositTexture.wrapT = THREE.ClampToEdgeWrapping
    this.depositTexture.magFilter = THREE.LinearFilter
    this.depositTexture.minFilter = THREE.LinearFilter
    this.depositTexture.colorSpace = THREE.NoColorSpace
    this.depositTexture.needsUpdate = true

    this.materials.composite.uniforms.uDeposits.value = this.depositTexture
    
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

  splat(brush: BrushSettings) {
    const { center, radius, flow, type, color } = brush
    const spawnCount = Math.min(
      this.freeList.length,
      Math.max(1, Math.floor(flow * SPH_SPAWN_MULTIPLIER)),
    )

    for (let i = 0; i < spawnCount; i += 1) {
      const idx = this.freeList.pop()
      if (idx === undefined) break

      const angle = Math.random() * TWO_PI
      const r = radius * Math.sqrt(Math.random())
      const offsetX = r * Math.cos(angle)
      const offsetY = r * Math.sin(angle)
      const px = this.clamp01(center[0] + offsetX)
      const py = this.clamp01(center[1] + offsetY)

      const speed = 0.35 * flow
      const vx = speed * (Math.random() - 0.5)
      const vy = speed * (Math.random() - 0.5)
      const binderAmount = type === 'pigment' ? this.binderSettings.injection : 0

      this.addParticle(
        idx,
        px,
        py,
        vx,
        vy,
        binderAmount,
        type === 'pigment' ? color : [0, 0, 0],
      )
    }
  }

  step(params: SimulationParams, dt = DEFAULT_DT) {
    if (this.activeList.length === 0) {
      this.renderComposite()
      return
    }

    this.binderSettings = { ...params.binder }

    const substeps = this.determineSubsteps(params, dt)
    const subDt = dt / substeps

    for (let i = 0; i < substeps; i += 1) {
      this.integrate(subDt, params)
    }

    this.applyEvaporation(params.evap, dt)

    this.depositTexture.needsUpdate = true
    this.renderComposite()
  }

  reset() {
    this.activeList.length = 0
    this.freeList.length = 0
    this.activeSlot.fill(-1)
    this.activeFlags.fill(0)

    for (let i = SPH_MAX_PARTICLES - 1; i >= 0; i -= 1) {
      this.freeList.push(i)
      this.mass[i] = SPH_PARTICLE_MASS
      this.density[i] = this.restDensity
      this.velX[i] = 0
      this.velY[i] = 0
      this.binder[i] = 0
      this.pigmentR[i] = 0
      this.pigmentG[i] = 0
      this.pigmentB[i] = 0
      this.infiltration[i] = ABSORPTION_MIN_LENGTH
      this.absorbClock[i] = 0
    }

    this.depositData.fill(0)
    this.wetnessData.fill(0)
    this.depositTexture.needsUpdate = true

    this.renderToTarget(this.materials.zero, this.compositeTarget)
  }

  dispose() {
    this.quad.geometry.dispose()
    Object.values(this.materials).forEach((material) => material.dispose())
    this.compositeTarget.dispose()
    this.depositTexture.dispose()
  }

  private integrate(dt: number, params: SimulationParams) {
    this.computeExternalForces(dt, params)
    this.solvePressure(dt)
    this.applyDiffusion(dt)
    this.applyAbsorption(dt, params)
  }

  private computeExternalForces(dt: number, params: SimulationParams) {
    this.buildGrid(this.posX, this.posY)

    const gravity = params.grav
    const viscosity = params.visc
    const binderViscosity = this.binderSettings.viscosity
    const binderElasticity = this.binderSettings.elasticity

    for (let n = 0; n < this.activeList.length; n += 1) {
      const i = this.activeList[n]
      const px = this.posX[i]
      const py = this.posY[i]
      const vx = this.velX[i]
      const vy = this.velY[i]
      const binderI = this.binder[i]

      let ax = 0
      let ay = -gravity

      this.forEachNeighbor(i, this.posX, this.posY, (j, dx, dy, r2) => {
        if (r2 < EPSILON) return
        const r = Math.sqrt(r2)
        if (r >= this.smoothingRadius) return

        const binderJ = this.binder[j]
        const binderAvg = 0.5 * (binderI + binderJ)
        const densityJ = Math.max(this.density[j], this.restDensity)
        const invDensity = 1 / densityJ
        const massJ = this.mass[j]

        const laplacian = this.viscosityLaplacian(r)
        const viscCoeff = viscosity + binderAvg * binderViscosity
        const dvx = this.velX[j] - vx
        const dvy = this.velY[j] - vy
        ax += viscCoeff * massJ * dvx * laplacian * invDensity
        ay += viscCoeff * massJ * dvy * laplacian * invDensity

        if (binderAvg > EPSILON && r > EPSILON) {
          const gradBase = this.spikyGradient(r)
          const gradX = gradBase * (dx / r)
          const gradY = gradBase * (dy / r)
          ax += binderElasticity * binderAvg * massJ * gradX
          ay += binderElasticity * binderAvg * massJ * gradY
        }
      })

      this.baseVelX[i] = vx + dt * ax
      this.baseVelY[i] = vy + dt * ay
      this.predVelX[i] = this.baseVelX[i]
      this.predVelY[i] = this.baseVelY[i]
      this.predPosX[i] = px + dt * this.predVelX[i]
      this.predPosY[i] = py + dt * this.predVelY[i]
      this.enforceBounds(i, this.predPosX, this.predPosY, this.predVelX, this.predVelY)
    }
  }

  private solvePressure(dt: number) {
    let iterations = SPH_ITERATIONS
    const epsilon = 0.01 * this.restDensity

    while (iterations > 0) {
      iterations -= 1
      this.buildGrid(this.predPosX, this.predPosY)

      let maxError = 0
      for (let n = 0; n < this.activeList.length; n += 1) {
        const i = this.activeList[n]
        const massI = this.mass[i]
        let rho = massI * this.poly6(0)

        this.forEachNeighbor(i, this.predPosX, this.predPosY, (j, dx, dy, r2) => {
          const kernel = this.poly6(r2)
          rho += this.mass[j] * kernel
        })

        this.density[i] = rho
        const error = Math.max(rho - this.restDensity, 0)
        this.densityError[i] = error
        if (error > maxError) maxError = error
      }

      if (maxError < epsilon) break

      for (let n = 0; n < this.activeList.length; n += 1) {
        const i = this.activeList[n]
        this.pressure[i] += SPH_PRESSURE_RELAXATION * this.densityError[i]
      }

      for (let n = 0; n < this.activeList.length; n += 1) {
        const i = this.activeList[n]
        const densityI = Math.max(this.density[i], this.restDensity)
        const invDensityI2 = 1 / (densityI * densityI)

        let ax = 0
        let ay = 0

        this.forEachNeighbor(i, this.predPosX, this.predPosY, (j, dx, dy, r2) => {
          if (r2 < EPSILON) return
          const r = Math.sqrt(r2)
          if (r >= this.smoothingRadius) return

          const densityJ = Math.max(this.density[j], this.restDensity)
          const invDensityJ2 = 1 / (densityJ * densityJ)
          const gradBase = this.spikyGradient(r)
          if (Math.abs(gradBase) < EPSILON) return

          const gradX = gradBase * (dx / r)
          const gradY = gradBase * (dy / r)
          const pressureTerm =
            this.pressure[i] * invDensityI2 + this.pressure[j] * invDensityJ2

          ax -= this.mass[j] * pressureTerm * gradX
          ay -= this.mass[j] * pressureTerm * gradY
        })

        this.predVelX[i] = this.baseVelX[i] + dt * ax
        this.predVelY[i] = this.baseVelY[i] + dt * ay
        this.predPosX[i] = this.posX[i] + dt * this.predVelX[i]
        this.predPosY[i] = this.posY[i] + dt * this.predVelY[i]
        this.enforceBounds(i, this.predPosX, this.predPosY, this.predVelX, this.predVelY)
      }
    }

    for (let n = 0; n < this.activeList.length; n += 1) {
      const i = this.activeList[n]
      this.velX[i] = this.predVelX[i]
      this.velY[i] = this.predVelY[i]
      this.posX[i] = this.predPosX[i]
      this.posY[i] = this.predPosY[i]
    }
  }

  private applyDiffusion(dt: number) {
    this.buildGrid(this.posX, this.posY)

    const pigmentDiffusion = PIGMENT_DIFFUSION_COEFF
    const binderDiffusion = this.binderSettings.diffusion
    const binderDecay = this.binderSettings.decay

    for (let n = 0; n < this.activeList.length; n += 1) {
      const i = this.activeList[n]
      const binderI = this.binder[i]

      let diffR = 0
      let diffG = 0
      let diffB = 0
      let diffBinder = 0

      this.forEachNeighbor(i, this.posX, this.posY, (j, dx, dy, r2) => {
        if (r2 < EPSILON) return
        const r = Math.sqrt(r2)
        if (r >= this.smoothingRadius) return
        const laplacian = this.viscosityLaplacian(r)
        const weight = this.mass[j] / Math.max(this.density[j], this.restDensity)

        diffR += weight * (this.pigmentR[j] - this.pigmentR[i]) * laplacian
        diffG += weight * (this.pigmentG[j] - this.pigmentG[i]) * laplacian
        diffB += weight * (this.pigmentB[j] - this.pigmentB[i]) * laplacian
        diffBinder += weight * (this.binder[j] - binderI) * laplacian
      })

      this.pigmentNextR[i] = this.pigmentR[i] + pigmentDiffusion * diffR * dt
      this.pigmentNextG[i] = this.pigmentG[i] + pigmentDiffusion * diffG * dt
      this.pigmentNextB[i] = this.pigmentB[i] + pigmentDiffusion * diffB * dt
      this.binderNext[i] = binderI + binderDiffusion * diffBinder * dt - binderDecay * binderI * dt

      if (!Number.isFinite(this.pigmentNextR[i])) this.pigmentNextR[i] = this.pigmentR[i]
      if (!Number.isFinite(this.pigmentNextG[i])) this.pigmentNextG[i] = this.pigmentG[i]
      if (!Number.isFinite(this.pigmentNextB[i])) this.pigmentNextB[i] = this.pigmentB[i]
      if (!Number.isFinite(this.binderNext[i])) this.binderNext[i] = binderI

      this.pigmentNextR[i] = THREE.MathUtils.clamp(this.pigmentNextR[i], 0, 1.5)
      this.pigmentNextG[i] = THREE.MathUtils.clamp(this.pigmentNextG[i], 0, 1.5)
      this.pigmentNextB[i] = THREE.MathUtils.clamp(this.pigmentNextB[i], 0, 1.5)
      this.binderNext[i] = THREE.MathUtils.clamp(this.binderNext[i], 0, 1)
    }

    for (let n = 0; n < this.activeList.length; n += 1) {
      const i = this.activeList[n]
      this.pigmentR[i] = this.pigmentNextR[i]
      this.pigmentG[i] = this.pigmentNextG[i]
      this.pigmentB[i] = this.pigmentNextB[i]
      this.binder[i] = this.binderNext[i]
    }
  }

  private applyAbsorption(dt: number, params: SimulationParams) {
    const capillaryRadius = ABSORPTION_CAPILLARY_RADIUS
    const surfaceTension = ABSORPTION_SURFACE_TENSION
    const contactCos = Math.cos(ABSORPTION_CONTACT_ANGLE)
    const capillaryPressure = (2 * surfaceTension * contactCos) / capillaryRadius

    const absorbExponent = params.absorbExponent ?? DEFAULT_ABSORB_EXPONENT
    const absorbOffset = params.absorbTimeOffset ?? DEFAULT_ABSORB_TIME_OFFSET
    const absorbFloor = params.absorbMinFlux ?? DEFAULT_ABSORB_MIN_FLUX

    const removalIndices: number[] = []

    for (let n = 0; n < this.activeList.length; n += 1) {
      const i = this.activeList[n]
      const px = this.posX[i]
      const py = this.posY[i]
      const cell = this.sampleWetnessCell(px, py)
      const humidity = this.wetnessData[cell]

      const binderFactor = this.binder[i]
      const viscosity = Math.max(params.visc + binderFactor * this.binderSettings.viscosity, 1e-4)
      const l = Math.max(this.infiltration[i], ABSORPTION_MIN_LENGTH)
      const hydro = (this.density[i] / this.restDensity) * params.grav * 0.015
      const infiltrationRate = (capillaryRadius * capillaryRadius * (hydro + capillaryPressure)) /
        (8 * viscosity * l)

      const time = this.absorbClock[i] + 0.5 * dt
      const timeFactor = params.stateAbsorption ? 1 / Math.sqrt(time + absorbOffset) : 1
      const humidityFactor = params.stateAbsorption
        ? Math.pow(Math.max(1 - humidity, 0), absorbExponent)
        : 1

      const absorbStrength = Math.max(absorbFloor, params.absorb * humidityFactor * timeFactor)
      const flux = Math.max(0, absorbStrength * infiltrationRate)
      const massLoss = flux * dt * this.mass[i]

      this.absorbClock[i] += dt
      this.infiltration[i] = l + infiltrationRate * dt

      if (massLoss <= EPSILON) continue

      const particleMass = this.mass[i]
      const fraction = THREE.MathUtils.clamp(massLoss / particleMass, 0, 0.95)
      if (fraction <= EPSILON) continue

      const lossR = this.pigmentR[i] * fraction
      const lossG = this.pigmentG[i] * fraction
      const lossB = this.pigmentB[i] * fraction
      this.mass[i] = Math.max(particleMass - massLoss, 0)
      this.pigmentR[i] -= lossR
      this.pigmentG[i] -= lossG
      this.pigmentB[i] -= lossB
      this.binder[i] *= 1 - fraction

      this.depositPigment(px, py, lossR, lossG, lossB, params.edge, params.granulation)
      this.wetnessData[cell] = THREE.MathUtils.clamp(this.wetnessData[cell] + fraction, 0, 1.25)

      if (this.mass[i] <= 0.15 * SPH_PARTICLE_MASS) {
        removalIndices.push(i)
      }
    }

    for (let i = 0; i < removalIndices.length; i += 1) {
      this.removeParticle(removalIndices[i])
    }
  }

  private applyEvaporation(rate: number, dt: number) {
    if (rate <= EPSILON) return
    const decay = rate * dt
    for (let i = 0; i < this.wetnessData.length; i += 1) {
      const w = this.wetnessData[i]
      if (w <= 0) continue
      this.wetnessData[i] = Math.max(0, w - decay * (0.35 + w))
    }
  }

  private depositPigment(
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    edgeStrength: number,
    granulation: boolean,
  ) {
    const ix = Math.min(this.size - 1, Math.max(0, Math.floor(x * this.size)))
    const iy = Math.min(this.size - 1, Math.max(0, Math.floor(y * this.size)))
    const idx = (iy * this.size + ix) * 4

    const edgeBoost = 1 + 0.5 * edgeStrength
    const grain = granulation ? 0.85 + 0.3 * (Math.random() - 0.5) : 1
    const scale = edgeBoost * grain

    this.depositData[idx + 0] = Math.min(this.depositData[idx + 0] + r * scale, 4)
    this.depositData[idx + 1] = Math.min(this.depositData[idx + 1] + g * scale, 4)
    this.depositData[idx + 2] = Math.min(this.depositData[idx + 2] + b * scale, 4)
    this.depositData[idx + 3] = 1
  }

  private addParticle(
    index: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    binderAmount: number,
    pigment: [number, number, number],
  ) {
    this.posX[index] = x
    this.posY[index] = y
    this.velX[index] = vx
    this.velY[index] = vy
    this.mass[index] = SPH_PARTICLE_MASS
    this.density[index] = this.restDensity
    this.pressure[index] = 0
    this.binder[index] = THREE.MathUtils.clamp(binderAmount, 0, 1)
    this.pigmentR[index] = pigment[0]
    this.pigmentG[index] = pigment[1]
    this.pigmentB[index] = pigment[2]
    this.infiltration[index] = ABSORPTION_MIN_LENGTH
    this.absorbClock[index] = 0

    this.activeFlags[index] = 1
    this.activeSlot[index] = this.activeList.length
    this.activeList.push(index)
  }

  private removeParticle(index: number) {
    if (!this.activeFlags[index]) return
    const slot = this.activeSlot[index]
    if (slot < 0) return

    const lastIndex = this.activeList.pop()
    if (lastIndex === undefined) return

    if (lastIndex !== index) {
      this.activeList[slot] = lastIndex
      this.activeSlot[lastIndex] = slot
    }

    this.activeFlags[index] = 0
    this.activeSlot[index] = -1
    this.freeList.push(index)

    this.mass[index] = SPH_PARTICLE_MASS
    this.density[index] = this.restDensity
    this.velX[index] = 0
    this.velY[index] = 0
    this.binder[index] = 0
    this.pigmentR[index] = 0
    this.pigmentG[index] = 0
    this.pigmentB[index] = 0
    this.infiltration[index] = ABSORPTION_MIN_LENGTH
    this.absorbClock[index] = 0
  }

  private buildGrid(posX: Float32Array, posY: Float32Array) {
    this.gridHead.fill(-1)
    for (let n = 0; n < this.activeList.length; n += 1) {
      const i = this.activeList[n]
      const cx = this.gridCoordinate(posX[i])
      const cy = this.gridCoordinate(posY[i])
      const cell = cy * this.gridResolution + cx
      this.gridNext[i] = this.gridHead[cell]
      this.gridHead[cell] = i
    }
  }

  private forEachNeighbor(
    index: number,
    posX: Float32Array,
    posY: Float32Array,
    handler: (neighbor: number, dx: number, dy: number, r2: number) => void,
  ) {
    const cx = this.gridCoordinate(posX[index])
    const cy = this.gridCoordinate(posY[index])

    for (let oy = -1; oy <= 1; oy += 1) {
      const ny = cy + oy
      if (ny < 0 || ny >= this.gridResolution) continue
      for (let ox = -1; ox <= 1; ox += 1) {
        const nx = cx + ox
        if (nx < 0 || nx >= this.gridResolution) continue
        const cell = ny * this.gridResolution + nx
        let j = this.gridHead[cell]
        while (j !== -1) {
          if (j !== index) {
            const dx = posX[index] - posX[j]
            const dy = posY[index] - posY[j]
            const r2 = dx * dx + dy * dy
            if (r2 < this.smoothingRadius2) {
              handler(j, dx, dy, r2)
            }
          }
          j = this.gridNext[j]
        }
      }
    }
  }

  private enforceBounds(
    index: number,
    posX: Float32Array,
    posY: Float32Array,
    velX: Float32Array,
    velY: Float32Array,
  ) {
    let px = posX[index]
    let py = posY[index]
    let vx = velX[index]
    let vy = velY[index]

    if (px < 0) {
      px = 0
      vx *= -SPH_BOUNDARY_DAMPING
    } else if (px > 1) {
      px = 1
      vx *= -SPH_BOUNDARY_DAMPING
    }

    if (py < 0) {
      py = 0
      vy *= -SPH_BOUNDARY_DAMPING
    } else if (py > 1) {
      py = 1
      vy *= -SPH_BOUNDARY_DAMPING
    }

    posX[index] = px
    posY[index] = py
    velX[index] = vx
    velY[index] = vy
  }

  private determineSubsteps(params: SimulationParams, dt: number): number {
    const maxSteps = Math.max(1, Math.floor(params.maxSubsteps))
    if (maxSteps <= 1) return 1

    const maxSpeed = this.computeMaxSpeed()
    if (maxSpeed <= EPSILON) return 1

    const maxDt = (params.cfl * this.smoothingRadius) / maxSpeed
    if (!Number.isFinite(maxDt) || maxDt <= 0) return 1

    const needed = Math.ceil(dt / maxDt)
    if (needed <= 1) return 1

    return Math.min(maxSteps, Math.max(1, needed))
  }

  private computeMaxSpeed(): number {
    let maxSpeed = 0
    for (let n = 0; n < this.activeList.length; n += 1) {
      const i = this.activeList[n]
      const speed = Math.hypot(this.velX[i], this.velY[i])
      if (speed > maxSpeed) maxSpeed = speed
    }
    return maxSpeed
  }

  private renderComposite() {
    this.renderToTarget(this.materials.composite, this.compositeTarget)
  }

  private renderToTarget(
    material: THREE.RawShaderMaterial,
    target: THREE.WebGLRenderTarget | null,
  ) {
    const previousTarget = this.renderer.getRenderTarget()
    const previousAutoClear = this.renderer.autoClear
    this.renderer.autoClear = false
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(previousTarget)
    this.renderer.autoClear = previousAutoClear
  }

  private clamp01(value: number): number {
    return Math.min(1, Math.max(0, value))
  }

  private gridCoordinate(value: number): number {
    return Math.min(this.gridResolution - 1, Math.max(0, Math.floor(value / this.gridCellSize)))
  }

  private sampleWetnessCell(x: number, y: number): number {
    const ix = Math.min(this.size - 1, Math.max(0, Math.floor(x * this.size)))
    const iy = Math.min(this.size - 1, Math.max(0, Math.floor(y * this.size)))
    return iy * this.size + ix
  }

  private poly6(r2: number): number {
    if (r2 >= this.smoothingRadius2) return 0
    const diff = this.smoothingRadius2 - r2
    return this.poly6Coeff * diff * diff * diff
  }

  private spikyGradient(r: number): number {
    if (r <= 0 || r >= this.smoothingRadius) return 0
    const diff = this.smoothingRadius - r
    return this.spikyGradCoeff * diff * diff
  }

  private viscosityLaplacian(r: number): number {
    if (r >= this.smoothingRadius) return 0
    return this.viscLaplacianCoeff * (this.smoothingRadius - r)
  }
}

export type { BrushType, BrushSettings, SimulationParams, BinderParams } from './types'
export {
  DEFAULT_BINDER_PARAMS,
  DEFAULT_ABSORB_EXPONENT,
  DEFAULT_ABSORB_TIME_OFFSET,
  DEFAULT_ABSORB_MIN_FLUX,
} from './constants'
