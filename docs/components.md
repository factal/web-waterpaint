# Components Overview

The components directory is divided into canvas primitives, DOM layout, cross-tree helpers, and watercolor specific React components. This document explains what each module does, how it interacts with the watercolor simulation, and the props you can use when composing them.

## Canvas Layer

### Scene (components/canvas/Scene.tsx)
- Wraps React Three Fiber's Canvas and exposes it through the tunnel so that other components can render into a persistent WebGL context.
- Applies THREE.AgXToneMapping when the canvas is created to improve the contrast of watercolor output.
- Accepts the same props as Canvas; anything you pass is forwarded and will persist across route transitions.

### View (components/canvas/View.tsx)
- Couples a DOM container with Drei's View so multiple WebGL panels can be managed inside a single canvas.
- Exposes a ref to the DOM element, making it easy to size or style from the outside while keeping the three scene in sync.
- Props:
  - children: React nodes rendered inside the Drei View.
  - orbit: enables OrbitControls when true.
  - color: background color passed to the shared lighting rig.
  - Standard HTMLDivElement attributes such as className or inline styles.

## DOM Layer

### Layout (components/dom/Layout.tsx)
- Provides the root scrollable surface for the app and mounts the GPU canvas once on the client.
- Forwards pointer events from the DOM tree into the canvas by passing its ref as eventSource and using the client event prefix.
- Intended to wrap the entire page; render your route content as children.

## Helpers

### r3f Tunnel (components/helpers/r3f.ts)
- Creates a tunnel via tunnel-rat, allowing the DOM subtree and the 3D scene graph to exchange content without prop drilling.
- Used internally by Scene (outlet) and Three (inlet); you rarely need to touch it directly unless you are extending the tunnel yourself.

### Three (components/helpers/Three.tsx)
- A tiny component that renders its children into the tunnel's inlet.
- Wrap any React Three Fiber elements with Three when you need them to live inside the shared Canvas that Scene controls.

## Watercolor Components

### WatercolorScene (components/watercolor/WatercolorScene.tsx)
- Owns the GPU simulation lifecycle and renders the current watercolor frame as a fullscreen quad.
- Props:
  - params: SimulationParams forwarded to WatercolorSimulation.step each frame.
  - size: square resolution (defaults to 512) for the internal render targets.
  - clearSignal: bump this number to reset the simulation state.
  - onReady(sim): callback fired when a WatercolorSimulation instance is created or disposed; receives null on teardown.
  - debugView: selects which internal render target is visualised (final composite, water height, velocity, pigment channels, paper maps, etc.).
- Exposes the simulation output through an orthographic camera, so you can nest it inside any View driven layout.

### WatercolorViewport (components/watercolor/WatercolorViewport.tsx)
- High level widget that connects pointer input to WatercolorScene, simulating brush strokes with reservoir depletion.
- Props:
  - params: same simulation parameters passed through to WatercolorScene.
  - brush: structure with radius, flow, type, and color describing the active brush.
  - size: internal render target size (defaults to 512).
  - clearSignal: increment to wipe the simulation.
  - className: optional CSS class applied to the container div.
  - onSimulationReady(sim): receives the WatercolorSimulation instance when it is ready for imperative control.
  - debugView: forwards the selected debug channel down to WatercolorScene for visual inspection.
- Attaches pointer listeners directly to the DOM container to track drawing state, convert pointer coordinates to UV space, and schedule splat calls as the cursor moves.
- Manages a per stroke reservoir so water and pigment naturally deplete and alter the stroke radius and flow over time.
