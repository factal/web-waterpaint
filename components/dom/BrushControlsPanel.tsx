'use client'

import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { PigmentChannels } from '@/lib/watercolor/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { ChromePicker } from 'react-color'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/card'
import { ScrollArea } from '../ui/scroll-area'

export type BrushTool =
  | 'water'
  | 'pigment0'
  | 'pigment1'
  | 'pigment2'
  | 'pigment3'
  | 'pigment4'
  | 'pigment5'
  | 'pigment6'

export type BrushMaskId = 'round' | 'flat' | 'fan'

export type BrushSettings = {
  tool: BrushTool
  radius: number
  flow: number
  mask: BrushMaskId
  maskStrength: number
  streakDensity: number
}

export type BrushMediumSettings = {
  binderCharge: number
  waterLoad: number
}

export type BrushPasteSettings = {
  pasteMode: boolean
  pasteBinderBoost: number
  pastePigmentBoost: number
}

export type BrushReservoirSettings = {
  waterCapacityWater: number
  pigmentCapacity: number
  waterConsumption: number
  pigmentConsumption: number
}

export type PigmentPickerSlot = {
  channels: PigmentChannels
  display: [number, number, number]
}

const PIGMENT_NAMES = [
  'Primary Red',
  'Primary Green',
  'Primary Blue',
  'Paper White',
  'Primary Cyan',
  'Primary Magenta',
  'Primary Yellow',
]
const PIGMENT_CHANNEL_LABELS = ['R', 'G', 'B', 'W', 'C', 'M', 'Y']

type BrushControlsPanelProps = {
  className?: string
  brush: BrushSettings
  medium: BrushMediumSettings
  paste: BrushPasteSettings
  reservoir: BrushReservoirSettings
  pigments: PigmentPickerSlot[]
  onBrushChange: (value: Partial<BrushSettings>) => void
  onMediumChange: (value: Partial<BrushMediumSettings>) => void
  onPasteChange: (value: Partial<BrushPasteSettings>) => void
  onReservoirChange: (value: Partial<BrushReservoirSettings>) => void
  onPigmentColorChange: (index: number, color: [number, number, number]) => void
}

type SliderControlProps = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
  disabled?: boolean
  transformValue?: (value: number) => number
}

const TOOL_OPTIONS: Array<{ label: string; value: BrushTool; pigmentIndex?: number }> = [
  { label: 'Water', value: 'water' },
  { label: 'Pigment R', value: 'pigment0', pigmentIndex: 0 },
  { label: 'Pigment G', value: 'pigment1', pigmentIndex: 1 },
  { label: 'Pigment B', value: 'pigment2', pigmentIndex: 2 },
  { label: 'Pigment W', value: 'pigment3', pigmentIndex: 3 },
  { label: 'Pigment C', value: 'pigment4', pigmentIndex: 4 },
  { label: 'Pigment M', value: 'pigment5', pigmentIndex: 5 },
  { label: 'Pigment Y', value: 'pigment6', pigmentIndex: 6 },
]

const toRgb255 = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255)

const formatPercentage = (value: number) => `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`

const MASK_OPTIONS: Array<{ label: string; value: BrushMaskId }> = [
  { label: 'Soft Round', value: 'round' },
  { label: 'Flat Streak', value: 'flat' },
  { label: 'Fan Mop', value: 'fan' },
]

const formatSliderValue = (value: number, step?: number) => {
  if (!Number.isFinite(value)) return '0'
  if (!step) return value.toFixed(2)
  if (step >= 1) return value.toFixed(0)
  const decimals = step.toString().split('.')[1]?.length ?? 0
  return value.toFixed(Math.min(decimals, 4))
}

const SliderControl = ({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  formatValue,
  disabled,
  transformValue,
}: SliderControlProps) => {
  const displayValue = formatValue ? formatValue(value) : formatSliderValue(value, step)
  const clamped = Math.min(Math.max(value, min), max)

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between text-sm'>
        <span className={cn('font-medium text-slate-200', disabled && 'text-slate-500')}>{label}</span>
        <span className={cn('tabular-nums text-xs text-slate-400', disabled && 'text-slate-600')}>{displayValue}</span>
      </div>
      <Slider
        aria-label={label}
        value={[clamped]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(values) => {
          if (disabled) return
          const nextValue = values[0]
          if (typeof nextValue !== 'number') return
          const limited = Math.min(Math.max(nextValue, min), max)
          const finalValue = transformValue ? transformValue(limited) : limited
          onChange(finalValue)
        }}
      />
    </div>
  )
}


type BrushMaskPreviewProps = {
  mask: BrushMaskId
  streakDensity: number
  maskStrength: number
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)

const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t)

const fractValue = (value: number) => value - Math.floor(value)

const getMaskPreviewConfig = (mask: BrushMaskId, density: number) => {
  const clamped = clamp01(density)
  if (mask === 'round') {
    return {
      density: clamped * 0.5 + 0.25,
      baseStrength: 0.55,
    }
  }
  if (mask === 'flat') {
    return {
      density: clamped,
      baseStrength: 1,
    }
  }
  return {
    density: clamped * 0.75 + 0.1,
    baseStrength: 0.85,
  }
}

const BrushMaskPreview = ({ mask, streakDensity, maskStrength }: BrushMaskPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const preview = useMemo(() => {
    const size = 128
    const { density: adjustedDensity, baseStrength } = getMaskPreviewConfig(mask, streakDensity)
    const stripeFreq = lerp(6, 32, adjustedDensity)
    const swirl = lerp(0.25, 1.1, adjustedDensity)
    const data = new Uint8ClampedArray(size * size * 4)

    const bump = (v: number) => {
      return Math.abs(v) < 1 ? Math.exp(1 - 1 / (1 - Math.pow(Math.abs(v), 5))) : 0
    }

    for (let y = 0; y < size; y += 1) {
      const v = (y / (size - 1)) * 2 - 1
      for (let x = 0; x < size; x += 1) {
        const u = (x / (size - 1)) * 2 - 1
        const idx = (y * size + x) * 4
        const radiusSq = u * u + v * v
        const radius = Math.sqrt(radiusSq)
        const gaussian = bump(radius)

        let pattern = 1
        if (mask === 'round') {
          const rings = Math.exp(-0.9 * Math.pow(Math.max(radiusSq - 0.25, 0), 1.4))
          const wobble = 0.9 + 0.1 * Math.cos((u + v) * (4 + adjustedDensity * 6))
          pattern = rings * wobble
        } else if (mask === 'flat') {
          const taper = Math.exp(-1.1 * Math.pow(Math.abs(v) * 1.2, 1.8))
          const stripes = 0.55 + 0.45 * Math.cos(u * stripeFreq + Math.sin(v * 5) * 0.6)
          pattern = taper * stripes
        } else {
          const angle = Math.atan2(v, u)
          const spokes = 0.6 + 0.4 * Math.cos(angle * (stripeFreq * 0.45) + v * swirl)
          const fan = Math.exp(-0.6 * Math.pow(Math.max(radiusSq - 0.1, 0), 1.5))
          pattern = spokes * fan
        }

        const noiseSeed = Math.sin((x + 11.1) * 12.9898 + (y + 78.233) * 0.875) * 43758.5453
        const noise = 0.88 + 0.12 * fractValue(noiseSeed)
        const mixAmount = mask === 'round' ? 0.35 : 0.85
        const mixedPattern = 1 + (pattern - 1) * mixAmount
        const maskValue = clamp01(gaussian * mixedPattern * noise)
        const shade = Math.round(maskValue * 255)

        data[idx] = shade
        data[idx + 1] = shade
        data[idx + 2] = shade
        data[idx + 3] = 255
      }
    }

    const effectiveStrength = Math.min(1, maskStrength * baseStrength)

    return {
      data,
      size,
      effectiveStrength,
      baseStrength,
      adjustedDensity,
    }
  }, [mask, streakDensity, maskStrength])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const { size, data } = preview
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size
      canvas.height = size
    }

    const imageData = new ImageData(data, size, size)
    context.putImageData(imageData, 0, 0)
  }, [preview])

  const strengthPercent = Math.round(preview.effectiveStrength * 100)
  const basePercent = Math.round(preview.baseStrength * 100)
  const detailPercent = Math.round(preview.adjustedDensity * 100)

  return (
    <Card className=''>
      <CardHeader className='flex items-center justify-between'>
        <span className='text-[10px] font-semibold uppercase tracking-wide text-slate-500'>Mask Preview</span>
        <span className='text-[10px] font-semibold text-slate-400'>{strengthPercent}% effective</span>
      </CardHeader>
      <CardContent className='overflow-hidden'>
        <canvas
          ref={canvasRef}
          className='mx-auto h-32 w-32'
          role='img'
          aria-label='Brush mask preview'
        />
        {/* <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.2),_transparent_65%)] opacity-70 mix-blend-screen' aria-hidden='true' /> */}
      </CardContent>
      <CardFooter className='flex items-center justify-between text-[10px] text-slate-500'>
        <span>Base {basePercent}%</span>
        <span>Detail {detailPercent}%</span>
      </CardFooter>
    </Card>
  )
}


const BrushControlsPanel = ({
  className,
  brush,
  medium,
  paste,
  reservoir,
  pigments,
  onBrushChange,
  onMediumChange,
  onPasteChange,
  onReservoirChange,
  onPigmentColorChange,
}: BrushControlsPanelProps) => {
  const isPigmentTool = brush.tool.startsWith('pigment')

  return (
    <Card className={cn('max-w-sm mx-auto max-h-screen', className)}>
      <CardHeader>
        <CardTitle>Brush Controls</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue='brush'>
          <TabsList>
            <TabsTrigger value='brush'>
              Brush
            </TabsTrigger>
            <TabsTrigger value='pigments'>
              Pigments
            </TabsTrigger>
            <TabsTrigger value='medium'>
              Medium
            </TabsTrigger>
            <TabsTrigger value='paste'>
              Paste
            </TabsTrigger>
            <TabsTrigger value='reservoir'>
              Reservoir
            </TabsTrigger>
          </TabsList>

          <TabsContent value='brush' className='pt-4'>
            <ScrollArea className='h-[500px]'>
              <div className='space-y-6'>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <span className='text-xs font-semibold uppercase tracking-wider text-slate-400'>Tool</span>
                  </div>
                  <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                    {TOOL_OPTIONS.map((option) => {
                      const pigment =
                        typeof option.pigmentIndex === 'number' ? pigments[option.pigmentIndex] ?? null : null
                      const swatchStyle =
                        pigment != null
                          ? {
                              backgroundColor: `rgb(${toRgb255(pigment.display[0])}, ${toRgb255(pigment.display[1])}, ${toRgb255(pigment.display[2])})`,
                            }
                          : undefined

                      return (
                        <Toggle
                          key={option.value}
                          variant='outline'
                          size='sm'
                          pressed={brush.tool === option.value}
                          onPressedChange={(pressed) => {
                            if (pressed) onBrushChange({ tool: option.value })
                          }}
                          aria-pressed={brush.tool === option.value}
                        >
                          {pigment ? (
                            <span className='flex items-center gap-2'>
                              <span className='h-2.5 w-2.5 rounded-full border border-white/30' style={swatchStyle} />
                              <span>{option.label}</span>
                            </span>
                          ) : (
                            option.label
                          )}
                        </Toggle>
                      )
                    })}
                  </div>
                </div >

                <SliderControl
                  label='Radius'
                  value={brush.radius}
                  min={2}
                  max={60}
                  step={1}
                  formatValue={(value) => `${value.toFixed(0)} px`}
                  transformValue={(value) => Math.round(value)}
                  onChange={(value) => onBrushChange({ radius: value })}
                />

                <SliderControl
                  label='Flow'
                  value={brush.flow}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) => onBrushChange({ flow: value })}
                />

                <div className='space-y-3'>
                  <div className='flex items-center justify-between'>
                    <span className='text-sm font-medium text-slate-200'>Bristle Mask</span>
                  </div>
                  <Select
                    value={brush.mask}
                    onValueChange={(value) => onBrushChange({ mask: value as BrushMaskId })}
                  >
                    <SelectTrigger className='w-full justify-between'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MASK_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <BrushMaskPreview
                    mask={brush.mask}
                    streakDensity={brush.streakDensity}
                    maskStrength={brush.maskStrength}
                  />
                </div>

                <SliderControl
                  label='Mask Strength'
                  value={brush.maskStrength}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) => onBrushChange({ maskStrength: value })}
                />

                <SliderControl
                  label='Streak Density'
                  value={brush.streakDensity}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) => onBrushChange({ streakDensity: value })}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value='pigments' className='pt-4'>
          
            <ScrollArea className='h-[500px]'>
              <div className='space-y-6'>
                {pigments.map((slot, index) => {
                  const label = PIGMENT_NAMES[index] ?? `Pigment ${index + 1}`
                  const swatchStyle = {
                    backgroundColor: `rgb(${toRgb255(slot.display[0])}, ${toRgb255(slot.display[1])}, ${toRgb255(slot.display[2])})`,
                  }

                  return (
                    <Card
                      key={`pigment-${index}`}
                    >
                      <CardHeader className='flex items-center justify-between gap-3'>
                          <CardTitle className='text-sm font-semibold text-slate-100'>{label}</CardTitle>
                        <span className='inline-flex h-4 w-4 rounded-full border border-white/40' style={swatchStyle} />
                      </CardHeader>

                      <CardContent>
                        <ChromePicker
                          disableAlpha
                          color={{
                            r: toRgb255(slot.display[0]),
                            g: toRgb255(slot.display[1]),
                            b: toRgb255(slot.display[2]),
                          }}
                          onChange={(value) => {
                            const { r, g, b } = value.rgb
                            onPigmentColorChange(index, [r / 255, g / 255, b / 255])
                          }}
                          className='mx-auto text-white'
                          styles={{
                            default: {
                              picker: {
                                background: 'transparent',
                                boxShadow: 'none',
                              },
                            },
                          }}
                        />
                      </CardContent>

                      <CardFooter className='grid grid-cols-3 gap-2 text-xs text-slate-400 sm:grid-cols-4 lg:grid-cols-7'>
                        {PIGMENT_CHANNEL_LABELS.map((channel, channelIndex) => (
                          <div
                            key={`${channel}-${index}`}
                            className='rounded-xl border border-slate-700/40 bg-slate-900/60 px-2 py-2 text-center'
                          >
                            <span className='block text-[10px] font-semibold uppercase tracking-wide text-slate-500'>
                              {channel}
                            </span>
                            <span className='block text-sm font-semibold text-slate-200'>
                              {formatPercentage(slot.channels[channelIndex] ?? 0)}
                            </span>
                          </div>
                        ))}
                      </CardFooter>
                    </Card>
                  )
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value='medium' className='space-y-6 pt-4'>
            <SliderControl
              label='Binder Charge'
              value={medium.binderCharge}
              min={0}
              max={2}
              step={0.01}
              onChange={(value) => onMediumChange({ binderCharge: value })}
            />
            <SliderControl
              label='Water Load'
              value={medium.waterLoad}
              min={0.1}
              max={2}
              step={0.01}
              onChange={(value) => onMediumChange({ waterLoad: value })}
            />
          </TabsContent>

          <TabsContent value='paste' className='space-y-6 pt-4'>
            <div className='flex items-start justify-between gap-3 rounded-2xl border border-slate-700/40 bg-slate-900/50 p-3'>
              <div className='space-y-1'>
                <p className='text-sm font-medium text-slate-200'>Paste Mode</p>
                <p className='text-xs text-slate-500'>Boost binder and pigment when using pigment brushes.</p>
                {!isPigmentTool && <p className='text-[10px] uppercase tracking-wide text-slate-600'>Activate a pigment tool to enable.</p>}
              </div>
              <Toggle
                variant='outline'
                pressed={paste.pasteMode && isPigmentTool}
                disabled={!isPigmentTool}
                onPressedChange={(pressed) => onPasteChange({ pasteMode: pressed })}
                aria-pressed={paste.pasteMode && isPigmentTool}
              >
                {paste.pasteMode && isPigmentTool ? 'On' : 'Off'}
              </Toggle>
            </div>

            <SliderControl
              label='Binder Boost'
              value={paste.pasteBinderBoost}
              min={1}
              max={12}
              step={0.1}
              onChange={(value) => onPasteChange({ pasteBinderBoost: value })}
            />
            <SliderControl
              label='Pigment Boost'
              value={paste.pastePigmentBoost}
              min={1}
              max={10}
              step={0.1}
              onChange={(value) => onPasteChange({ pastePigmentBoost: value })}
            />
          </TabsContent>

          <TabsContent value='reservoir' className='space-y-6 pt-4'>
            <SliderControl
              label='Water Capacity (Water Tool)'
              value={reservoir.waterCapacityWater}
              min={1}
              max={25}
              step={0.05}
              onChange={(value) => onReservoirChange({ waterCapacityWater: value })}
            />
            <SliderControl
              label='Pigment Capacity'
              value={reservoir.pigmentCapacity}
              min={1}
              max={20}
              step={0.05}
              onChange={(value) => onReservoirChange({ pigmentCapacity: value })}
            />
            <SliderControl
              label='Water Consumption'
              value={reservoir.waterConsumption}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(value) => onReservoirChange({ waterConsumption: value })}
            />
            <SliderControl
              label='Pigment Consumption'
              value={reservoir.pigmentConsumption}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(value) => onReservoirChange({ pigmentConsumption: value })}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

export default BrushControlsPanel
