
'use client'

import { useCallback, useEffect, useRef } from 'react'
import View from '@/components/canvas/View'
import WatercolorScene from './WatercolorScene'
import WatercolorSimulation, { type BrushType, type SimulationParams } from '@/lib/watercolor/WatercolorSimulation'

type BrushSettings = {
  radius: number
  flow: number
  type: BrushType
  color: [number, number, number]
}

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

      if (reservoir.lastPos) {
        const dx = uv[0] - reservoir.lastPos[0]
        const dy = uv[1] - reservoir.lastPos[1]
        reservoir.distanceSinceStamp += Math.hypot(dx, dy)
      }
      reservoir.lastPos = uv

      if (!forceStamp && reservoir.distanceSinceStamp < stampSpacing) return

      const brushState = brushRef.current
      const waterRatio = reservoir.initialWater > 0 ? reservoir.water / reservoir.initialWater : 0
      const pigmentRatio = reservoir.initialPigment > 0 ? reservoir.pigment / reservoir.initialPigment : 0

      if (brushState.type === 'water' && waterRatio <= 0.01) return
      if (brushState.type === 'pigment' && (waterRatio <= 0.01 || pigmentRatio <= 0.01)) return

      const radiusScale = 0.55 + 0.45 * waterRatio
      const flowScale = 0.25 + 0.75 * waterRatio
      const scaledRadius = Math.max(brushState.radius * radiusScale, 1)
      const scaledFlow = brushState.flow * flowScale

      const color: [number, number, number] = brushState.type === 'pigment'
        ? [
            brushState.color[0] * pigmentRatio,
            brushState.color[1] * pigmentRatio,
            brushState.color[2] * pigmentRatio,
          ]
        : [0, 0, 0]

      sim.splat({
        center: uv,
        radius: scaledRadius / size,
        flow: scaledFlow,
        type: brushState.type,
        color,
      })

      const areaFactor = (scaledRadius / size) ** 2
      const flowContribution = scaledFlow * 0.5
      const consumption = waterConsumption * (areaFactor + flowContribution)
      reservoir.water = Math.max(0, reservoir.water - consumption)
      if (brushState.type === 'pigment') {
        const pigmentUse = pigmentConsumption * (areaFactor + flowContribution)
        reservoir.pigment = Math.max(0, reservoir.pigment - pigmentUse)
      }

      reservoir.lastStamp = uv
      reservoir.distanceSinceStamp = 0
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
