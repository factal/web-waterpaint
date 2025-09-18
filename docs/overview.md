# Watercolor Simulation Overview

The watercolor solver now follows the physical model described in *Realistic Paint Simulation Based on Fluidity, Diffusion, and Absorption*. A predictive–corrective SPH (PCISPH) integrator evolves a mixture of solvent and paint particles, each particle carries pigment concentration and binder content, and the resulting deposition is shaded through a Kubelka–Munk composite pass.

## Simulation State

- **Particle buffers** – Typed arrays hold particle position, velocity, density, pressure, binder strength, pigment concentrations (RGB), infiltration depth, and accumulated absorption time for up to `SPH_MAX_PARTICLES` entries.
- **Spatial grid** – A uniform hash grid accelerates neighbour lookups for density, pressure, and diffusion kernels.
- **Paper fields** – CPU-side grids track deposited pigment (RGB in `depositData`) and paper wetness. Both are uploaded each frame as `DataTexture`s.
- **Composite target** – A `WebGLRenderTarget` stores the final Kubelka–Munk colour, driven by the deposit texture and the pigment optical coefficients.

## Frame Pipeline

1. **Brush splat** – Pointer input spawns particles within the brush radius. Water splats create solvent particles while pigment splats inject binder-rich paint particles with the requested colour.
2. **External forces** – Gravity, viscosity, and binder-dependent viscoelasticity accumulate accelerations. Viscous forces use the viscosity kernel laplacian, while binder elasticity applies spring-like corrections using the spiky gradient.
3. **PCISPH pressure solve** – Predictive velocities and positions integrate the external forces, then a fixed number of pressure iterations enforce incompressibility. Each iteration recomputes density with the poly6 kernel, updates pressure via the predictive-corrective relaxation factor, and applies the symmetric pressure gradient force.
4. **Binder & pigment diffusion** – Fick's second law is evaluated per particle using equation (7):
   \[ D \nabla^2 c_i = D \sum_j m_j \frac{c_j - c_i}{\rho_j} \nabla^2 W_{ij}. \]
   The same laplacian smooths binder concentrations, while an exponential decay parameter lets binder relax over time.
5. **Lucas–Washburn absorption** – Each particle maintains an infiltration depth `ℓ`. The Lucas–Washburn rate
   \[ \frac{d\ell}{dt} = \frac{r_c^2}{8 \, \mu \, \ell}(P_h + P_c) \]
   governs how quickly liquid penetrates the paper. Hydrodynamic pressure `P_h` is estimated from local density and gravity, while the capillary term `P_c = 2σ cosθ / r_c` uses the configured surface tension and contact angle. The absorption flux removes particle mass, transfers a proportional amount of pigment to the deposit texture, raises the wetness field, and advances `ℓ`.
6. **Evaporation** – A simple humidity decay reduces the wetness field based on the UI evaporation parameter so dry paper regains absorption capacity over time.
7. **Kubelka–Munk composite** – Deposited pigment drives the optical model from `lib/watercolor/shaders.ts`. The composite material converts pigment load to K/S coefficients and multiplies the paper colour by the resulting reflectance.

## Viscoelastic Binder

Binder concentration rides with each particle and influences three behaviours:

- **Force feedback** – Binder-rich particles receive stronger elastic spring forces, causing strokes to retain shape and resist sudden shear.
- **Viscosity boost** – The viscosity coefficient rises with binder concentration, modelling the tacky motion of heavy paint.
- **Diffusion & decay** – Binder diffuses between neighbours (sharing the same laplacian as pigment) and decays exponentially, imitating gradual relaxation as the medium evens out.

`SimulationParams.binder` exposes injection amount plus diffusion, decay, elasticity, and viscosity multipliers so the UI can emulate different media.

## Absorption Controls

State-dependent absorption mirrors the Lucas–Washburn behaviour:

- `absorb` scales the base flux. When `stateAbsorption` is enabled the flux is modulated by humidity `(1 - w)^{β}` with `β = absorbExponent` and a time term `1 / √(t + absorbTimeOffset)`.
- `absorbMinFlux` provides a floor so very thin films continue drying numerically.
- Deposited pigment inherits an edge multiplier (`edge`) and optional granulation noise to mimic backruns and granular pigment clumping.

## Module Layout

- `WatercolorSimulation.ts` – Owns the particle buffers, PCISPH integration loop, absorption logic, and rendering orchestration.
- `materials.ts` – Builds the zero-clear and composite materials.
- `shaders.ts` – Contains the fullscreen vertex, clear fragment, and Kubelka–Munk composite shader sources.
- `constants.ts` – Shared simulation constants and default parameter values (SPH radius, rest density, Lucas–Washburn coefficients, etc.).
- `types.ts` – Brush, binder, reservoir, and parameter interfaces used across the app.

## Parameter Mapping

UI controls in `app/page.tsx` map to simulation parameters as follows:

- **Flow dynamics** – `grav`, `visc`, `cfl`, and `maxSubsteps` affect gravity strength, baseline viscosity, and adaptive timestep selection for the PCISPH loop.
- **Drying** – `absorb`, `absorbExponent`, `absorbTimeOffset`, `absorbMinFlux`, and `stateAbsorption` tune the Lucas–Washburn flux, while `evap` drives wetness decay.
- **Binder** – Passed directly to `binderSettings` to control viscoelastic response.
- **Edge & granulation** – Influence deposition intensity and whether noise modulates pigment buildup.

## Module Layout


- Solenthaler, B., Pajarola, R. “Predictive-Corrective Incompressible SPH.” ACM SIGGRAPH 2009.
- Mi You et al. “Realistic Paint Simulation Based on Fluidity, Diffusion, and Absorption.” *Computer Animation and Virtual Worlds*, 2013.
- Stam, J. “Stable Fluids.” SIGGRAPH 1999 (for historical context).
- Lucas, R. (1918), Washburn, E. W. (1921). “Capillary flow in porous media.”
