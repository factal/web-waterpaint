# Web Waterpaint

Interactive watercolor painting demo built on Next.js, Three.js, and GPU compute shaders. The app couples a shallow-water fluid solver, pigment transport, and paper optics so brush strokes bloom, diffuse, and dry like real media.

## Overview
- Renders through the Next.js App Router (`app/`) with a React Three Fiber canvas and an overlay UI for brush controls powered by Leva.
- `lib/watercolor/WatercolorSimulation.ts` orchestrates the GPU pipeline across water height, velocity, pigment, binder, wetness, and paper granulation buffers.
- Procedural paper height, fibre, and sizing textures are generated at runtime to drive drybrush masking, capillary flow, and absorption.
- Shaders live in `lib/watercolor/shaders.ts`; materials and render targets are centralised in `lib/watercolor/materials.ts` and `lib/watercolor/targets.ts` for deterministic setup.
- Docs in `docs/overview.md` describe the full frame pipeline, binder dynamics, and parameter panels exposed in the UI.

## Prerequisites
- Node.js 20 or newer (matches the version range supported by Next 15 and TypeScript tooling in `package.json`).
- npm 9+ (ships with recent Node releases).

Install dependencies once:

```bash
npm install
```

## Development
- Start the hot-reloading dev server with Turbopack:

  ```bash
  npm run dev
  ```

  Visit http://localhost:3000 and use the brush selector panel to lay down water and pigments. Toggle debug views to inspect intermediate buffers while iterating on shader changes.

- Common scripts:
  - `npm run build` - create an optimised production bundle (also uses Turbopack).
  - `npm run start` - serve the built app for deployment validation.
  - `npm run lint` - run ESLint with the Next config; keep it clean before opening a PR.

Manual verification is currently the primary test path. When sharing changes, capture the scenarios you exercised (e.g. wet-on-wet blooms, drybrush strokes, evaporation rings) and any browsers tested.

## Project Layout
- `app/` - Next.js routing, layout chrome, and the entry component that instantiates the watercolor viewport.
- `components/` - UI composition split across `canvas/`, `watercolor/`, `helpers/`, and `dom/` for overlays.
- `lib/watercolor/` - Simulation state, shader sources, GPU materials, and shared constants/types.
- `docs/` - Reference notes covering simulation internals such as target layouts and solver stages.
- `public/` - Static assets accessible through the `@/` alias.

## Coding Guidelines
- Strict TypeScript throughout; export types explicitly and prefer pure helpers for shared logic.
- Use two-space indentation, trailing commas in multiline literals, and omit semicolons to match existing files.
- React components use PascalCase names, hooks use the `use` prefix, and shader or material modules favour descriptive nouns (e.g. `CapillaryFlowMaterial`).
- Import internal modules via the `@/` alias instead of long relative paths.

## Contributing
- Run the lint script and document manual test coverage before raising a PR.
- Keep commits focused with short imperative subjects (`Add paper sizing variations`).
- Coordinate with simulation owners when modifying `lib/watercolor/` or shader files, and include before/after captures for visual or performance tweaks.
- Reference related docs updates or issues in the PR body so reviewers can trace context.

For deeper technical background, start with `docs/overview.md` and the inline comments across `lib/watercolor/` modules.
