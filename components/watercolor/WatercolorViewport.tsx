'use client'

import { useCallback, useEffect, useRef } from 'react'
import View from '@/components/canvas/View'
import WatercolorScene from './WatercolorScene'
import WatercolorSimulation, { type BrushType, type SimulationParams } from '@/lib/watercolor/WatercolorSimulation'
import type { Texture } from 'three'

type BrushMaskSettings = {
  texture: Texture
  scale: [number, number]
  strength: number
  pressureScale?: number
  rotationJitter?: number
}

type SpatterBrushSettings = {
  dropletCount: number
  sprayRadius: number
  spreadAngle: number
  minSize: number
  maxSize: number
  sizeBias: number
  radialBias: number
  flowJitter: number
}

export type ViewportBrush = {
  radius: number
  flow: number
  type: BrushType
  color: [number, number, number]
  pasteMode?: boolean
  binderBoost?: number
  pigmentBoost?: number
  mask: BrushMaskSettings
  spatter?: SpatterBrushSettings
}

type WatercolorViewportProps = {
  params: SimulationParams
  brush: ViewportBrush
  size?: number
  clearSignal: number
  className?: string
  onSimulationReady?: (sim: WatercolorSimulation | null) => void
}

// Clamp to [0, 1] for normalized UV coordinates.
const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const TAU = Math.PI * 2

const sampleBiasedRandom = (bias: number) => {
  const clamped = clamp01(bias)
  const r = Math.random()
  if (Math.abs(clamped - 0.5) < 1e-3) {
    return r
  }
  if (clamped < 0.5) {
    const expo = 1 + (0.5 - clamped) * 5
    return Math.pow(r, expo)
  }
  const expo = 1 + (clamped - 0.5) * 5
  return 1 - Math.pow(1 - r, expo)
}

type Reservoir = {
  initialWater: number
  initialPigment: number
  water: number
  pigment: number
  lastStamp: [number, number] | null
  lastPos: [number, number] | null
  distanceSinceStamp: number
  lastAngle: number
}

// WatercolorViewport hosts the interactive canvas and bridges pointer input to the simulation.
const WatercolorViewport = ({
  params,
  brush,
  size = 512,
  clearSignal,
  className,
  onSimulationReady,
}: WatercolorViewportProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const simRef = useRef<WatercolorSimulation | null>(null)
  const brushRef = useRef(brush)
  const paintingRef = useRef(false)
  const reservoirRef = useRef<Reservoir | null>(null)

  useEffect(() => {
    brushRef.current = brush
    reservoirRef.current = null
  }, [brush])

  // Notify upstream code when the GPU simulation becomes available.
  const handleReady = useCallback((sim: WatercolorSimulation | null) => {
    simRef.current = sim
    onSimulationReady?.(sim)
  }, [onSimulationReady])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const reservoirParams = params.reservoir
    reservoirRef.current = null
    const {
      waterCapacityWater,
      waterCapacityPigment,
      pigmentCapacity,
      waterConsumption,
      pigmentConsumption,
      stampSpacing,
    } = reservoirParams

    const previousTouchAction = el.style.touchAction
    const previousCursor = el.style.cursor
    el.style.touchAction = 'none'
    el.style.cursor = 'crosshair'

    // Create a fresh reservoir so water/pigment depletes realistically per stroke.
    const createReservoir = (type: BrushType): Reservoir => {
      if (type === 'water') {
        return {
          initialWater: waterCapacityWater,
          initialPigment: 0,
          water: waterCapacityWater,
          pigment: 0,
          lastStamp: null,
          lastPos: null,
          distanceSinceStamp: stampSpacing,
          lastAngle: 0,
        }
      }

      return {
        initialWater: waterCapacityPigment,
        initialPigment: pigmentCapacity,
        water: waterCapacityPigment,
        pigment: pigmentCapacity,
        lastStamp: null,
        lastPos: null,
        distanceSinceStamp: stampSpacing,
        lastAngle: 0,
      }
    }

    // Convert pointer events to simulation-space UV coordinates.
    const getUV = (event: PointerEvent): [number, number] => {
      const rect = el.getBoundingClientRect()
      const u = (event.clientX - rect.left) / rect.width
      const v = 1 - (event.clientY - rect.top) / rect.height
      return [clamp01(u), clamp01(v)]
    }

    const emitSpatterDroplets = (
      target: [number, number],
      brushState: ViewportBrush,
      reservoir: Reservoir,
      heading: number,
    ) => {
      const simInstance = simRef.current
      const spatter = brushState.spatter
      if (!simInstance || !spatter) {
        return false
      }

      const dropletCount = Math.max(1, Math.round(spatter.dropletCount))
      if (dropletCount <= 0) {
        return false
      }

      const minSize = Math.max(0.01, Math.min(spatter.minSize, spatter.maxSize))
      const maxSize = Math.max(minSize + 1e-4, Math.max(spatter.maxSize, spatter.minSize))
      const sprayRadius = Math.max(spatter.sprayRadius, 0)
      const spreadAngle = clamp(spatter.spreadAngle, 0, 360)
      const halfSpread = (Math.min(spreadAngle, 360) * Math.PI) / 360
      const directional = spreadAngle < 355
      const sizeBias = clamp(spatter.sizeBias, 0, 1)
      const radialBias = clamp(spatter.radialBias, 0, 1)
      const flowJitter = clamp(spatter.flowJitter, 0, 1)
      const binderBoost = brushState.binderBoost ?? 1
      const pigmentBoost = brushState.pigmentBoost ?? 1
      const baseColor = brushState.color
      const baseRadius = Math.max(brushState.radius, 1)

      let emitted = 0

      for (let i = 0; i < dropletCount; i += 1) {
        const waterRatio =
          reservoir.initialWater > 0 ? reservoir.water / reservoir.initialWater : 0
        const pigmentRatio =
          reservoir.initialPigment > 0 ? reservoir.pigment / reservoir.initialPigment : 0
        if (waterRatio <= 0.01 || pigmentRatio <= 0.01) {
          break
        }

        const dirAngle = directional
          ? heading + (Math.random() - 0.5) * 2 * halfSpread
          : Math.random() * TAU

        const radialT = sampleBiasedRandom(radialBias)
        const sizeT = sampleBiasedRandom(sizeBias)
        const dropletScale = minSize + (maxSize - minSize) * sizeT
        const wetScale = 0.5 + 0.5 * waterRatio
        const dropletRadiusPx = Math.max(0.35, baseRadius * wetScale * dropletScale)
        const dropletRadius = dropletRadiusPx / size
        const sizeNorm =
          maxSize > minSize ? (dropletScale - minSize) / (maxSize - minSize) : 0

        const travelWeight = Math.max(0, radialT * (0.45 + 0.55 * sizeNorm))
        const distancePx = baseRadius * sprayRadius * travelWeight
        const offsetX = Math.cos(dirAngle) * (distancePx / size)
        const offsetY = Math.sin(dirAngle) * (distancePx / size)
        const center: [number, number] = [
          clamp(target[0] + offsetX, 0.001, 0.999),
          clamp(target[1] + offsetY, 0.001, 0.999),
        ]

        const drynessBase = Math.min(1, Math.max(0, 1 - waterRatio))
        const dryness = Math.min(1, Math.max(drynessBase, 0.62 + 0.3 * (1 - waterRatio)))
        const lowSolvent = dryness
        const dryThreshold = Math.min(0.95, 0.58 + dryness * 0.32)

        const flowBase = brushState.flow * (0.35 + 0.65 * waterRatio)
        const dropletFlowBase = flowBase * (0.45 + sizeNorm * 0.9)
        const flowVariation = 1 + (Math.random() - 0.5) * 2 * flowJitter
        const dropletFlow = Math.max(0.02, dropletFlowBase * flowVariation)

        const color: [number, number, number] = [
          baseColor[0] * pigmentRatio,
          baseColor[1] * pigmentRatio,
          baseColor[2] * pigmentRatio,
        ]

        const depositBoost = Math.max(pigmentBoost, 1 + sizeNorm * 0.8)

        simInstance.splat({
          center,
          radius: dropletRadius,
          flow: dropletFlow,
          type: 'spatter',
          color,
          dryness,
          dryThreshold,
          lowSolvent,
          binderBoost,
          pigmentBoost,
          depositBoost,
        })

        const areaFactor = dropletRadius * dropletRadius
        const flowContribution = dropletFlow * 0.45
        reservoir.water = Math.max(
          0,
          reservoir.water - waterConsumption * (areaFactor + flowContribution),
        )
        reservoir.pigment = Math.max(
          0,
          reservoir.pigment - pigmentConsumption * (areaFactor + flowContribution),
        )
        emitted += 1
      }

      if (emitted > 0) {
        reservoir.lastStamp = target
      }

      return emitted > 0
    }

    // Stamp pigment/water into the simulation with adaptive spacing and depletion.
    const splatAt = (uv: [number, number], forceStamp = false) => {
      const sim = simRef.current
      const reservoir = reservoirRef.current
      if (!sim || !reservoir) return

      const prevPos = reservoir.lastPos
      const prevDistance = forceStamp ? 0 : reservoir.distanceSinceStamp
      const brushState = brushRef.current

      let dx = 0
      let dy = 0
      let segmentLength = 0
      if (prevPos) {
        dx = uv[0] - prevPos[0]
        dy = uv[1] - prevPos[1]
        segmentLength = Math.hypot(dx, dy)
      }
      reservoir.lastPos = uv

      const stampOnce = (target: [number, number]) => {
        const waterRatio =
          reservoir.initialWater > 0 ? reservoir.water / reservoir.initialWater : 0
        const pigmentRatio =
          reservoir.initialPigment > 0 ? reservoir.pigment / reservoir.initialPigment : 0

        let heading = segmentLength > 1e-5 ? Math.atan2(dy, dx) : reservoir.lastAngle
        if (!Number.isFinite(heading)) {
          heading = 0
        }
        reservoir.lastAngle = heading

        if (brushState.type === 'spatter') {
          if (waterRatio <= 0.01 || pigmentRatio <= 0.01) {
            return false
          }
          return emitSpatterDroplets(target, brushState, reservoir, heading)
        }

        if (brushState.type === 'water' && waterRatio <= 0.01) {
          return false
        }
        if (brushState.type !== 'water' && (waterRatio <= 0.01 || pigmentRatio <= 0.01)) {
          return false
        }

        const radiusScale = 0.55 + 0.45 * waterRatio
        const flowScale = 0.25 + 0.75 * waterRatio
        const scaledRadius = Math.max(brushState.radius * radiusScale, 1)
        const scaledFlow = brushState.flow * flowScale
        const baseDryness =
          brushState.type === 'water' ? 0 : Math.min(1, Math.max(0, 1 - waterRatio))
        const reservoirSolvent = baseDryness > 0.75 ? baseDryness : 0
        const pasteActive = brushState.type === 'pigment' && brushState.pasteMode
        const lowSolvent = pasteActive ? 1 : reservoirSolvent
        const dryness = pasteActive ? Math.max(baseDryness, 0.92) : baseDryness
        const dryThreshold = lowSolvent > 0 ? 0.82 : undefined

        const maskSettings = brushState.mask
        const wetness = clamp01(waterRatio)
        const jitter = (Math.random() - 0.5) * (maskSettings.rotationJitter ?? 0)
        const rotation = heading + jitter
        const pressureFactor = 1 + (maskSettings.pressureScale ?? 0) * (1 - wetness)
        const maskScale: [number, number] = [
          maskSettings.scale[0] * pressureFactor,
          maskSettings.scale[1] * pressureFactor,
        ]
        const maskStrength = Math.min(
          1,
          maskSettings.strength * (0.65 + 0.35 * (1 - wetness)),
        )

        const color: [number, number, number] =
          brushState.type === 'pigment'
            ? [
                brushState.color[0] * pigmentRatio,
                brushState.color[1] * pigmentRatio,
                brushState.color[2] * pigmentRatio,
              ]
            : [0, 0, 0]

        sim.splat({
          center: target,
          radius: scaledRadius / size,
          flow: scaledFlow,
          type: brushState.type,
          color,
          dryness,
          dryThreshold,
          lowSolvent,
          binderBoost: brushState.binderBoost,
          pigmentBoost: brushState.pigmentBoost,
          mask: {
            texture: maskSettings.texture,
            rotation,
            scale: maskScale,
            strength: maskStrength,
          },
        })

        const areaFactor = (scaledRadius / size) ** 2
        const flowContribution = scaledFlow * 0.5
        const consumption = waterConsumption * (areaFactor + flowContribution)
        reservoir.water = Math.max(0, reservoir.water - consumption)
        if (brushState.type === 'pigment') {
          const pigmentUse = pigmentConsumption * (areaFactor + flowContribution)
          reservoir.pigment = Math.max(0, reservoir.pigment - pigmentUse)
        }

        reservoir.lastStamp = target
        return true
      }

      if (forceStamp || !reservoir.lastStamp || !prevPos) {
        if (stampOnce(uv)) {
          reservoir.distanceSinceStamp = 0
        }
        return
      }

      if (segmentLength === 0) {
        reservoir.distanceSinceStamp = prevDistance
        return
      }

      const totalDistance = prevDistance + segmentLength
      let lastMultiple = Math.floor(prevDistance / stampSpacing)
      const kStart = lastMultiple + 1
      const kEnd = Math.floor(totalDistance / stampSpacing)

      if (kEnd < kStart) {
        reservoir.distanceSinceStamp = totalDistance
        return
      }

      // Subdivide the pointer segment so fast motion still emits evenly spaced splats.
      for (let k = kStart; k <= kEnd; k++) {
        const dist = k * stampSpacing
        const t = (dist - prevDistance) / segmentLength
        const target: [number, number] = [
          prevPos[0] + dx * t,
          prevPos[1] + dy * t,
        ]

        if (!stampOnce(target)) {
          reservoir.distanceSinceStamp = totalDistance - lastMultiple * stampSpacing
          return
        }

        lastMultiple = k
      }

      reservoir.distanceSinceStamp = totalDistance - lastMultiple * stampSpacing
    }

    // Pointer listeners manage painting lifecycle and prevent unwanted browser gestures.
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      paintingRef.current = true
      reservoirRef.current = createReservoir(brushRef.current.type)
      const uv = getUV(event)
      const reservoir = reservoirRef.current
      if (reservoir) {
        reservoir.lastPos = uv
        reservoir.distanceSinceStamp = stampSpacing
        if (brushRef.current.type === 'spatter') {
          reservoir.lastAngle = Math.random() * TAU
        }
      }
      event.preventDefault()
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture may be unsupported (e.g. Safari).
      }
      splatAt(uv, true)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!paintingRef.current) return
      event.preventDefault()
      splatAt(getUV(event))
    }

    const endPaint = (event: PointerEvent) => {
      paintingRef.current = false
      reservoirRef.current = null
      try {
        el.releasePointerCapture(event.pointerId)
      } catch {
        // ignore release failures
      }
    }

    const cancelContext = (event: MouseEvent) => {
      event.preventDefault()
    }

    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerup', endPaint)
    el.addEventListener('pointercancel', endPaint)
    el.addEventListener('contextmenu', cancelContext)

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown)
      el.removeEventListener('pointermove', handlePointerMove)
      el.removeEventListener('pointerup', endPaint)
      el.removeEventListener('pointercancel', endPaint)
      el.removeEventListener('contextmenu', cancelContext)
      el.style.touchAction = previousTouchAction
      el.style.cursor = previousCursor
    }
  }, [params, brush, size])

  return (
    <View ref={containerRef} className={className}>
      <WatercolorScene params={params} size={size} clearSignal={clearSignal} onReady={handleReady} />
    </View>
  )
}

export default WatercolorViewport

