'use client'

import { useCallback, useEffect, useRef } from 'react'
import View from '@/components/canvas/View'
import WatercolorScene from './WatercolorScene'
import WatercolorSimulation, {
  type BrushSettings as SimulationBrushSettings,
  type BrushType,
  type SimulationParams,
  type SpatterSettings,
} from '@/lib/watercolor/WatercolorSimulation'

type BaseBrushSettings = {
  radius: number
  flow: number
  color: [number, number, number]
}

type WashBrushSettings = BaseBrushSettings & { type: 'water' | 'pigment' }

type SpatterBrushSettings = BaseBrushSettings & { type: 'spatter'; spatter: SpatterSettings }

type BrushSettings = WashBrushSettings | SpatterBrushSettings

type WatercolorViewportProps = {
  params: SimulationParams
  brush: BrushSettings
  size?: number
  clearSignal: number
  className?: string
  onSimulationReady?: (sim: WatercolorSimulation | null) => void
}

// Clamp to [0, 1] for normalized UV coordinates.
const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)

type Reservoir = {
  initialWater: number
  initialPigment: number
  water: number
  pigment: number
  lastStamp: [number, number] | null
  lastPos: [number, number] | null
  distanceSinceStamp: number
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
      }
    }

    // Convert pointer events to simulation-space UV coordinates.
    const getUV = (event: PointerEvent): [number, number] => {
      const rect = el.getBoundingClientRect()
      const u = (event.clientX - rect.left) / rect.width
      const v = 1 - (event.clientY - rect.top) / rect.height
      return [clamp01(u), clamp01(v)]
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
        const waterRatio = reservoir.initialWater > 0 ? reservoir.water / reservoir.initialWater : 0
        const pigmentRatio = reservoir.initialPigment > 0 ? reservoir.pigment / reservoir.initialPigment : 0
        const needsPigment = brushState.type !== 'water'

        if (!needsPigment && waterRatio <= 0.01) return false
        if (needsPigment && (waterRatio <= 0.01 || pigmentRatio <= 0.01)) return false

        const radiusScale = 0.55 + 0.45 * waterRatio
        const flowScale = 0.25 + 0.75 * waterRatio
        const scaledRadius = Math.max(brushState.radius * radiusScale, 1)
        const scaledFlow = brushState.flow * flowScale
        const dryness = needsPigment ? Math.min(1, Math.max(0, 1 - waterRatio)) : 0

        const baseColor: [number, number, number] = needsPigment
          ? [
              brushState.color[0] * pigmentRatio,
              brushState.color[1] * pigmentRatio,
              brushState.color[2] * pigmentRatio,
            ]
          : [0, 0, 0]

        const normalizedRadius = scaledRadius / size

        if (brushState.type === 'spatter' && 'spatter' in brushState) {
          const spatter = brushState.spatter
          const baseCount = Math.max(1, Math.round(spatter.dropletCount))
          const jitterAmount = Math.max(0, Math.min(spatter.dropletJitter, 1))
          const randomFactor = 1 + (Math.random() * 2 - 1) * jitterAmount
          const count = Math.max(1, Math.min(96, Math.round(baseCount * randomFactor)))
          const [rangeA, rangeB] = spatter.sizeRange
          const clampedMin = Math.max(0.05, Math.min(rangeA, rangeB))
          const clampedMax = Math.max(clampedMin, Math.max(rangeA, rangeB))
          const spreadRadius = Math.max(0, spatter.spread) * normalizedRadius
          const spreadAngleRad = Math.max(0, (spatter.spreadAngle * Math.PI) / 180)
          const fullCircle = spreadAngleRad >= Math.PI * 2 - 1e-3
          const baseAngle = prevPos ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2
          const droplets: SimulationBrushSettings[] = []
          let areaSum = 0
          let flowSum = 0
          const flowJitter = Math.max(0, Math.min(spatter.flowJitter, 1))

          for (let i = 0; i < count; i += 1) {
            const randomAngle = fullCircle
              ? Math.random() * Math.PI * 2
              : baseAngle + (Math.random() - 0.5) * spreadAngleRad
            const radialFactor = Math.sqrt(Math.random())
            const distance = spreadRadius * radialFactor
            const offsetX = Math.cos(randomAngle) * distance
            const offsetY = Math.sin(randomAngle) * distance
            const center: [number, number] = [
              clamp01(target[0] + offsetX),
              clamp01(target[1] + offsetY),
            ]

            const radiusFactor = clampedMin + Math.random() * (clampedMax - clampedMin)
            const dropletRadius = Math.max(0.0015, normalizedRadius * radiusFactor)
            const jitterRange = scaledFlow * flowJitter
            const dropletFlow = Math.min(
              1,
              Math.max(0, scaledFlow + (Math.random() * 2 - 1) * jitterRange),
            )
            const tint = needsPigment ? 0.6 + Math.random() * 0.4 : 1
            const dropletColor: [number, number, number] = [
              baseColor[0] * tint,
              baseColor[1] * tint,
              baseColor[2] * tint,
            ]

            droplets.push({
              center,
              radius: dropletRadius,
              flow: dropletFlow,
              type: 'pigment',
              color: dropletColor,
              dryness,
            })

            areaSum += dropletRadius ** 2
            flowSum += dropletFlow * 0.5
          }

          if (droplets.length === 0) return false

          const maxPerFrame = 12
          for (let i = 0; i < droplets.length; i += maxPerFrame) {
            const batch = droplets.slice(i, i + maxPerFrame)
            if (i === 0) {
              sim.splatBatch(batch)
            } else {
              requestAnimationFrame(() => {
                if (simRef.current) {
                  simRef.current.splatBatch(batch)
                }
              })
            }
          }

          const usage = areaSum + flowSum
          const waterUse = waterConsumption * usage
          reservoir.water = Math.max(0, reservoir.water - waterUse)
          if (needsPigment) {
            const pigmentUse = pigmentConsumption * usage
            reservoir.pigment = Math.max(0, reservoir.pigment - pigmentUse)
          }

          reservoir.lastStamp = target
          return true
        }

        sim.splat({
          center: target,
          radius: normalizedRadius,
          flow: scaledFlow,
          type: brushState.type,
          color: baseColor,
          dryness,
        })

        const areaFactor = normalizedRadius ** 2
        const flowContribution = scaledFlow * 0.5
        const consumption = waterConsumption * (areaFactor + flowContribution)
        reservoir.water = Math.max(0, reservoir.water - consumption)
        if (needsPigment) {
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

