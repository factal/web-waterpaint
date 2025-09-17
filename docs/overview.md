# Watercolor Simulation Overview

This document describes the simulation implemented in the Next.js/react-three-fiber prototype. The current build implements the following roadmap items:

- Pressure projection to maintain a divergence-free velocity field.
- Anisotropic paper diffusion driven by a procedurally generated fibre texture.
- State-dependent absorption and evaporation tied to paper wetness and water height.
- Granulation via a settled pigment reservoir that feeds into deposition.
- Backruns/Blooms that emphasise advancing wet edges using the wetness gradient.
- CFL-based adaptive timestep with automatic sub-stepping when velocities spike.
- Finite-thickness Kubelka–Munk composite with adjustable layer scale.

## State Fields

| Symbol | Texture | Description |
| ------ | ------- | ----------- |
| `H` | ping-pong RGBA16F | Water height (R channel). |
| `UV` | ping-pong RGBA16F | Surface velocity (RG). |
| `C` | ping-pong RGBA16F | Dissolved pigment carried by the flow (RGB). |
| `DEP` | ping-pong RGBA16F | Pigment deposited on the paper (RGB). |
| `W` | ping-pong RGBA16F | Paper wetness / retained moisture (R). |
| `S` | ping-pong RGBA16F | Settled pigment reservoir used for granulation (RGB). |
| `KM` | single RGBA16F | Kubelka–Munk composite colour rendered to screen. |
|

All simulation textures use half floats so they remain filterable on WebGL2.

## Frame Pipeline

1. **Splat (brush injection)**  
   Injects water and optionally pigment using a Gaussian falloff. A radial velocity push is added to mimic brush agitation. Parameters come from the Leva "Brush" controls.

2. **Pressure projection (Stam 1999)**  
   An unsteady velocity field is projected onto a divergence-free subspace by solving the Poisson equation `∇²p = div(u) / dt` (20 Jacobi iterations). The gradient of `p` is subtracted from `u` to enforce incompressibility. This stabilises edge flows and keeps puddles from expanding indefinitely.

3. **Advection**  
   Semi-Lagrangian advection transports `H` and `C` using the updated velocity. Velocity is also damped by viscosity and accelerated by the surface gradient term `u += -dt * g * ∇h`.
   Before each frame, the solver measures the current maximum velocity magnitude via a GPU reduction. If `dt` violates the configured CFL safety bound, it subdivides the frame into multiple substeps (up to `maxSubsteps`) to keep `|u|·dt ≤ cfl·dx`.

4. **Absorption / Evaporation / Granulation**  
   The absorb pass now evaluates per-pixel rates:

   - Absorption: `A = A₀ * (1 - w)^{β}` with exponent `β = 1.4`, encouraging drier paper to pull in more water.
   - Evaporation: `E = E₀ * √h * mix(1, 1 - w, λ)` with `λ = 0.6`, reducing evaporation on saturated paper.
   - Granulation reservoir: a percentage `v_settle * dt` of the remaining dissolved pigment enters the settled buffer `S` before deposition.
   - Deposition: dissolved pigment plus the settled reservoir feed a depth factor `k_dep = depBase + granStrength * edgeBias` to reinforce pigment along ridges (`edgeBias ∝ |∇h|`). The deposited mass is subtracted from both dissolved and settled pools proportionally.
   - Blooms/backruns: positive wetness gradients (`max(w - w_neighbor, 0)`) scale an extra deposit term `k_back` so advancing fronts leave cauliflower blooms. The strength comes from the "Backrun Strength" slider and clamps itself to the available dissolved pigment.

   The pass outputs updated `DEP`, `H`, `C`, `W`, and `S` using separate raw-shader materials fed with the same uniforms.

5. **Anisotropic paper diffusion**  
   After absorption the wetness buffer is diffused using an oriented tensor field derived from a procedural fibre texture. The shader samples `(cosθ, sinθ, d∥, d⊥)` per texel and integrates `w_t = ∇·(D ∇w) + replenish`, nudging water along the grain while replenishing drier paper with a portion of the absorbed water.

6. **Composite (Finite-thickness Kubelka–Munk)**  
   Deposited pigment produces absorption `K` and scattering `S` coefficients. We approximate finite thickness by scaling both coefficients with the accumulated pigment mass (controlled by `KM_LAYER_SCALE`) before evaluating the infinite-layer KM solution. This darkens layered pigment while keeping the formulation numerically stable on WebGL.

## Granulation Reservoir (`S`)

The settled buffer captures pigment that precipitates but has not yet bonded to the paper surface. Settling is proportional to dissolved pigment (`S += v_settle * C * dt`), while deposition draws from both dissolved and settled pigment. This produces the darker grainy rims characteristic of traditional watercolour granulation.

## Parameter Controls

Leva UI folders map to the simulation parameters:

- **Brush**: tool, radius, and flow. Pigment tools map to CMY pigment reservoirs.
- **Drying & Deposits**: base absorption `A₀`, evaporation `E₀`, edge bias strength, and backrun intensity (`k_back`).
- **Flow Dynamics**: gravity, viscosity, CFL safety factor, and maximum substeps for adaptive timestepping.
- **Brush Reservoir**: capacity and consumption sliders for water/pigment charge and stamp spacing.
- **Simulation Features**: toggles for state-dependent drying and granulation, useful when isolating regressions.

Global constants (tuned empirically) control the exponents, humidity coupling, settle rate, and granulation strength. They can be adjusted in `WatercolorSimulation.ts` if different paper styles are desired.

## Shaders

| Stage | Shader constant | Notes |
| ----- | --------------- | ----- |
| Brush splat | `SPLAT_*` | Adds water/pigment and radial velocity. |
| Advection | `ADVECT_*` | Semi-Lagrangian transport with slope-driven acceleration. |
| Absorption suite | `ABSORB_*` | Shared helper `computeAbsorb()` calculates state-dependent rates and granulation. |
| Pressure solve | `PRESSURE_*` | Divergence, Jacobi, and projection passes. |
| Paper diffusion | `PAPER_DIFFUSION_FRAGMENT` | Anisotropic diffusion along fibres with replenish term. |
| Composite | `COMPOSITE_FRAGMENT` | Kubelka–Munk reflectance shading. |

## Implementation Notes

- RawShaderMaterial is used for all compute shaders to avoid three.js shader chunk injection and to work directly with `#version 300 es` WebGL2 shaders.
- Ping-pong render targets (`createPingPong`) are used for every mutable field so that reads and writes remain disjoint.
- The fibre texture is generated procedurally as a `DataTexture`, encoding orientation and diffusion coefficients for each texel. This avoids additional assets and keeps the grain reproducible.
- Finite-thickness KM uses a tunable layer scale (`KM_LAYER_SCALE`) that maps deposited pigment mass to optical thickness, with hyperbolic formulations to avoid the infinite-layer shortcut.
- Granulation and diffusion rely on constants tuned for stability on half-float buffers; extreme parameter values may demand higher iteration counts or clamping adjustments.

## References

- Stam, J. *Stable Fluids*, SIGGRAPH 1999. (advection & projection)
- Curtis, C., Anderson, S., Seims, J. *Computer Generated Watercolor*, SIGGRAPH 1997. (deposition & edge darkening)
- Deegan, R. D. et al. *Capillary flow as the cause of ring stains from dried liquid drops*, Nature 1997. (coffee-ring effect)
- Kubelka, P., Munk, F. *Ein Beitrag zur Optik der Farbanstriche*, 1931. (KM reflectance)
- Lucas, R. (1918), Washburn, E. W. (1921). *Capillary flow in porous media*. (absorption law)






