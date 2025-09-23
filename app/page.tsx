'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Leva, button, useControls } from 'leva'
import BrushControlsPanel, {
  type BrushMaskId,
  type BrushMediumSettings,
  type BrushPasteSettings,
  type BrushReservoirSettings,
  type BrushSettings,
  type BrushTool,
  type PigmentPickerSlot,
} from '@/components/dom/BrushControlsPanel'
import WatercolorViewport, { type ViewportBrush } from '@/components/watercolor/WatercolorViewport'
import { DEBUG_VIEW_LABELS, DEBUG_VIEW_OPTIONS, type DebugView } from '@/components/watercolor/debugViews'
import * as THREE from 'three'
import {
  DEFAULT_ABSORB_EXPONENT,
  DEFAULT_ABSORB_MIN_FLUX,
  DEFAULT_ABSORB_TIME_OFFSET,
  DEFAULT_BINDER_PARAMS,
  DEFAULT_PAPER_TEXTURE_STRENGTH,
  DEFAULT_SIZING_INFLUENCE,
  DEFAULT_SURFACE_TENSION_PARAMS,
  DEFAULT_FRINGE_PARAMS,
  DEFAULT_RING_PARAMS,
  PIGMENT_CHANNELS,
  DEFAULT_PIGMENT_DIFFUSION,
  DEFAULT_PIGMENT_SETTLE,
  type BrushType,
  type SimulationParams,
} from '@/lib/watercolor/WatercolorSimulation'
import { type PigmentChannels } from '@/lib/watercolor/types'

const SIM_SIZE = 512

type BrushMaskAsset = {
  texture: THREE.DataTexture
  scale: [number, number]
  baseStrength: number
  pressureScale: number
  rotationJitter: number
}

const fract = (value: number) => value - Math.floor(value)

function createMaskTexture(variant: BrushMaskId, density: number): THREE.DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  const stripeFreq = THREE.MathUtils.lerp(6, 32, density)
  const swirl = THREE.MathUtils.lerp(0.25, 1.1, density)

  for (let y = 0; y < size; y += 1) {
    const v = (y / (size - 1)) * 2 - 1
    for (let x = 0; x < size; x += 1) {
      const u = (x / (size - 1)) * 2 - 1
      const idx = (y * size + x) * 4
      const radiusSq = u * u + v * v
      const gaussian = Math.exp(-1.35 * radiusSq)

      let pattern = 1
      if (variant === 'round') {
        const rings = Math.exp(-0.9 * Math.pow(Math.max(radiusSq - 0.25, 0), 1.4))
        const wobble = 0.9 + 0.1 * Math.cos((u + v) * (4 + density * 6))
        pattern = rings * wobble
      } else if (variant === 'flat') {
        const taper = Math.exp(-1.1 * Math.pow(Math.abs(v) * 1.2, 1.8))
        const stripes = 0.55 + 0.45 * Math.cos(u * stripeFreq + Math.sin(v * 5) * 0.6)
        pattern = taper * stripes
      } else {
        const angle = Math.atan2(v, u)
        const spokes = 0.6 + 0.4 * Math.cos(angle * (stripeFreq * 0.45) + v * swirl)
        const fan = Math.exp(-0.6 * Math.pow(Math.max(radiusSq - 0.1, 0), 1.5))
        pattern = spokes * fan
      }

      const random = fract(Math.sin((x + 11.1) * 12.9898 + (y + 78.233) * 0.875) * 43758.5453)
      const noise = 0.88 + 0.12 * random
      const mixAmount = variant === 'round' ? 0.35 : 0.85
      const mixedPattern = 1 + (pattern - 1) * mixAmount
      const value = Math.max(0, Math.min(1, gaussian * mixedPattern * noise))
      const byte = Math.round(value * 255)

      data[idx] = byte
      data[idx + 1] = byte
      data[idx + 2] = byte
      data[idx + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.name = `${variant}-brush-mask`
  texture.needsUpdate = true
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  return texture
}

function createBrushMaskAssets(density: number): Record<BrushMaskId, BrushMaskAsset> {
  return {
    round: {
      texture: createMaskTexture('round', density * 0.5 + 0.25),
      scale: [1, 1],
      baseStrength: 0.55,
      pressureScale: 0.15,
      rotationJitter: 0.1,
    },
    flat: {
      texture: createMaskTexture('flat', density),
      scale: [1.6, 0.85],
      baseStrength: 1,
      pressureScale: 0.45,
      rotationJitter: 0.2,
    },
    fan: {
      texture: createMaskTexture('fan', density * 0.75 + 0.1),
      scale: [1.25, 1.05],
      baseStrength: 0.85,
      pressureScale: 0.3,
      rotationJitter: 0.35,
    },
  }
}

type RgbColor = [number, number, number]

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)

const srgbToLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)

const sanitizeRgb = (rgb: RgbColor): RgbColor => [
  clamp01(rgb[0]),
  clamp01(rgb[1]),
  clamp01(rgb[2]),
] as RgbColor

const rgbToPigmentChannels = (rgb: RgbColor): PigmentChannels => {
  const linearR = srgbToLinear(rgb[0])
  const linearG = srgbToLinear(rgb[1])
  const linearB = srgbToLinear(rgb[2])

  let r = linearR
  let g = linearG
  let b = linearB

  const channels = new Array<number>(PIGMENT_CHANNELS).fill(0)

  const w = Math.min(r, Math.min(g, b))
  r -= w
  g -= w
  b -= w

  const c = Math.min(g, b)
  const m = Math.min(r, b)
  const y = Math.min(r, g)

  const rSingle = Math.min(Math.max(0, r - b), Math.max(0, r - g))
  const gSingle = Math.min(Math.max(0, g - b), Math.max(0, g - r))
  const bSingle = Math.min(Math.max(0, b - g), Math.max(0, b - r))

  channels[0] = clamp01(rSingle)
  channels[1] = clamp01(gSingle)
  channels[2] = clamp01(bSingle)
  channels[3] = clamp01(w)
  channels[4] = clamp01(c)
  channels[5] = clamp01(m)
  channels[6] = clamp01(y)

  return channels as PigmentChannels
}

const DEFAULT_PIGMENT_PRESETS: RgbColor[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
  [1, 0, 1],
  [1, 1, 0],
]

const DEFAULT_PIGMENTS: PigmentPickerSlot[] = DEFAULT_PIGMENT_PRESETS.map((rgb) => {
  const sanitized = sanitizeRgb(rgb)
  return {
    display: sanitized,
    channels: rgbToPigmentChannels(sanitized),
  }
})


function toolToBrushType(tool: BrushTool): BrushType {
  if (tool === 'water') return 'water'
  return 'pigment'
}

export default function Home() {
  const [clearSignal, setClearSignal] = useState(0)

  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    tool: 'water',
    radius: 18,
    flow: 0.45,
    mask: 'round',
    maskStrength: 0.75,
    streakDensity: 0.55,
  })
  const [mediumSettings, setMediumSettings] = useState<BrushMediumSettings>({
    binderCharge: DEFAULT_BINDER_PARAMS.injection,
    waterLoad: 0.8,
  })
  const [pasteSettings, setPasteSettings] = useState<BrushPasteSettings>({
    pasteMode: false,
    pasteBinderBoost: 4,
    pastePigmentBoost: 2.5,
  })
  const [reservoirSettings, setReservoirSettings] = useState<BrushReservoirSettings>({
    waterCapacityWater: 14,
    pigmentCapacity: 11,
    waterConsumption: 0.028,
    pigmentConsumption: 0.022,
  })
const [pigments, setPigments] = useState<PigmentPickerSlot[]>(() =>
  DEFAULT_PIGMENTS.map((slot) => ({
    display: [...slot.display] as RgbColor,
    channels: [...slot.channels] as PigmentChannels,
  })),
)

  const handlePigmentColorChange = useCallback((index: number, color: RgbColor) => {
    setPigments((previous) => {
      if (!previous[index]) return previous
      return previous.map((slot, slotIndex) => {
        if (slotIndex !== index) return slot
        const sanitized = sanitizeRgb(color)
        return {
          display: sanitized,
          channels: rgbToPigmentChannels(sanitized),
        }
      })
    })
  }, [])

  const handleBrushChange = useCallback((value: Partial<BrushSettings>) => {
    setBrushSettings((previous) => ({ ...previous, ...value }))
  }, [])
  const handleMediumChange = useCallback((value: Partial<BrushMediumSettings>) => {
    setMediumSettings((previous) => ({ ...previous, ...value }))
  }, [])
  const handlePasteChange = useCallback((value: Partial<BrushPasteSettings>) => {
    setPasteSettings((previous) => ({ ...previous, ...value }))
  }, [])
  const handleReservoirChange = useCallback((value: Partial<BrushReservoirSettings>) => {
    setReservoirSettings((previous) => ({ ...previous, ...value }))
  }, [])

  const dryingControls = useControls('Drying & Deposits', {
    evap: { label: 'Evaporation', value: 0.02, min: 0, max: 1, step: 0.001 },
    absorb: { label: 'Absorption', value: 0.25, min: 0, max: 2, step: 0.001 },
    edge: { label: 'Edge Bias', value: 2.0, min: 0, max: 8, step: 0.01 },
    backrunStrength: { label: 'Backrun Strength', value: 0.45, min: 0, max: 2, step: 0.01 },
    sizingInfluence: {
      label: 'Sizing Variation',
      value: DEFAULT_SIZING_INFLUENCE,
      min: 0,
      max: 0.6,
      step: 0.005,
    },
  })

  const dynamicsControls = useControls('Flow Dynamics', {
    grav: { label: 'Gravity', value: 0.9, min: 0, max: 2, step: 0.01 },
    visc: { label: 'Viscosity', value: 0.02, min: 0, max: 1, step: 0.001 },
    cfl: { label: 'CFL Safety', value: 0.7, min: 0.1, max: 2, step: 0.05 },
    maxSubsteps: { label: 'Max Substeps', value: 4, min: 1, max: 8, step: 1 },
  })

  const surfaceTensionControls = useControls('Surface Tension', {
    enabled: {
      label: 'Enable Surface Tension',
      value: DEFAULT_SURFACE_TENSION_PARAMS.enabled,
    },
    strength: {
      label: 'Strength',
      value: DEFAULT_SURFACE_TENSION_PARAMS.strength,
      min: 0,
      max: 8,
      step: 0.05,
    },
    threshold: {
      label: 'Neighbour Threshold',
      value: DEFAULT_SURFACE_TENSION_PARAMS.threshold,
      min: 0,
      max: 0.5,
      step: 0.005,
    },
    breakThreshold: {
      label: 'Break Threshold',
      value: DEFAULT_SURFACE_TENSION_PARAMS.breakThreshold,
      min: 0,
      max: 0.2,
      step: 0.001,
    },
    snapStrength: {
      label: 'Snap Strength',
      value: DEFAULT_SURFACE_TENSION_PARAMS.snapStrength,
      min: 0,
      max: 1,
      step: 0.01,
    },
    velocityLimit: {
      label: 'Velocity Limit',
      value: DEFAULT_SURFACE_TENSION_PARAMS.velocityLimit,
      min: 0.01,
      max: 2,
      step: 0.01,
    },
  })

  const binderControls = useControls('Binder Dynamics', {
    diffusion: {
      label: 'Diffusion',
      value: DEFAULT_BINDER_PARAMS.diffusion,
      min: 0,
      max: 1,
      step: 0.01,
    },
    decay: {
      label: 'Drying Rate',
      value: DEFAULT_BINDER_PARAMS.decay,
      min: 0,
      max: 1,
      step: 0.01,
    },
    elasticity: {
      label: 'Elastic Coupling',
      value: DEFAULT_BINDER_PARAMS.elasticity,
      min: 0,
      max: 3,
      step: 0.05,
    },
    viscosity: {
      label: 'Viscous Drag',
      value: DEFAULT_BINDER_PARAMS.viscosity,
      min: 0,
      max: 3,
      step: 0.05,
    },
    buoyancy: {
      label: 'Buoyancy',
      value: DEFAULT_BINDER_PARAMS.buoyancy,
      min: -1,
      max: 1,
      step: 0.01,
    },
  })

  const featureControls = useControls('Features', {
    stateAbsorption: { label: 'State Absorption', value: true },
    granulation: { label: 'Granulation', value: true },
    paperTextureStrength: {
      label: 'Paper Texture Influence',
      value: DEFAULT_PAPER_TEXTURE_STRENGTH,
      min: 0,
      max: 2,
      step: 0.01,
    },
  })

  const ringControls = useControls('Evaporation Rings', {
    enabled: { label: 'Enable Rings', value: DEFAULT_RING_PARAMS.enabled },
    strength: {
      label: 'Strength',
      value: DEFAULT_RING_PARAMS.strength,
      min: 0,
      max: 6,
      step: 0.05,
    },
    filmThreshold: {
      label: 'Film Threshold',
      value: DEFAULT_RING_PARAMS.filmThreshold,
      min: 0.01,
      max: 0.2,
      step: 0.005,
    },
    filmFeather: {
      label: 'Film Feather',
      value: DEFAULT_RING_PARAMS.filmFeather,
      min: 0.01,
      max: 0.12,
      step: 0.005,
    },
    gradientScale: {
      label: 'Gradient Scale',
      value: DEFAULT_RING_PARAMS.gradientScale,
      min: 1,
      max: 24,
      step: 0.5,
    },
  })

  const fringeControls = useControls('Capillary Fringe', {
    enabled: { label: 'Enable Fringe', value: DEFAULT_FRINGE_PARAMS.enabled },
    strength: {
      label: 'Strength',
      value: DEFAULT_FRINGE_PARAMS.strength,
      min: 0,
      max: 2,
      step: 0.01,
    },
    threshold: {
      label: 'Front Threshold',
      value: DEFAULT_FRINGE_PARAMS.threshold,
      min: 0.01,
      max: 0.6,
      step: 0.005,
    },
    noiseScale: {
      label: 'Noise Scale',
      value: DEFAULT_FRINGE_PARAMS.noiseScale,
      min: 1,
      max: 128,
      step: 1,
    },
  })

  const debugControls = useControls('Debug Visualization', {
    debugView: {
      label: 'Channel',
      value: 'composite' as DebugView,
      options: DEBUG_VIEW_OPTIONS,
    },
  })

  useControls('Actions', {
    clear: button(() => setClearSignal((value) => value + 1)),
  })

  const {
    tool,
    radius,
    flow,
    mask: maskId,
    maskStrength,
    streakDensity,
  } = brushSettings
  const { evap, absorb, edge, backrunStrength, sizingInfluence } = dryingControls as {
    evap: number
    absorb: number
    edge: number
    backrunStrength: number
    sizingInfluence: number
  }
  const { grav, visc, cfl, maxSubsteps } = dynamicsControls as { grav: number; visc: number; cfl: number; maxSubsteps: number }
  const {
    enabled: surfaceTensionEnabled,
    strength: surfaceTensionStrength,
    threshold: surfaceTensionThreshold,
    breakThreshold: surfaceTensionBreakThreshold,
    snapStrength: surfaceTensionSnapStrength,
    velocityLimit: surfaceTensionVelocityLimit,
  } = surfaceTensionControls as {
    enabled: boolean
    strength: number
    threshold: number
    breakThreshold: number
    snapStrength: number
    velocityLimit: number
  }
  const {
    diffusion: binderDiffusion,
    decay: binderDecay,
    elasticity: binderElasticity,
    viscosity: binderViscosity,
    buoyancy: binderBuoyancy,
  } = binderControls as {
    diffusion: number
    decay: number
    elasticity: number
    viscosity: number
    buoyancy: number
  }
  const { binderCharge, waterLoad } = mediumSettings
  const { pasteMode, pasteBinderBoost, pastePigmentBoost } = pasteSettings
  const { stateAbsorption, granulation, paperTextureStrength } = featureControls as {
    stateAbsorption: boolean
    granulation: boolean
    paperTextureStrength: number
  }
  const debugView = debugControls.debugView as DebugView
  const {
    enabled: ringEnabled,
    strength: ringStrength,
    filmThreshold: ringFilmThreshold,
    filmFeather: ringFilmFeather,
    gradientScale: ringGradientScale,
  } = ringControls as {
    enabled: boolean
    strength: number
    filmThreshold: number
    filmFeather: number
    gradientScale: number
  }
  const {
    enabled: fringeEnabled,
    strength: fringeStrength,
    threshold: fringeThreshold,
    noiseScale: fringeNoiseScale,
  } = fringeControls as {
    enabled: boolean
    strength: number
    threshold: number
    noiseScale: number
  }
  const { waterCapacityWater, pigmentCapacity, waterConsumption, pigmentConsumption } = reservoirSettings
  const pigmentIndex = tool === 'water' ? -1 : parseInt(tool.slice(-1), 10)
  const pigmentIndicatorColor =
    pigmentIndex >= 0 && pigments[pigmentIndex]
      ? pigments[pigmentIndex].display
      : null

  const maskAssets = useMemo(() => createBrushMaskAssets(streakDensity), [streakDensity])

  useEffect(
    () => () => {
      Object.values(maskAssets).forEach((asset) => asset.texture.dispose())
    },
    [maskAssets],
  )

  const activeMask = maskAssets[maskId] ?? maskAssets.round

  const brush = useMemo<ViewportBrush>(
    () => {
      const brushType = toolToBrushType(tool)
      const pigment = pigmentIndex >= 0 ? pigments[pigmentIndex] : undefined
      const color: PigmentChannels = pigment
        ? ([...pigment.channels] as PigmentChannels)
        : (Array.from({ length: PIGMENT_CHANNELS }, () => 0) as PigmentChannels)
      const maskStrengthValue = Math.min(1, maskStrength * activeMask.baseStrength)
      const pasteActive = brushType === 'pigment' && pasteMode

      return {
        radius,
        flow,
        type: brushType,
        color,
        pasteMode: pasteActive,
        binderBoost: pasteBinderBoost,
        pigmentBoost: pastePigmentBoost,
        mask: {
          texture: activeMask.texture,
          scale: activeMask.scale,
          strength: maskStrengthValue,
          pressureScale: activeMask.pressureScale,
          rotationJitter: activeMask.rotationJitter,
        },
      }
    },
    [
      radius,
      flow,
      tool,
      pigmentIndex,
      pasteMode,
      pasteBinderBoost,
      pastePigmentBoost,
      activeMask,
      maskStrength,
      pigments,
    ],
  )

  const params = useMemo<SimulationParams>(() => ({
    grav,
    visc,
    absorb,
    evap,
    edge,
    backrunStrength,
    sizingInfluence,
    stateAbsorption,
    granulation,
    paperTextureStrength,
    absorbExponent: DEFAULT_ABSORB_EXPONENT,
    absorbTimeOffset: DEFAULT_ABSORB_TIME_OFFSET,
    absorbMinFlux: DEFAULT_ABSORB_MIN_FLUX,
    cfl,
    maxSubsteps,
    binder: {
      injection: binderCharge,
      diffusion: binderDiffusion,
      decay: binderDecay,
      elasticity: binderElasticity,
      viscosity: binderViscosity,
      buoyancy: binderBuoyancy,
    },
    surfaceTension: {
      enabled: surfaceTensionEnabled,
      strength: surfaceTensionStrength,
      threshold: surfaceTensionThreshold,
      breakThreshold: surfaceTensionBreakThreshold,
      snapStrength: surfaceTensionSnapStrength,
      velocityLimit: surfaceTensionVelocityLimit,
    },
    capillaryFringe: {
      enabled: fringeEnabled,
      strength: fringeStrength,
      threshold: fringeThreshold,
      noiseScale: fringeNoiseScale,
    },
    evaporationRings: {
      enabled: ringEnabled,
      strength: ringStrength,
      filmThreshold: ringFilmThreshold,
      filmFeather: ringFilmFeather,
      gradientScale: ringGradientScale,
    },
    reservoir: {
      waterCapacityWater,
      waterCapacityPigment: waterLoad,
      pigmentCapacity,
      waterConsumption,
      pigmentConsumption,
    },
    pigmentCoefficients: {
      diffusion: DEFAULT_PIGMENT_DIFFUSION,
      settle: DEFAULT_PIGMENT_SETTLE,
    },
  }), [
    grav,
    visc,
    absorb,
    evap,
    edge,
    backrunStrength,
    sizingInfluence,
    stateAbsorption,
    granulation,
    paperTextureStrength,
    cfl,
    maxSubsteps,
    binderCharge,
    binderDiffusion,
    binderDecay,
    binderElasticity,
    binderViscosity,
    binderBuoyancy,
    surfaceTensionEnabled,
    surfaceTensionStrength,
    surfaceTensionThreshold,
    surfaceTensionBreakThreshold,
    surfaceTensionSnapStrength,
    surfaceTensionVelocityLimit,
    fringeEnabled,
    fringeStrength,
    fringeThreshold,
    fringeNoiseScale,
    ringEnabled,
    ringStrength,
    ringFilmThreshold,
    ringFilmFeather,
    ringGradientScale,
    waterCapacityWater,
    waterLoad,
    pigmentCapacity,
    waterConsumption,
    pigmentConsumption,
  ])

  return (
    <main className='relative flex min-h-screen flex-col items-center justify-center bg-[#111111] text-slate-200'>
      <Leva collapsed titleBar={{ title: 'Watercolor Controls', drag: true }} />

      <div className='relative flex w-full max-w-6xl flex-col items-center gap-6 px-4 pb-12 pt-28 sm:px-8 sm:pt-32 lg:flex-row lg:items-start lg:justify-between lg:gap-10'>
        <BrushControlsPanel
          className='w-full lg:max-w-[360px]'
          brush={brushSettings}
          medium={mediumSettings}
          paste={pasteSettings}
          reservoir={reservoirSettings}
          pigments={pigments}
          onBrushChange={handleBrushChange}
          onMediumChange={handleMediumChange}
          onPasteChange={handlePasteChange}
          onReservoirChange={handleReservoirChange}
          onPigmentColorChange={handlePigmentColorChange}
        />

        <div className='relative flex-1'>
          <div className='relative mx-auto w-full max-w-[min(720px,90vw)]'>
            <WatercolorViewport
              className='aspect-square w-full overflow-hidden rounded-3xl border border-slate-700/40 bg-slate-900/70 shadow-2xl'
              params={params}
              brush={brush}
              size={SIM_SIZE}
              clearSignal={clearSignal}
              debugView={debugView}
            />
            <div className='pointer-events-none absolute bottom-4 left-4 flex flex-col gap-1 text-[10px] tracking-wide text-slate-400 sm:text-xs'>
              <span className='uppercase'>Resolution {SIM_SIZE}x{SIM_SIZE}</span>
              {debugView !== 'composite' && (
                <span className='inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/70 px-2 py-1 text-[9px] font-semibold text-slate-200 shadow-sm sm:text-[10px]'>
                  <span className='uppercase text-slate-400'>Debug</span>
                  <span className='normal-case text-slate-100'>{DEBUG_VIEW_LABELS[debugView]}</span>
                </span>
              )}
            </div>
            {brush.type !== 'water' && pigmentIndex >= 0 && (
              <div className='pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-full border border-slate-500/60 bg-slate-900/80 px-3 py-1 text-xs text-slate-200 shadow-lg sm:text-sm'>
                <span
                  className='inline-flex h-3 w-3 rounded-full border border-white/40 sm:h-4 sm:w-4'
                  style={
                    pigmentIndicatorColor
                      ? {
                          background: `rgb(${Math.round(pigmentIndicatorColor[0] * 255)}, ${Math.round(pigmentIndicatorColor[1] * 255)}, ${Math.round(pigmentIndicatorColor[2] * 255)})`,
                        }
                      : undefined
                  }
                />
                <span>
                  {brush.pasteMode ? 'Paste mode' : 'Pigment active'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

