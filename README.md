# Flow

System-wide voice dictation for desktop — hold a hotkey anywhere, speak, get polished text at your cursor. A production-grade Wispr Flow clone.

- **Spec**: [BLUEPRINT.md](BLUEPRINT.md)
- **Progress**: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## Workspace

| Path | What |
|---|---|
| `apps/desktop` | Electron app (React + Vite renderer, native modules) |
| `apps/api` | NestJS backend (Prisma/Postgres, Redis, dictation WS gateway) |
| `packages/shared` | IPC/WS protocol + Settings schema — single source of truth |
| `packages/ui` | Design tokens + component library |
| `packages/config` | Shared tsconfig / eslint / prettier presets |

## Develop

```bash
pnpm install
pnpm dev        # turbo: all dev servers
pnpm typecheck
pnpm test
```

Requires Node ≥ 20 and pnpm 10.
