export type DebugView =
  | 'composite'
  | 'waterHeight'
  | 'velocity'
  | 'dissolvedPigment'
  | 'depositedPigment'
  | 'wetness'
  | 'binder'
  | 'granulation'
  | 'paperHeight'
  | 'paperSizing'
  | 'paperFibers'

export const DEBUG_VIEW_LABELS: Record<DebugView, string> = {
  composite: 'Final Composite',
  waterHeight: 'Water Height',
  velocity: 'Fluid Velocity',
  dissolvedPigment: 'Dissolved Pigment',
  depositedPigment: 'Deposited Pigment',
  wetness: 'Paper Wetness',
  binder: 'Binder Density',
  granulation: 'Granulation Reservoir',
  paperHeight: 'Paper Height Map',
  paperSizing: 'Sizing Variation',
  paperFibers: 'Fiber Field',
}

export const DEBUG_VIEW_OPTIONS = Object.fromEntries(
  Object.entries(DEBUG_VIEW_LABELS).map(([value, label]) => [label, value as DebugView]),
) as Record<string, DebugView>
