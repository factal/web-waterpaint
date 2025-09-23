'use client'

import { useCallback, useEffect, useRef } from 'react'
import View from '@/components/canvas/View'
import WatercolorScene from './WatercolorScene'
import WatercolorSimulation, {
  type BrushType,
  type SimulationParams,
  PIGMENT_CHANNELS,
} from '@/lib/watercolor/WatercolorSimulation'
import { type PigmentChannels } from '@/lib/watercolor/types'
import StrokeMaskBuilder, { type MaskStamp } from '@/lib/watercolor/maskBuilder'
import { type DebugView } from './debugViews'
import type { Texture } from 'three'

type BrushMaskSettings = {
  texture: Texture
  scale: [number, number]
  strength: number
  pressureScale?: number
  rotationJitter?: number
}

export type ViewportBrush = {
  radius: number
  flow: number
  type: BrushType
  color: PigmentChannels
  pasteMode?: boolean
  binderBoost?: number
  pigmentBoost?: number
  mask: BrushMaskSettings
}

type WatercolorViewportProps = {
  params: SimulationParams
  brush: ViewportBrush
  size?: number
  clearSignal: number
  className?: string
  onSimulationReady?: (sim: WatercolorSimulation | null) => void
  debugView?: DebugView
}

// Clamp to [0, 1] for normalized UV coordinates.
const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)
type Reservoir = {
  initialWater: number
  initialPigment: number
  water: number
  pigment: number
  lastPos: [number, number] | null
  lastAngle: number
}

type BrushStamp = {
  mask: MaskStamp
  flow: number
  dryness: number
  dryThreshold?: number
  lowSolvent: number
  color: PigmentChannels
  velocity: [number, number]
}

type StrokeState = {
  stamps: BrushStamp[]
  baseFlow: number
  type: BrushType
  binderBoost: number
  pigmentBoost: number
  depositBoost?: number
  maskTexture: Texture
  lastRadius: number
  pasteMode: boolean
}

// WatercolorViewport hosts the interactive canvas and bridges pointer input to the simulation.
const WatercolorViewport = ({
  params,
  brush,
  size = 512,
  clearSignal,
  className,
  onSimulationReady,
  debugView = 'composite',
}: WatercolorViewportProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const simRef = useRef<WatercolorSimulation | null>(null)
  const brushRef = useRef(brush)
  const paintingRef = useRef(false)
  const reservoirRef = useRef<Reservoir | null>(null)
  const maskBuilderRef = useRef<StrokeMaskBuilder | null>(null)
  const strokeRef = useRef<StrokeState | null>(null)

  useEffect(() => {
    brushRef.current = brush
    reservoirRef.current = null
    strokeRef.current = null
  }, [brush])

  const handleReady = useCallback((sim: WatercolorSimulation | null) => {
    simRef.current = sim
    maskBuilderRef.current = sim?.strokeMaskBuilder ?? null
    onSimulationReady?.(sim)
  }, [onSimulationReady])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const reservoirParams = params.reservoir
    reservoirRef.current = null
    strokeRef.current = null

    const {
      waterCapacityWater,
      waterCapacityPigment,
      pigmentCapacity,
      waterConsumption,
      pigmentConsumption,
    } = reservoirParams

    const previousTouchAction = el.style.touchAction
    const previousCursor = el.style.cursor
    el.style.touchAction = 'none'
    el.style.cursor = 'crosshair'

    const createReservoir = (type: BrushType): Reservoir => {
      if (type === 'water') {
        return {
          initialWater: waterCapacityWater,
          initialPigment: 0,
          water: waterCapacityWater,
          pigment: 0,
          lastPos: null,
          lastAngle: 0,
        }
      }

      return {
        initialWater: waterCapacityPigment,
        initialPigment: pigmentCapacity,
        water: waterCapacityPigment,
        pigment: pigmentCapacity,
        lastPos: null,
        lastAngle: 0,
      }
    }

    const getUV = (event: PointerEvent): [number, number] => {
      const rect = el.getBoundingClientRect()
      const u = (event.clientX - rect.left) / rect.width
      const v = 1 - (event.clientY - rect.top) / rect.height
      return [clamp01(u), clamp01(v)]
    }

    const summarizeStamps = (stroke: StrokeState) => {
      const baseFlow = Math.max(stroke.baseFlow, 1e-5)
      let totalWeight = 0
      let flowRatioSum = 0
      let strengthSum = 0
      let drynessSum = 0
      let lowSolventSum = 0
      let dryThresholdSum = 0
      let dryThresholdWeight = 0
      const colorSum = new Array<number>(PIGMENT_CHANNELS).fill(0)
      let colorWeight = 0
      let velocitySumX = 0
      let velocitySumY = 0
      let velocityWeight = 0

      stroke.stamps.forEach((stamp) => {
        const weight = Math.max(stamp.mask.radius * stamp.mask.radius, 1e-5)
        totalWeight += weight
        const flowRatio = baseFlow > 1e-5 ? stamp.flow / baseFlow : 1
        flowRatioSum += flowRatio * weight
        strengthSum += stamp.mask.strength * weight
        drynessSum += stamp.dryness * weight
        lowSolventSum += stamp.lowSolvent * weight
        for (let i = 0; i < PIGMENT_CHANNELS; i += 1) {
          colorSum[i] += stamp.color[i] * weight
        }
        colorWeight += weight
        const velWeight = Math.max(stamp.flow, 0) * weight
        velocitySumX += stamp.velocity[0] * velWeight
        velocitySumY += stamp.velocity[1] * velWeight
        velocityWeight += velWeight
        if (typeof stamp.dryThreshold === 'number') {
          dryThresholdSum += stamp.dryThreshold * weight
          dryThresholdWeight += weight
        }
      })

      const flowScale = totalWeight > 0 ? flowRatioSum / totalWeight : 1
      const maskStrength = totalWeight > 0 ? strengthSum / totalWeight : 1
      const dryness = totalWeight > 0 ? drynessSum / totalWeight : 0
      const lowSolvent = totalWeight > 0 ? lowSolventSum / totalWeight : 0
      const dryThreshold =
        dryThresholdWeight > 0 ? dryThresholdSum / dryThresholdWeight : undefined
      const color: PigmentChannels = Array.from({ length: PIGMENT_CHANNELS }, (_, i) =>
        colorWeight > 0 ? colorSum[i] / colorWeight : 0,
      ) as PigmentChannels
      const velocityVecX = velocityWeight > 0 ? velocitySumX / velocityWeight : 0
      const velocityVecY = velocityWeight > 0 ? velocitySumY / velocityWeight : 0
      const velocityStrength = Math.hypot(velocityVecX, velocityVecY)
      const velocity: [number, number] =
        velocityStrength > 1e-5
          ? [velocityVecX / velocityStrength, velocityVecY / velocityStrength]
          : [0, 0]

      return {
        flowScale,
        maskStrength,
        dryness,
        dryThreshold,
        lowSolvent,
        color,
        velocity,
        velocityStrength,
      }
    }

    const flushStroke = (final = false) => {
      const stroke = strokeRef.current
      if (!stroke) {
        return
      }
      const sim = simRef.current
      const builder = maskBuilderRef.current
      if (!sim || !builder) {
        stroke.stamps = []
        if (final) {
          strokeRef.current = null
        }
        return
      }
      if (stroke.stamps.length === 0) {
        if (final) {
          strokeRef.current = null
        }
        return
      }

      const { texture } = builder.build(
        stroke.stamps.map((stamp) => stamp.mask),
        stroke.maskTexture,
      )
      const summary = summarizeStamps(stroke)

      sim.splat({
        flow: stroke.baseFlow,
        type: stroke.type,
        color: summary.color,
        dryness: summary.dryness,
        dryThreshold: summary.dryThreshold,
        lowSolvent: summary.lowSolvent,
        binderBoost: stroke.binderBoost,
        pigmentBoost: stroke.pigmentBoost,
        depositBoost: stroke.depositBoost,
        mask: {
          kind: 'stroke',
          texture,
          strength: summary.maskStrength,
          flowScale: summary.flowScale,
          velocity: summary.velocity,
          velocityStrength: summary.velocityStrength,
        },
      })

      stroke.stamps = []
      if (final) {
        strokeRef.current = null
      }
    }

    const addStamp = (uv: [number, number], dir: [number, number]) => {
      const stroke = strokeRef.current
      const reservoir = reservoirRef.current
      const brushState = brushRef.current
      if (!stroke || !reservoir || !brushState) {
        return false
      }
      if (!brushState.mask.texture) {
        return false
      }

      const waterRatio =
        reservoir.initialWater > 0 ? reservoir.water / reservoir.initialWater : 0
      const pigmentRatio =
        reservoir.initialPigment > 0
          ? reservoir.pigment / reservoir.initialPigment
          : 0

      if (brushState.type === 'water' && waterRatio <= 0.01) {
        return false
      }
      if (
        brushState.type !== 'water' &&
        (waterRatio <= 0.01 || pigmentRatio <= 0.01)
      ) {
        return false
      }

      const baseFlow = brushState.flow
      const wetness = clamp01(waterRatio)
      const radiusScale = 0.55 + 0.45 * wetness
      const scaledRadiusPx = Math.max(brushState.radius * radiusScale, 1)
      const radiusNorm = scaledRadiusPx / size
      const flowScale = 0.25 + 0.75 * wetness
      const actualFlow = baseFlow * flowScale

      const pasteActive = stroke.pasteMode
      const baseDryness =
        brushState.type === 'water' ? 0 : clamp01(1 - waterRatio)
      const lowSolvent = 0
      const dryness = pasteActive ? Math.max(baseDryness, 0.92) : baseDryness
      const dryThreshold = lowSolvent > 0 ? 0.82 : undefined

      let dirX = dir[0]
      let dirY = dir[1]
      const length = Math.hypot(dirX, dirY)
      let heading = reservoir.lastAngle
      if (length > 1e-5) {
        dirX /= length
        dirY /= length
        heading = Math.atan2(dirY, dirX)
      } else {
        dirX = Math.cos(heading)
        dirY = Math.sin(heading)
      }
      reservoir.lastAngle = heading

      const maskSettings = brushState.mask
      const pressureFactor = 1 + (maskSettings.pressureScale ?? 0) * (1 - wetness)
      const maskScale: [number, number] = [
        maskSettings.scale[0] * pressureFactor,
        maskSettings.scale[1] * pressureFactor,
      ]
      const jitter = (Math.random() - 0.5) * (maskSettings.rotationJitter ?? 0)
      const rotation = heading + jitter
      const maskStrength = Math.min(
        1,
        maskSettings.strength * (0.65 + 0.35 * (1 - wetness)),
      )

      const color: PigmentChannels = Array.from({ length: PIGMENT_CHANNELS }, (_, i) =>
        brushState.type === 'pigment' ? brushState.color[i] * pigmentRatio : 0,
      ) as PigmentChannels

      stroke.stamps.push({
        mask: {
          center: uv,
          radius: radiusNorm,
          rotation,
          scale: maskScale,
          strength: maskStrength,
        },
        flow: actualFlow,
        dryness,
        dryThreshold,
        lowSolvent,
        color,
        velocity: [dirX * actualFlow, dirY * actualFlow],
      })
      stroke.lastRadius = radiusNorm
      reservoir.lastPos = uv

      const areaFactor = radiusNorm * radiusNorm
      const flowContribution = actualFlow * 0.5
      reservoir.water = Math.max(
        0,
        reservoir.water - waterConsumption * (areaFactor + flowContribution),
      )
      if (brushState.type === 'pigment') {
        reservoir.pigment = Math.max(
          0,
          reservoir.pigment - pigmentConsumption * (areaFactor + flowContribution),
        )
      }

      if (stroke.stamps.length >= 48) {
        flushStroke(false)
      }

      return true
    }

    const addSegment = (uv: [number, number]) => {
      const reservoir = reservoirRef.current
      const stroke = strokeRef.current
      const brushState = brushRef.current
      if (!reservoir || !stroke || !brushState) {
        return false
      }

      const prev = reservoir.lastPos
      if (!prev) {
        reservoir.lastPos = uv
        return addStamp(uv, [0, 0])
      }

      const dx = uv[0] - prev[0]
      const dy = uv[1] - prev[1]
      const dist = Math.hypot(dx, dy)
      if (dist < 1e-5) {
        return false
      }

      const dir: [number, number] = [dx / dist, dy / dist]
      const spacingBase = Math.max(
        stroke.lastRadius || brushState.radius / size,
        0.0015,
      )
      const spacing = Math.max(spacingBase * 0.75, 0.001)
      const steps = Math.max(1, Math.ceil(dist / spacing))

      let added = false

      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps
        const point: [number, number] = [prev[0] + dx * t, prev[1] + dy * t]
        if (!addStamp(point, dir)) {
          return added
        }
        added = true
      }

      return added
    }

    const beginStroke = (uv: [number, number]) => {
      if (!maskBuilderRef.current) {
        return
      }
      const brushState = brushRef.current
      if (!brushState) {
        return
      }
      const reservoir = createReservoir(brushState.type)
      reservoir.lastPos = uv
      reservoir.lastAngle = 0
      reservoirRef.current = reservoir

      const maskTexture = brushState.mask.texture
      if (!maskTexture) {
        return
      }

      strokeRef.current = {
        stamps: [],
        baseFlow: Math.max(brushState.flow, 0),
        type: brushState.type,
        binderBoost: brushState.binderBoost ?? 1,
        pigmentBoost: brushState.pigmentBoost ?? 1,
        depositBoost: brushState.pigmentBoost ?? 1,
        maskTexture,
        lastRadius: 0,
        pasteMode: brushState.type === 'pigment' && !!brushState.pasteMode,
      }

      if (addStamp(uv, [0, 0])) {
        flushStroke(false)
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const brushState = brushRef.current
      if (!brushState) return
      if (!maskBuilderRef.current) {
        return
      }
      paintingRef.current = true
      const uv = getUV(event)

      beginStroke(uv)

      event.preventDefault()
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        // ignore pointer capture failures
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!paintingRef.current) return
      const brushState = brushRef.current
      const reservoir = reservoirRef.current
      if (!brushState || !reservoir) return

      event.preventDefault()
      const uv = getUV(event)

      if (addSegment(uv)) {
        flushStroke(false)
      }
    }

    const endPaint = (event: PointerEvent) => {
      paintingRef.current = false
      flushStroke(true)
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
      flushStroke(true)
      reservoirRef.current = null
      strokeRef.current = null
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
      <WatercolorScene
        params={params}
        size={size}
        clearSignal={clearSignal}
        onReady={handleReady}
        debugView={debugView}
      />
    </View>
  )
}

export default WatercolorViewport

