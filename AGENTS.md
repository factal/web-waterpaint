# Repository Guidelines

## Project Structure & Module Organization
- `app/` hosts the Next.js App Router; `layout.tsx` defines shared chrome and `page.tsx` boots the watercolor scene with styles from `app/globals.css`.
- `components/` groups UI pieces: `canvas/` for three-fiber scaffolding, `watercolor/` for brush and shader panels, `helpers/` for tunnels and event adapters, and `dom/` for overlay layout.
- `lib/watercolor/` centralises simulation state, materials, and shader definitions; prefer deterministic pure helpers. Use `docs/` for reference notes and `public/` for static textures referenced through the `@/` alias.

## Build, Test, and Development Commands
- `npm run dev` starts Next.js with Turbopack, enabling hot reload of both DOM and canvas layers.
- `npm run build` produces an optimised production bundle; run before sharing hosted demos.
- `npm run start` serves the compiled app; rely on it when validating deployment behaviour.
- `npm run lint` executes ESLint with the Next config; run pre-PR to catch accessibility, hooks, and typing issues.

## Coding Style & Naming Conventions
- Codebase uses strict TypeScript; always type exported APIs and prefer explicit return types on shared helpers.
- Use two-space indentation, trailing commas in multiline objects, and omit semicolons to match existing files.
- Name React components with `PascalCase`, hooks with `useCamelCase`, and shader or material modules with descriptive nouns (e.g. `CapillaryFlowMaterial`).
- Import intra-project modules using the `@/` alias rather than long relative paths.

## Testing Guidelines
- Automated tests are not yet configured. When adding a harness, mirror source folders (`components/...` → `__tests__/components/...`) and expose it through `npm run test`.
- Document manual verification steps in PR descriptions: include canvas interactions exercised, browsers tested, and screenshots or short clips for visual changes.
- Ensure critical simulation paths remain deterministic by logging any stochastic seeds in docs or PR notes.

## Commit & Pull Request Guidelines
- Follow the existing Git history: short imperative subjects (`Add paper sizing variations`), optional qualifiers after a colon, and focused diffs per commit.
- Reference related issues in the PR body, include a concise summary, and link to docs updates or dashboards affected.
- For visual or performance tweaks, attach before/after captures and note expected frame-rate impact.
- Request review from simulation owners when touching `lib/watercolor/` or shader files.
