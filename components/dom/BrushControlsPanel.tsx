'use client'

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

export type BrushTool =
  | 'water'
  | 'pigment0'
  | 'pigment1'
  | 'pigment2'
  | 'pigment3'
  | 'pigment4'
  | 'pigment5'
  | 'pigment6'
  | 'spatter0'
  | 'spatter1'
  | 'spatter2'
  | 'spatter3'
  | 'spatter4'
  | 'spatter5'
  | 'spatter6'

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

export type BrushSpatterSettings = {
  dropletCount: number
  sprayRadius: number
  spreadAngle: number
  sizeMin: number
  sizeMax: number
  sizeBias: number
  radialBias: number
  flowJitter: number
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
  spatter: BrushSpatterSettings
  reservoir: BrushReservoirSettings
  pigments: PigmentPickerSlot[]
  onBrushChange: (value: Partial<BrushSettings>) => void
  onMediumChange: (value: Partial<BrushMediumSettings>) => void
  onPasteChange: (value: Partial<BrushPasteSettings>) => void
  onSpatterChange: (value: Partial<BrushSpatterSettings>) => void
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
  { label: 'Spatter R', value: 'spatter0', pigmentIndex: 0 },
  { label: 'Spatter G', value: 'spatter1', pigmentIndex: 1 },
  { label: 'Spatter B', value: 'spatter2', pigmentIndex: 2 },
  { label: 'Spatter W', value: 'spatter3', pigmentIndex: 3 },
  { label: 'Spatter C', value: 'spatter4', pigmentIndex: 4 },
  { label: 'Spatter M', value: 'spatter5', pigmentIndex: 5 },
  { label: 'Spatter Y', value: 'spatter6', pigmentIndex: 6 },
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

const BrushControlsPanel = ({
  className,
  brush,
  medium,
  paste,
  spatter,
  reservoir,
  pigments,
  onBrushChange,
  onMediumChange,
  onPasteChange,
  onSpatterChange,
  onReservoirChange,
  onPigmentColorChange,
}: BrushControlsPanelProps) => {
  const isPigmentTool = brush.tool.startsWith('pigment')
  const isSpatterTool = brush.tool.startsWith('spatter')

  return (
    <div
      className={cn(
        'rounded-3xl border border-slate-700/40 bg-slate-900/60 p-4 text-slate-200 shadow-2xl backdrop-blur-sm sm:p-6',
        className,
      )}
    >
      <div className='space-y-1 pb-4'>
        <h2 className='text-lg font-semibold tracking-wide text-slate-100'>Brush Controls</h2>
        <p className='text-xs text-slate-400'>Tweak the active tool, medium mix, and reservoir balance.</p>
      </div>

      <Tabs defaultValue='brush' className='w-full'>
        <TabsList className='bg-slate-800/40 flex flex-wrap gap-2 rounded-2xl p-1'>
          <TabsTrigger value='brush' className='flex-none basis-[calc(50%-0.5rem)] sm:basis-auto sm:flex-1'>
            Brush
          </TabsTrigger>
          <TabsTrigger value='pigments' className='flex-none basis-[calc(50%-0.5rem)] sm:basis-auto sm:flex-1'>
            Pigments
          </TabsTrigger>
          <TabsTrigger value='medium' className='flex-none basis-[calc(50%-0.5rem)] sm:basis-auto sm:flex-1'>
            Medium
          </TabsTrigger>
          <TabsTrigger value='paste' className='flex-none basis-[calc(50%-0.5rem)] sm:basis-auto sm:flex-1'>
            Paste
          </TabsTrigger>
          <TabsTrigger value='spatter' className='flex-none basis-[calc(50%-0.5rem)] sm:basis-auto sm:flex-1'>
            Spatter
          </TabsTrigger>
          <TabsTrigger value='reservoir' className='flex-none basis-[calc(50%-0.5rem)] sm:basis-auto sm:flex-1'>
            Reservoir
          </TabsTrigger>
        </TabsList>

        <TabsContent value='brush' className='space-y-6 pt-4'>
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-slate-400'>Tool</span>
              <span className='text-[11px] text-slate-500'>Choose water, pigment, or spatter modes.</span>
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
          </div>

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

          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium text-slate-200'>Bristle Mask</span>
              {isSpatterTool && <span className='text-xs text-slate-500'>Masks inactive for spatter tools.</span>}
            </div>
            <Select
              value={brush.mask}
              disabled={isSpatterTool}
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
          </div>

          <SliderControl
            label='Mask Strength'
            value={brush.maskStrength}
            min={0}
            max={1}
            step={0.01}
            disabled={isSpatterTool}
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
        </TabsContent>

        <TabsContent value='pigments' className='space-y-6 pt-4'>
          <div className='space-y-4'>
            <p className='text-xs text-slate-400'>Select a target colour for each slot to remap the RGB, CMY, and white pigment blend. Channel values show the seven-primary decomposition of the chosen swatch.</p>
            {pigments.map((slot, index) => {
              const label = PIGMENT_NAMES[index] ?? `Pigment ${index + 1}`
              const swatchStyle = {
                backgroundColor: `rgb(${toRgb255(slot.display[0])}, ${toRgb255(slot.display[1])}, ${toRgb255(slot.display[2])})`,
              }

              return (
                <div
                  key={`pigment-${index}`}
                  className='space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4'
                >
                  <div className='flex items-center justify-between gap-3'>
                    <div className='space-y-1'>
                      <p className='text-sm font-semibold text-slate-100'>{label}</p>
                      <p className='text-xs text-slate-500'>RGBWCMY mix</p>
                    </div>
                    <span className='inline-flex h-4 w-4 rounded-full border border-white/40' style={swatchStyle} />
                  </div>

                  <div className='rounded-2xl border border-slate-700/40 bg-slate-950/60 p-3'>
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
                      styles={{
                        default: {
                          picker: {
                            background: 'transparent',
                            boxShadow: 'none',
                          },
                        },
                      }}
                    />
                  </div>

                  <div className='grid grid-cols-3 gap-2 text-xs text-slate-400 sm:grid-cols-4 lg:grid-cols-7'>
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
                  </div>
                </div>
              )
            })}
          </div>
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

        <TabsContent value='spatter' className='space-y-6 pt-4'>
          {!isSpatterTool && (
            <div className='rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200'>
              Select a spatter tool to enable these parameters.
            </div>
          )}

          <SliderControl
            label='Droplets'
            value={spatter.dropletCount}
            min={1}
            max={64}
            step={1}
            disabled={!isSpatterTool}
            transformValue={(value) => Math.round(value)}
            onChange={(value) => onSpatterChange({ dropletCount: value })}
          />
          <SliderControl
            label='Spray Radius'
            value={spatter.sprayRadius}
            min={0.1}
            max={3}
            step={0.05}
            disabled={!isSpatterTool}
            onChange={(value) => onSpatterChange({ sprayRadius: value })}
          />
          <SliderControl
            label='Spread Angle'
            value={spatter.spreadAngle}
            min={15}
            max={360}
            step={1}
            disabled={!isSpatterTool}
            formatValue={(value) => `${value.toFixed(0)}°`}
            transformValue={(value) => Math.round(value)}
            onChange={(value) => onSpatterChange({ spreadAngle: value })}
          />
          <SliderControl
            label='Min Drop Size'
            value={spatter.sizeMin}
            min={0.01}
            max={0.6}
            step={0.01}
            disabled={!isSpatterTool}
            onChange={(value) => onSpatterChange({ sizeMin: value })}
          />
          <SliderControl
            label='Max Drop Size'
            value={spatter.sizeMax}
            min={0.02}
            max={0.8}
            step={0.01}
            disabled={!isSpatterTool}
            onChange={(value) => onSpatterChange({ sizeMax: value })}
          />
          <SliderControl
            label='Size Bias'
            value={spatter.sizeBias}
            min={0}
            max={1}
            step={0.01}
            disabled={!isSpatterTool}
            onChange={(value) => onSpatterChange({ sizeBias: value })}
          />
          <SliderControl
            label='Radial Bias'
            value={spatter.radialBias}
            min={0}
            max={1}
            step={0.01}
            disabled={!isSpatterTool}
            onChange={(value) => onSpatterChange({ radialBias: value })}
          />
          <SliderControl
            label='Flow Jitter'
            value={spatter.flowJitter}
            min={0}
            max={1}
            step={0.01}
            disabled={!isSpatterTool}
            onChange={(value) => onSpatterChange({ flowJitter: value })}
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
    </div>
  )
}

export default BrushControlsPanel
