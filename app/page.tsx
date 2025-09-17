'use client'

import { useMemo, useState } from 'react'
import { Leva, button, useControls } from 'leva'
import WatercolorViewport from '@/components/watercolor/WatercolorViewport'
import type { BrushType, SimulationParams } from '@/lib/watercolor/WatercolorSimulation'

type Tool = 'water' | 'pigment0' | 'pigment1' | 'pigment2'

const SIM_SIZE = 512

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
  return tool === 'water' ? 'water' : 'pigment'
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
      },
    },
    radius: { label: 'Radius', value: 18, min: 2, max: 60, step: 1 },
    flow: { label: 'Flow', value: 0.45, min: 0, max: 1, step: 0.01 },
  })

  const dryingControls = useControls('Drying & Deposits', {
    evap: { label: 'Evaporation', value: 0.02, min: 0, max: 1, step: 0.001 },
    absorb: { label: 'Absorption', value: 0.25, min: 0, max: 2, step: 0.001 },
    edge: { label: 'Edge Bias', value: 2.0, min: 0, max: 8, step: 0.01 },
    backrunStrength: { label: 'Backrun Strength', value: 0.45, min: 0, max: 2, step: 0.01 },
  })

  const dynamicsControls = useControls('Flow Dynamics', {
    grav: { label: 'Gravity', value: 0.9, min: 0, max: 2, step: 0.01 },
    visc: { label: 'Viscosity', value: 0.02, min: 0, max: 1, step: 0.001 },
    cfl: { label: 'CFL Safety', value: 0.7, min: 0.1, max: 2, step: 0.05 },
    maxSubsteps: { label: 'Max Substeps', value: 4, min: 1, max: 8, step: 1 },
  })

  const reservoirControls = useControls('Brush Reservoir', {
    waterCapacityWater: { label: 'Water Brush Capacity', value: 1.4, min: 0.1, max: 2.5, step: 0.05 },
    waterCapacityPigment: { label: 'Pigment Brush Water Cap', value: 0.8, min: 0.1, max: 2, step: 0.05 },
    pigmentCapacity: { label: 'Pigment Charge', value: 1.1, min: 0.1, max: 2, step: 0.05 },
    waterConsumption: { label: 'Water Consumption', value: 0.28, min: 0.01, max: 1, step: 0.01 },
    pigmentConsumption: { label: 'Pigment Consumption', value: 0.22, min: 0.01, max: 1, step: 0.01 },
    stampSpacing: { label: 'Stamp Spacing', value: 0.015, min: 0.001, max: 0.05, step: 0.001 },
  })

  const featureControls = useControls('Features', {
    stateAbsorption: { label: 'State Absorption', value: true },
    granulation: { label: 'Granulation', value: true },
  })

  useControls('Actions', {
    clear: button(() => setClearSignal((value) => value + 1)),
  })

  const tool = brushControls.tool as Tool
  const radius = brushControls.radius as number
  const flow = brushControls.flow as number
  const { evap, absorb, edge, backrunStrength } = dryingControls as { evap: number; absorb: number; edge: number; backrunStrength: number }
  const { grav, visc, cfl, maxSubsteps } = dynamicsControls as { grav: number; visc: number; cfl: number; maxSubsteps: number }
  const { stateAbsorption, granulation } = featureControls as { stateAbsorption: boolean; granulation: boolean }
  const { waterCapacityWater, waterCapacityPigment, pigmentCapacity, waterConsumption, pigmentConsumption, stampSpacing } = reservoirControls as {
    waterCapacityWater: number;
    waterCapacityPigment: number;
    pigmentCapacity: number;
    waterConsumption: number;
    pigmentConsumption: number;
    stampSpacing: number;
  }

  const pigmentIndex = tool === 'water' ? -1 : parseInt(tool.slice(-1), 10)

  const brush = useMemo(() => ({
    radius,
    flow,
    type: toolToBrushType(tool),
    color: pigmentIndex >= 0 ? PIGMENT_MASS[pigmentIndex] : ([0, 0, 0] as [number, number, number]),
  }), [radius, flow, tool, pigmentIndex])

  const params = useMemo<SimulationParams>(() => ({
    grav,
    visc,
    absorb,
    evap,
    edge,
    backrunStrength,
    stateAbsorption,
    granulation,
    cfl,
    maxSubsteps,
    reservoir: {
      waterCapacityWater,
      waterCapacityPigment,
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
    stateAbsorption,
    granulation,
    cfl,
    maxSubsteps,
    waterCapacityWater,
    waterCapacityPigment,
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
          />
          <div className='pointer-events-none absolute bottom-4 left-4 text-[10px] uppercase tracking-wide text-slate-400 sm:text-xs'>
            Resolution {SIM_SIZE}x{SIM_SIZE}
          </div>
          {brush.type === 'pigment' && pigmentIndex >= 0 && (
            <div className='pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-full border border-slate-500/60 bg-slate-900/80 px-3 py-1 text-xs text-slate-200 shadow-lg sm:text-sm'>
              <span
                className='inline-flex h-3 w-3 rounded-full border border-white/40 sm:h-4 sm:w-4'
                style={{
                  background: `rgb(${PIGMENT_SWATCH[pigmentIndex][0] * 255}, ${PIGMENT_SWATCH[pigmentIndex][1] * 255}, ${PIGMENT_SWATCH[pigmentIndex][2] * 255})`,
                }}
              />
              <span>Pigment active</span>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}







