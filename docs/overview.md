# Watercolor Simulation Overview

The watercolor system couples a shallow-water solver with pigment transport, paper diffusion, and optical compositing. The GPU pipeline is orchestrated from `lib/watercolor/WatercolorSimulation.ts`, while supporting modules provide shader sources, material factories, render-target utilities, and shared constants.

## Simulation Targets

| Target | Layout | Purpose |
| ------ | ------ | ------- |
| `H` | ping-pong RGBA16F | Water height (R). |
| `UV` | ping-pong RGBA16F | Surface velocity (RG). |
| `C` | ping-pong RGBA16F | Dissolved pigment carried by the flow (RGB). |
| `B` | ping-pong RGBA16F | Viscoelastic binder concentration (R). |
| `DEP` | ping-pong RGBA16F | Pigment deposited on the paper (RGB). |
| `W` | ping-pong RGBA16F | Paper wetness / retained moisture (R). |
| `S` | ping-pong RGBA16F | Settled pigment reservoir used for granulation (RGB). |
| `KM` | single RGBA16F | Kubelka–Munk composite colour rendered to screen. |

In addition to the dynamic framebuffers, the simulation owns a static single-channel `paperHeight` texture. It is generated at
startup from fractal noise seeded alongside the fibre field so that drybrush masking and fibre diffusion share the same
micro-structure. Because it is immutable, the height map is stored as a `DataTexture` and bound as a read-only sampler to the
passes that need it.

All simulation textures use half floats so they remain filterable on WebGL2.

## Frame Pipeline

1. **Brush splat** – Water, binder, and optional pigment are injected using Gaussian falloffs. Radial velocity impulses emulate brush agitation. When the active brush is in a drybrush regime, splat shaders gate injection by sampling `paperHeight` and applying a smooth dry threshold driven by the brush’s wetness so that only the highest paper ridges receive paint.
2. **Binder evolution** – The viscoelastic binder field is advected with the flow, diffused, and damped. Binder gradients feed the `binderForces` pass, which applies elastic spring forces and viscosity-dependent damping to the velocity field.
3. **Pressure projection** – Stam (1999) projection solves a Poisson equation to enforce incompressibility before the next transport step.
4. **Surface tension relaxation** – The `SURFACE_TENSION_FRAGMENT` curvature pass analyses `H` with a Laplacian/neighbor mask, suppresses cells whose speed exceeds `uVelocityLimit`, and tugs slender filaments toward their centreline. When the `uSnapStrength` gate fires, sub-threshold strands can snap to prevent numerical cobwebs.
5. **Fluid transport** – Semi-Lagrangian advection updates velocity (with slope-driven gravity), water height (including binder buoyancy), and dissolved pigment.
6. **Pigment diffusion** – A dedicated Fickian diffusion pass integrates `∂C/∂t = D∇²C`, ensuring pigment blurs even in stagnant water. The coefficient is exposed through the simulation constants.
7. **Absorption, evaporation, and granulation** – The absorb suite reads the current state and returns updated `H`, `C`, `DEP`, `W`, and `S`. Lucas–Washburn dynamics drive absorption using `A = A₀·(1 - w)^{β}` with `β = 0.5` and a temporal decay term `1 / √(t + t₀)`. Edge gradients add blooms, pigment settling feeds the granulation buffer, and paper-height-dependent weighting biases deposition toward microscopic valleys to reproduce fine grain.
8. **Paper diffusion** – Moisture diffuses anisotropically along a procedural fibre field. The revised `PAPER_DIFFUSION_FRAGMENT` detects wet fronts, injects fibre-aligned high-frequency noise, and occasionally culls isolated droplets so edges stay lively while drier paper receives a portion of the absorbed water.
9. **Kubelka–Munk composite** – Deposited pigment is converted into optical coefficients and shaded against the paper colour with a finite-thickness KM approximation.

Between the splat and transport phases, the simulation optionally performs a **rewetting** micro-pass. Whenever a new splat adds
water on top of dry deposits, a configurable rewet factor transfers a fraction of `DEP` back into the dissolved pigment buffer so
that layered washes can lift or soften previous strokes.

## Viscoelastic Binder Field

The binder state (`B`) models the elastic, viscous behaviour of heavy paint media. Each substep performs:

- **Advection & diffusion:** Binder is transported with the velocity field and diffused to avoid numerical clumping.
- **Decay:** A configurable decay term lets binder relax over time.
- **Elastic feedback:** Gradients of the binder field are converted into spring forces that pull the velocity back toward prior strokes, imitating stringy, paste-like behaviour.
- **Damping:** Binder concentration modulates velocity damping, yielding slower, heavier motion in pigment-rich regions.

Binder parameters (injection, diffusion, decay, elasticity, viscosity, buoyancy) are exposed through `SimulationParams.binder` and default to the values listed in `constants.ts`.

## Surface Tension Relaxation

Immediately after projection `WatercolorSimulation.step` calls `applySurfaceTension`, swapping the `H` ping-pong target and rendering the dedicated `SURFACE_TENSION_FRAGMENT`. The shader samples `H`, `W`, and `UV`, builds a Laplacian of the local height field, and multiplies it by a neighbour occupancy mask so that only thin, weakly supported filaments are affected. Wetting and velocity gates (`wetGate`, `velocityGate`) ensure dry patches or cells moving faster than `uVelocityLimit` remain untouched. The remaining strands receive an inward pull proportional to `uStrength × curvature × wetGate × uDt`, gently retracting the protrusions before advection.

After the contraction pass computes a tentative height, the shader evaluates a second isolation mask. Segments thinner than `uBreakThreshold` can be blended toward zero using `uSnapStrength`, letting very fine filaments snap apart instead of lingering as floating-point noise.

Artist-facing controls map to `SimulationParams.surfaceTension`:

- `enabled` toggles the pass entirely for performance or stylistic reasons.
- `strength` scales the relaxation impulse applied each substep.
- `threshold` defines how much neighbouring support a region must have before it is considered part of a stable pool.
- `breakThreshold` sets the water height below which filaments can disappear.
- `snapStrength` mixes between gentle smoothing and hard snapping of the isolated strands.
- `velocityLimit` gates the effect to slow-moving water so energetic splashes are left untouched.

Defaults for the block live in `DEFAULT_SURFACE_TENSION_PARAMS`.

## Capillary Fringe Feathering

Paper moisture now carries an explicit fringe model layered on top of the base diffusion. The updated `PAPER_DIFFUSION_FRAGMENT` samples the fibre texture to build a tangent frame, measures wetness gradients, and treats steep transitions as active wet fronts. A fibre-aligned noise field perturbs the parallel diffusion coefficient while damping the perpendicular component, allowing the striations in the paper to steer feathered blooms. The same directional noise drives a stochastic culling pass that occasionally zeroes out thin, isolated cells so drying pools break into ragged filaments instead of uniform bands. The result is a capillary fringe that clings to the fibre direction and naturally dissolves as the sheet dries.

Uniforms `uFringeStrength`, `uFringeThreshold`, and `uFringeNoiseScale` control the behaviour and are populated from `SimulationParams.capillaryFringe`. Default values live in `DEFAULT_FRINGE_PARAMS`, keeping the effect active but gentle out of the box.

Artist-facing controls map to `SimulationParams.capillaryFringe`:

- `enabled` toggles the perturbation stage for cost-sensitive scenes.
- `strength` scales the fibre-aligned modulation applied to the base diffusion coefficients.
- `threshold` defines how sharp a wetness gradient must be before the fringe masks engage.
- `noiseScale` selects the frequency of the directional noise that carves out the feathery edge pattern.

## Pigment Diffusion

Watercolor pigments bleed even without bulk flow. The `diffusePigment` pass evaluates a four-neighbour Laplacian on the dissolved pigment buffer and integrates it with adjustable diffusion coefficients. Diffusion is now vector-valued: `uDiffusionRGB` scales the Laplacian per colour channel so heavier pigment components can spread more slowly than lighter ones. The pass runs every substep immediately after advection so the absorbed pigment sees the latest blurred concentrations. Defaults keep all components equal, but pigment presets can supply custom coefficients via `SimulationParams`.

## Pigment Settling & Separation

Component-wise settling complements the diffusion changes. The absorption shader exposes `uSettleRGB`, multiplying the pigment
reservoir per channel before transferring it into the `S` and `DEP` buffers. By tuning these vectors, a single RGB pigment can
approximate multi-species behaviour: channels with higher settling sink quickly and contribute more to granulation, while lighter
channels remain in solution and continue to diffuse. Pigment definitions may supply preset vectors for common watercolour paints,
and the UI exposes overrides for advanced users.

## Lucas–Washburn Absorption

Absorption now follows the Lucas–Washburn law. The absorb shader applies:

- **Humidity power law:** `humidityFactor = (1 - w)^{β}` with `β = 0.5` accentuates rapid uptake on dry paper and softens as the sheet saturates.
- **Temporal decay:** `A₀` is multiplied by `1 / √(t + t₀)` so absorption slows naturally as the wetting front propagates.
- **Flux floor:** A configurable minimum flux prevents the system from stalling numerically once the film becomes extremely thin.

Evaporation retains its humidity coupling, and granulation/backrun logic now runs against the diffusion-updated pigment field, producing softer, more organic blooms.

## Granulation Reservoir (`S`)

Settled pigment accumulates into the `S` buffer before it bonds to the paper. Deposition draws proportionally from both dissolved (`C`) and settled (`S`) pigment, letting heavy particles migrate toward ridges and edges, reproducing the characteristic grain of traditional watercolour washes. Paper texture bias multiplies the deposition and settling terms, deepening valleys and creating fine mottling across large washes.

## Paper Microstructure & Drybrush

`paperHeight` represents sub-millimetre paper relief. The splat shaders sample it alongside the brush falloff and compare it to a
dry threshold derived from brush wetness or an explicit “dryness” slider. A `smoothstep` range keeps the transition soft so that
even dry brushes can occasionally catch lower fibres. The result is the familiar skip-and-grain texture of traditional drybrush
strokes. Because the height map aligns with the fibre diffusion orientation, the grain direction matches subsequent moisture
transport.

## Paper-Driven Granulation

The absorb shader mixes `paperHeight` into its deposition and settling coefficients through a strength uniform named
`uPaperTextureStrength`. With the strength at zero, the system behaves exactly as before. As the value increases, pigment is
redistributed toward low height regions, enhancing granulation even within otherwise flat washes. The modulation conserves total
pigment and can be toggled from the UI for performance-sensitive scenarios.

## Layer Rewetting

To mimic pigment lifting, each water-bearing splat can trigger a rewet pass. The pass compares the pre- and post-splat water
amount and, where an increase is detected, transfers `rewetFactor × DEP` back into the dissolved pigment pool while reducing the
deposit by the same amount. The factor is clampable per pigment so staining colours remain fixed while delicate pigments bleed
back into solution. This enables glazing workflows where a fresh wash can soften edges or revive colour from the underlying layer.

## Module Layout

- `WatercolorSimulation.ts` – High-level orchestrator that manages render targets, invokes render passes, and exposes the public API.
- `shaders.ts` – All GLSL source strings grouped by pass.
- `materials.ts` – Factories for RawShaderMaterials plus the velocity-max helper material.
- `targets.ts` – Utilities for consistent render-target construction and procedural fibre generation.
- `constants.ts` – Shared numeric constants, pigment coefficients, and default parameter sets.
- `types.ts` – TypeScript definitions for brushes, binders, simulation parameters, and ping-pong targets.

The separation keeps `WatercolorSimulation` focused on sequencing while shader details and reusable helpers live beside their concerns.

## Parameter Controls

Leva panels in the demo map directly to `SimulationParams` fields:

- **Brush** – Tool selection, radius, flow, and drybrush threshold controls mapped to the splat shaders.
- **Drying & Deposits** – Base absorption (`A₀`), evaporation (`E₀`), edge bias, bloom strength, flux clamps, and paper texture influence strength.
- **Flow Dynamics** – Gravity, viscosity, CFL safety factor, and maximum adaptive substeps.
- **Binder** – Runtime overrides for binder injection, diffusion, decay, elasticity, viscosity, and buoyancy.
- **Surface Tension** – Enable/disable the filament relaxation pass and tune strength, neighbour thresholding, snapping, and the velocity gate.
- **Capillary Fringe** – Toggle the fringe-aware diffusion pass and tune strength, wet-front thresholding, and the fibre-aligned noise scale that carves feathered edges.
- **Brush Reservoir** – Water/pigment capacities and per-stamp consumption rates.
- **Pigment Separation** – RGB diffusion/settling overrides and per-pigment presets.
- **Simulation Features** – Toggles for state-dependent absorption, paper-texture-driven granulation, and rewetting behaviour.

## References

- Stam, J. *Stable Fluids*, SIGGRAPH 1999.
- Curtis, C., Anderson, S., Seims, J. *Computer Generated Watercolor*, SIGGRAPH 1997.
- Deegan, R. D. et al. *Capillary flow as the cause of ring stains from dried liquid drops*, Nature 1997.
- Kubelka, P., Munk, F. *Ein Beitrag zur Optik der Farbanstriche*, 1931.
- Lucas, R. (1918), Washburn, E. W. (1921). *Capillary flow in porous media*.
