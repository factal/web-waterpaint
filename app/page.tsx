'use client'

import { useEffect, useMemo, useState } from 'react'
import { Leva, button, useControls } from 'leva'
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
  type BrushType,
  type SimulationParams,
} from '@/lib/watercolor/WatercolorSimulation'

type Tool =
  | 'water'
  | 'pigment0'
  | 'pigment1'
  | 'pigment2'
  | 'spatter0'
  | 'spatter1'
  | 'spatter2'

const SIM_SIZE = 512

type BrushMaskId = 'round' | 'flat' | 'fan'

type BrushMaskAsset = {
  texture: THREE.DataTexture
  scale: [number, number]
  baseStrength: number
  pressureScale: number
  rotationJitter: number
}

const BRUSH_MASK_OPTIONS: Record<string, BrushMaskId> = {
  'Soft Round': 'round',
  'Flat Streak': 'flat',
  'Fan Mop': 'fan',
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

const PIGMENT_MASS: Array<[number, number, number]> = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const PIGMENT_SWATCH: Array<[number, number, number]> = [
  [0.05, 0.65, 0.95],
  [0.95, 0.25, 0.85],
  [0.98, 0.88, 0.2],
];


function toolToBrushType(tool: Tool): BrushType {
  if (tool === 'water') return 'water'
  if (tool.startsWith('spatter')) return 'spatter'
  return 'pigment'
}

export default function Home() {
  const [clearSignal, setClearSignal] = useState(0)

  const brushControls = useControls('Brush', {
    tool: {
      label: 'Tool',
      value: 'water' as Tool,
      options: {
        Water: 'water',
        'Pigment C': 'pigment0',
        'Pigment M': 'pigment1',
        'Pigment Y': 'pigment2',
        'Spatter C': 'spatter0',
        'Spatter M': 'spatter1',
        'Spatter Y': 'spatter2',
      },
    },
    radius: { label: 'Radius', value: 18, min: 2, max: 60, step: 1 },
    flow: { label: 'Flow', value: 0.45, min: 0, max: 1, step: 0.01 },
    mask: {
      label: 'Bristle Mask',
      value: 'round' as BrushMaskId,
      options: BRUSH_MASK_OPTIONS,
    },
    maskStrength: { label: 'Mask Strength', value: 0.75, min: 0, max: 1, step: 0.01 },
    streakDensity: { label: 'Streak Density', value: 0.55, min: 0, max: 1, step: 0.01 },
  })

  const mediumControls = useControls('Brush Medium', {
    binderCharge: {
      label: 'Binder Charge',
      value: DEFAULT_BINDER_PARAMS.injection,
      min: 0,
      max: 2,
      step: 0.01,
    },
    waterLoad: {
      label: 'Water Load',
      value: 0.8,
      min: 0.1,
      max: 2,
      step: 0.01,
    },
  })
  const pasteControls = useControls('Paste Strokes', {
    pasteMode: { label: 'Enable Paste Mode', value: false },
    pasteBinderBoost: { label: 'Binder Boost', value: 4, min: 1, max: 12, step: 0.1 },
    pastePigmentBoost: { label: 'Pigment Boost', value: 2.5, min: 1, max: 10, step: 0.1 },
  })
  const spatterControls = useControls('Spatter', {
    dropletCount: { label: 'Droplets', value: 18, min: 1, max: 64, step: 1 },
    sprayRadius: { label: 'Spray Radius', value: 1.2, min: 0.1, max: 3, step: 0.05 },
    spreadAngle: { label: 'Spread Angle', value: 220, min: 15, max: 360, step: 1 },
    sizeMin: { label: 'Min Drop Size', value: 0.05, min: 0.01, max: 0.6, step: 0.01 },
    sizeMax: { label: 'Max Drop Size', value: 0.22, min: 0.02, max: 0.8, step: 0.01 },
    sizeBias: { label: 'Size Bias', value: 0.65, min: 0, max: 1, step: 0.01 },
    radialBias: { label: 'Radial Bias', value: 0.55, min: 0, max: 1, step: 0.01 },
    flowJitter: { label: 'Flow Jitter', value: 0.4, min: 0, max: 1, step: 0.01 },
  })
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

  const reservoirControls = useControls('Brush Reservoir', {
    waterCapacityWater: { label: 'Water Brush Capacity', value: 14, min: 1, max: 25, step: 0.05 },
    pigmentCapacity: { label: 'Pigment Charge', value: 11, min: 1, max: 20, step: 0.05 },
    waterConsumption: { label: 'Water Consumption', value: 0.28, min: 0.01, max: 1, step: 0.01 },
    pigmentConsumption: { label: 'Pigment Consumption', value: 0.22, min: 0.01, max: 1, step: 0.01 },
    stampSpacing: { label: 'Stamp Spacing', value: 0.015, min: 0.001, max: 0.05, step: 0.001 },
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

  const tool = brushControls.tool as Tool
  const radius = brushControls.radius as number
  const flow = brushControls.flow as number
  const maskId = brushControls.mask as BrushMaskId
  const maskStrength = brushControls.maskStrength as number
  const streakDensity = brushControls.streakDensity as number
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
  const { binderCharge, waterLoad } = mediumControls as { binderCharge: number; waterLoad: number }
  const { pasteMode, pasteBinderBoost, pastePigmentBoost } = pasteControls as {
    pasteMode: boolean
    pasteBinderBoost: number
    pastePigmentBoost: number
  }
  const {
    dropletCount: spatterDropletCount,
    sprayRadius: spatterSprayRadius,
    spreadAngle: spatterSpreadAngle,
    sizeMin: spatterSizeMin,
    sizeMax: spatterSizeMax,
    sizeBias: spatterSizeBias,
    radialBias: spatterRadialBias,
    flowJitter: spatterFlowJitter,
  } = spatterControls as {
    dropletCount: number
    sprayRadius: number
    spreadAngle: number
    sizeMin: number
    sizeMax: number
    sizeBias: number
    radialBias: number
    flowJitter: number
  }
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
  const { waterCapacityWater, pigmentCapacity, waterConsumption, pigmentConsumption, stampSpacing } = reservoirControls as {
    waterCapacityWater: number;
    pigmentCapacity: number;
    waterConsumption: number;
    pigmentConsumption: number;
    stampSpacing: number;
  }
  const pigmentIndex = tool === 'water' ? -1 : parseInt(tool.slice(-1), 10)

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
      const color =
        pigmentIndex >= 0
          ? (PIGMENT_MASS[pigmentIndex] as [number, number, number])
          : ([0, 0, 0] as [number, number, number])
      const minSize = Math.max(0.01, Math.min(spatterSizeMin, spatterSizeMax))
      const maxSize = Math.max(minSize + 1e-4, Math.max(spatterSizeMin, spatterSizeMax))
      const spread = Math.min(Math.max(spatterSpreadAngle, 0), 360)
      const spray = Math.max(spatterSprayRadius, 0)
      const sizeBias = Math.min(Math.max(spatterSizeBias, 0), 1)
      const radialBias = Math.min(Math.max(spatterRadialBias, 0), 1)
      const flowJitter = Math.min(Math.max(spatterFlowJitter, 0), 1)
      const dropletCount = Math.max(1, Math.round(spatterDropletCount))
      const maskStrengthValue =
        brushType === 'spatter'
          ? 0
          : Math.min(1, maskStrength * activeMask.baseStrength)
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
        spatter:
          brushType === 'spatter'
            ? {
                dropletCount,
                sprayRadius: spray,
                spreadAngle: spread,
                minSize,
                maxSize,
                sizeBias,
                radialBias,
                flowJitter,
              }
            : undefined,
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
      spatterDropletCount,
      spatterSprayRadius,
      spatterSpreadAngle,
      spatterSizeMin,
      spatterSizeMax,
      spatterSizeBias,
      spatterRadialBias,
      spatterFlowJitter,
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
      stampSpacing,
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
    stampSpacing,
  ])

  return (
    <main className='relative flex min-h-screen flex-col items-center justify-center bg-[#111111] text-slate-200'>
      <Leva collapsed titleBar={{ title: 'Watercolor Controls', drag: true }} />

      <div className='relative flex w-full max-w-4xl flex-col items-center gap-6 px-4 pb-12 pt-28 sm:px-8 sm:pt-32'>
        <div className='relative w-full max-w-[min(720px,90vw)]'>
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
                style={{
                  background: `rgb(${PIGMENT_SWATCH[pigmentIndex][0] * 255}, ${PIGMENT_SWATCH[pigmentIndex][1] * 255}, ${PIGMENT_SWATCH[pigmentIndex][2] * 255})`,
                }}
              />
              <span>
                {brush.type === 'spatter'
                  ? 'Spatter mode'
                  : brush.pasteMode
                    ? 'Paste mode'
                    : 'Pigment active'}
              </span>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

