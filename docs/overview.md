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

All simulation textures use half floats so they remain filterable on WebGL2.

## Frame Pipeline

1. **Brush splat** – Water, binder, and optional pigment are injected using Gaussian falloffs. Radial velocity impulses emulate brush agitation.
2. **Binder evolution** – The viscoelastic binder field is advected with the flow, diffused, and damped. Binder gradients feed the `binderForces` pass, which applies elastic spring forces and viscosity-dependent damping to the velocity field.
3. **Pressure projection** – Stam (1999) projection solves a Poisson equation to enforce incompressibility before the next transport step.
4. **Fluid transport** – Semi-Lagrangian advection updates velocity (with slope-driven gravity), water height (including binder buoyancy), and dissolved pigment.
5. **Pigment diffusion** – A dedicated Fickian diffusion pass integrates `∂C/∂t = D∇²C`, ensuring pigment blurs even in stagnant water. The coefficient is exposed through the simulation constants.
6. **Absorption, evaporation, and granulation** – The absorb suite reads the current state and returns updated `H`, `C`, `DEP`, `W`, and `S`. Lucas–Washburn dynamics drive absorption using `A = A₀·(1 - w)^{β}` with `β = 0.5` and a temporal decay term `1 / √(t + t₀)`. Edge gradients add blooms, while pigment settling feeds the granulation buffer.
7. **Paper diffusion** – Moisture diffuses anisotropically along a procedural fibre field, keeping wet edges alive and replenishing drier paper with a portion of the absorbed water.
8. **Kubelka–Munk composite** – Deposited pigment is converted into optical coefficients and shaded against the paper colour with a finite-thickness KM approximation.

## Viscoelastic Binder Field

The binder state (`B`) models the elastic, viscous behaviour of heavy paint media. Each substep performs:

- **Advection & diffusion:** Binder is transported with the velocity field and diffused to avoid numerical clumping.
- **Decay:** A configurable decay term lets binder relax over time.
- **Elastic feedback:** Gradients of the binder field are converted into spring forces that pull the velocity back toward prior strokes, imitating stringy, paste-like behaviour.
- **Damping:** Binder concentration modulates velocity damping, yielding slower, heavier motion in pigment-rich regions.

Binder parameters (injection, diffusion, decay, elasticity, viscosity, buoyancy) are exposed through `SimulationParams.binder` and default to the values listed in `constants.ts`.

## Pigment Diffusion

Watercolor pigments bleed even without bulk flow. The `diffusePigment` pass evaluates a four-neighbour Laplacian on the dissolved pigment buffer and integrates it with an adjustable diffusion coefficient. The pass runs every substep immediately after advection so the absorbed pigment sees the latest blurred concentrations. The coefficient can be tuned in `constants.ts` or overridden at runtime.

## Lucas–Washburn Absorption

Absorption now follows the Lucas–Washburn law. The absorb shader applies:

- **Humidity power law:** `humidityFactor = (1 - w)^{β}` with `β = 0.5` accentuates rapid uptake on dry paper and softens as the sheet saturates.
- **Temporal decay:** `A₀` is multiplied by `1 / √(t + t₀)` so absorption slows naturally as the wetting front propagates.
- **Flux floor:** A configurable minimum flux prevents the system from stalling numerically once the film becomes extremely thin.

Evaporation retains its humidity coupling, and granulation/backrun logic now runs against the diffusion-updated pigment field, producing softer, more organic blooms.

## Granulation Reservoir (`S`)

Settled pigment accumulates into the `S` buffer before it bonds to the paper. Deposition draws proportionally from both dissolved (`C`) and settled (`S`) pigment, letting heavy particles migrate toward ridges and edges, reproducing the characteristic grain of traditional watercolour washes.

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

- **Brush** – Tool selection, radius, and flow, mapped to the splat shaders.
- **Drying & Deposits** – Base absorption (`A₀`), evaporation (`E₀`), edge bias, bloom strength, and flux clamps.
- **Flow Dynamics** – Gravity, viscosity, CFL safety factor, and maximum adaptive substeps.
- **Binder** – Runtime overrides for binder injection, diffusion, decay, elasticity, viscosity, and buoyancy.
- **Brush Reservoir** – Water/pigment capacities and per-stamp consumption rates.
- **Simulation Features** – Toggles for state-dependent absorption, granulation, and a scalar for paper-texture influence.

## References

- Stam, J. *Stable Fluids*, SIGGRAPH 1999.
- Curtis, C., Anderson, S., Seims, J. *Computer Generated Watercolor*, SIGGRAPH 1997.
- Deegan, R. D. et al. *Capillary flow as the cause of ring stains from dried liquid drops*, Nature 1997.
- Kubelka, P., Munk, F. *Ein Beitrag zur Optik der Farbanstriche*, 1931.
- Lucas, R. (1918), Washburn, E. W. (1921). *Capillary flow in porous media*.
