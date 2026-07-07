# Flow (Wispr Flow clone) — project rules

- **Spec**: BLUEPRINT.md is the technical spec; IMPLEMENTATION_PLAN.md tracks phase progress. Update the plan file after every phase.
- **Base branch for PRs**: `main`.
- **Package manager**: pnpm (workspace: `apps/*`, `packages/*`). Hoisted node-linker (Electron tooling requirement) — do not change `.npmrc`.
- **Layout**: `apps/desktop` (Electron), `apps/api` (NestJS), `packages/shared` (IPC/WS/Settings contracts — single source of truth), `packages/ui` (design system), `packages/config` (tsconfig/eslint presets).
- **Windows-first**: primary dev OS is Windows 11; macOS parity is tracked per-phase, don't block on it.
- **Never log or persist transcript text or window titles** — enforced product rule (BLUEPRINT §15).
