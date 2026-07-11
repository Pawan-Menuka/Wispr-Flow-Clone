# HANDOFF — Flow (Wispr Flow clone)

> Cold-start context for a fresh Claude session. Read this + `IMPLEMENTATION_PLAN.md` (authoritative phase tracker with detailed per-phase notes) + `CLAUDE.md` (project rules). The full technical spec is `BLUEPRINT.md`.

## Where things stand (2026-07-11)

**19 of 21 phases done** (0–18). The complete core product works end-to-end:
hold `Ctrl+Win` → mic capture → streaming STT → LLM formatting → paste at cursor, with overlay UI, onboarding, settings + sync, auth, history, dictionary, per-app profiles, quotas, and Stripe billing (env-gated).

**Remaining phases:**
- **Phase 19 — Distribution**: electron-builder installers (NSIS), electron-updater channels, code signing. Unsigned installers + update plumbing are buildable now; real signing needs certificates (user purchase decision: Azure Trusted Signing / Apple Developer ID). BLUEPRINT §14.4, §26.
- **Phase 20 — Observability + hardening**: Sentry, telemetry (PostHog, respecting the `telemetry` setting), log redaction, CI workflow (none exists yet!), launch-checklist sweep. BLUEPRINT §15, §21–25, §30.

## How this project is worked

- One phase per sitting via the `/phase` skill; plan file updated BEFORE reporting; commit per phase; user says "ship it" → push (gh CLI unavailable — give compare URL: https://github.com/Pawan-Menuka/Wispr-Flow-Clone/compare/main...claude/beautiful-dirac-5601a2).
- Branch: `claude/beautiful-dirac-5601a2`. **User merges PRs themselves.** Base branch `main`. NOTE: user said they merged early PRs but origin/main previously didn't reflect it — don't worry, just keep pushing the branch.
- Worktree `pnpm install` works fine; run everything via the Bash tool (never PowerShell for pnpm).
- Verify pattern: `pnpm exec turbo run build typecheck test` (12 tasks) + `electron . --smoke` in apps/desktop (flags: `--smoke-mic` real-capture + dictation loop; `--smoke-insert` self-paste test; env `FLOW_SMOKE_CAPTURE_MAIN=<png>` screenshots the main window, `FLOW_SMOKE_PAGE=home|settings`, `FLOW_SMOKE_ONBOARDING=1`). Screenshots have caught real UI bugs — use them for anything visual.
- User = Pawan (solo dev, Windows 11). Use "Pawan" in examples, never "Mihijith".

## Verification debt (blocked on user-provided resources)

1. **API keys** (user said they'll add to `D:\GitHub\Wispr-Flow-Clone\apps\api\.env` — template in `.env.example`): `DEEPGRAM_API_KEY` (live STT), `ANTHROPIC_API_KEY` (live formatting + 8 golden tests auto-run when set). First real dictation exercises: dictionary boost ("Pawan" acceptance test), per-app profiles, parallel-LLM latency, VAD tuning (energy VAD is too hot — ambient noise trips it; Silero upgrade deferred), `docs/insertion-matrix.md` first pass.
2. **Docker Desktop won't start on this machine** (daemon never came up across sessions). Blocked on it: first Prisma migration (`pnpm db:migrate` in apps/api against `infra/docker-compose.dev.yml` Postgres), and all DATABASE_URL-gated integration tests (auth rotation/reuse-revocation ×5, sync routes ×4, stripe lifecycle ×2). Run with `DATABASE_URL=postgresql://flow:flow@localhost:5432/flow pnpm test` in apps/api.
3. **Stripe test keys** for a real checkout round-trip (`stripe listen --forward-to localhost:8787/v1/billing/webhook`).

## Architecture cheat-sheet (details in plan notes)

- `packages/shared` — single source of truth: zod Settings schema (local/synced split), IPC contract (`FlowInvoke`/`FlowEvents`, overlay allowlists), WS protocol (discriminated unions + binary audio framing), ErrorKind taxonomy, entitlements/quota bands, sync merge (`mergeSyncedDocs`).
- `apps/desktop` (electron-vite, CJS main/preload): main services = settings-store, auth (safeStorage), sync, history (JSONL), dictionary, insertion (clipboard-swap tier 2 + quirks + undo), focus (koffi Win32), ws-client (reconnect-with-full-replay), audio-bridge; hotkeys via uiohook-napi (chords.ts pure parser); DictationController = §3.1 state machine (Electron-free, injected deps). Renderer: app shell (Home/Settings/Onboarding) + separate overlay entry.
- `apps/api` (NestJS+Fastify, ESM): raw-ws gateway at /v1/stream (NOT a Nest gateway); providers behind interfaces (Deepgram/echo STT w/ `textSoFar()` for §12.6 parallel-LLM; Anthropic claude-haiku-4-5 w/ rule-format fallback); auth (magic codes, HS256 JWT, refresh rotation w/ family-reuse revocation); sync doc routes; billing (Stripe + idempotency ledger); quotas.
- Known landmines (all documented in plan notes): pnpm `onlyBuiltDependencies` gates native postinstalls; `prisma generate` must stay a turbo `db:generate` task (parallel-call file locks); never add explicit `fastify` dep (type split vs Nest's); Fastify scoped raw-body parser needs `removeContentTypeParser` first; `webContents.isLoading()` unreliable.

## Suggested next-session opener

"Read HANDOFF.md and IMPLEMENTATION_PLAN.md, then continue with Phase 19" — or, if the user has added API keys / gotten Docker running, pay down the verification-debt list first (it reshapes Phase 20 priorities).
