# Watercolor Simulation Overview


The watercolor engine now drives flow using a GPU-resident Lattice Boltzmann (LBM) solver. A D2Q9 BGK scheme evolves the fluid
velocity field on a square lattice, while scalar fields for water height, pigment load, binder concentration, and paper wetness
are advected and diffused on the same grid. Deposition and drying still follow the Lucas–Washburn model so the system preserves
the visual language of watercolor washes while moving the heavy computation to shader passes.

## Simulation State

- **LBM distributions** – Two ping-ponged `WebGLMultipleRenderTargets` keep the nine LBM distribution values (`f0 … f8`) encoded
  as three RGBA buffers. Each step streams the values from neighbours, collides toward equilibrium, and rescales to match the
  current water height.
- **Height/binder/pigment/wetness** – Ping-pong render targets (`H`, `B`, `C`, `W`) store the film thickness, binder content,
  pigment concentration, and paper wetness respectively. Height doubles as the Lucas–Washburn source term and guides the LBM
  pressure gradient.
- **Deposits and settled pigment** – Two more ping-pong textures (`DEP`, `S`) accumulate pigment fixed to the paper surface and
  the temporarily settled fraction used for granulation.
- **Velocity texture** – A single render target caches the macroscopic velocity extracted from the LBM distributions for use in
  semi-Lagrangian advection passes and CFL diagnostics.
- **Paper fibers** – A procedurally generated `DataTexture` encodes anisotropic diffusion coefficients so wetness can wick along
  implied paper grain.
- **Composite target** – The Kubelka–Munk composite shader still shades the final deposits texture into display space.

## Frame Pipeline

1. **Brush splat** – Water splats add to the height field while pigment splats additionally inject colour and binder according to
   the configured binder injection strength.
2. **LBM step** – A single collision/stream pass pulls neighbour distributions, applies a gravity-driven pressure gradient derived
   from the height field, modulates viscosity with binder concentration, and relaxes toward equilibrium. The resulting state is
   converted into a velocity/density texture in a follow-up pass.
3. **Binder advection & relaxation** – Binder is semi-Lagrangian advected by the new velocity field, diffused with a Laplacian, and
   decays toward zero. Binder viscosity feeds back into the next LBM solve.
4. **Height transport** – Water height is advected by the velocity field and nudged by binder buoyancy to simulate slightly tacky
   pigment mixtures.
5. **Pigment advection and diffusion** – Pigment follows the velocity field then diffuses via a Fickian Laplacian pass to soften
   colour boundaries.
6. **Absorption & evaporation** – Five shader passes reuse a shared Lucas–Washburn routine to update deposits, remaining height,
   pigment load, wetness, and settled pigment. The shader supports humidity-based modulation, an absorb-rate floor, and a
   pseudo time-offset factor to emulate the \(1 / \sqrt{t}\) decay from the reference model.
7. **Paper diffusion** – Wetness diffuses anisotropically along the fibre map, allowing backruns and blooms to travel outward.
8. **Composite** – Deposited pigment drives the Kubelka–Munk layer shader to produce the visible colour.

## LBM Details

- The solver uses the standard D2Q9 velocity set with BGK relaxation. Distribution storage is normalised such that the macroscopic
  density equals `LBM_BASE_DENSITY + height`, letting the height field drive pressure gradients.
- Binder acts as a viscosity booster by raising the local relaxation time before collision, slowing down heavy paint and letting
  thin washes flow freely.
- Gravity couples into the flow by sampling the water-height gradient and applying the resulting force during collision.

## Absorption Controls

- `absorb` sets the base Lucas–Washburn flux. When `stateAbsorption` is enabled the shader multiplies the flux by
  `(1 - wet)^β / √(wet + absorbTimeOffset)`, giving a humidity-sensitive, diminishing-rate absorption profile. `absorbMinFlux`
  clamps the result so extremely thin films still dry numerically.
- `evap` controls evaporation strength. The shader mixes evaporation with humidity so soaked paper evaporates slowly.
- `edge`, `granulation`, and `backrunStrength` behave as in the previous implementation, boosting pigment deposition at ridges and
  optionally redistributing pigment from the suspended and settled reservoirs.

## Module Layout

- `lib/watercolor/WatercolorSimulation.ts` – Orchestrates render targets, LBM passes, scalar advection, absorption, and final
  compositing.
- `lib/watercolor/materials.ts` – Builds the RawShaderMaterials for splats, LBM passes, advection, diffusion, absorption, and
  compositing.
- `lib/watercolor/shaders.ts` – Contains the GLSL snippets for the fullscreen quad, LBM kernels, diffusion, absorption, and
  Kubelka–Munk composite.
- `lib/watercolor/constants.ts` – Shared numerical constants, pigment optics parameters, and default binder/absorption values.
- `lib/watercolor/targets.ts` – Helpers for configuring render targets and ping-pong structures.
- `lib/watercolor/types.ts` – Shared TypeScript interfaces for brushes, binder parameters, simulation parameters, and the
  material map.

## Parameter Mapping

UI controls map onto the simulation as follows:

- **Flow dynamics** – `grav`, `visc`, `cfl`, and `maxSubsteps` feed the LBM solver, affecting the gravity force, base viscosity,
  and adaptive sub-stepping.
- **Drying** – `absorb`, `absorbExponent`, `absorbTimeOffset`, `absorbMinFlux`, `stateAbsorption`, `evap`, and `backrunStrength`
  configure the Lucas–Washburn and evaporation passes.
- **Binder** – `SimulationParams.binder` governs binder injection, diffusion, decay, viscosity boost, and buoyancy.
- **Pigment diffusion** – `PIGMENT_DIFFUSION_COEFF` is exposed in the code and can be tuned to adjust how quickly colours soften.
- **Granulation** – The granulation toggle activates settled-pigment transfer and noise-based deposition boosts.


## Module Layout


- Qian, Y. H., d'Humières, D., Lallemand, P. “Lattice BGK Models for Navier–Stokes Equation.” *Europhysics Letters*, 1992.
- Mi You et al. “Realistic Paint Simulation Based on Fluidity, Diffusion, and Absorption.” *Computer Animation and Virtual Worlds*, 2013.
- Lucas, R. (1918), Washburn, E. W. (1921). “Capillary flow in porous media.”
