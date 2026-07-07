# Flow — Implementation Plan

> Source spec: [BLUEPRINT.md](BLUEPRINT.md). This file is the resumable phase tracker: a fresh session must be able to continue from this file alone. Update the status table + phase notes after every phase.

**Conventions**
- Statuses: `todo` · `in-progress` · `done` · `blocked`
- Worktree note: Claude sessions run in `.claude\worktrees\*` without `node_modules`. `pnpm install` + dev servers run from the main repo (`D:\GitHub\Wispr-Flow-Clone`) after merging/pulling. Typecheck in-worktree only after an install here is confirmed feasible.
- Every phase ends with: code compiles (`tsc --noEmit` where applicable), plan file updated, brief commit.

## Status Board

| Phase | Title | Blueprint refs | Status | Notes |
|---|---|---|---|---|
| 0 | Repo scaffold: pnpm monorepo, Turborepo, shared configs | §8 | done | 2026-07-07 |
| 1 | `packages/shared`: Settings schema, IPC contract, WS protocol, ErrorKind | §7.3, §18, §19 | done | 2026-07-07 |
| 2 | Electron shell: boots to tray, single-instance, deep-link stub, windows (main + overlay), typed IPC plumbing | §7.2, §5.5 | todo | |
| 3 | Overlay pill UI + design tokens (`packages/ui`): all 6 states, driven by mock state machine | §4, §5.1 | todo | |
| 4 | Audio pipeline: getUserMedia, AudioWorklet framing, pre-roll ring, Silero VAD, waveform, device picker | §13.1–13.4 | todo | |
| 5 | Global hotkey layer (Windows first): uiohook-napi or native hook, hold/toggle detection, DictationController state machine skeleton | §14.1, §3.1 | todo | Win-only OK for now; mac later |
| 6 | Backend skeleton: NestJS + Fastify + Prisma schema + Redis + WS gateway with echo-STT stub, full session.* protocol | §9, §10, §18 | todo | docker-compose for pg/redis |
| 7 | Deepgram streaming STT integration + interim relay → end-to-end raw dictation shown in overlay | §12.1, §12.4, §13.6–13.7 | todo | needs DEEPGRAM_API_KEY |
| 8 | Insertion engine v1: tier-2 clipboard-swap paste + restore + per-app quirks table → first real insertion 🎉 | §14.3, §2 F5/F17 | todo | |
| 9 | LLM formatting: Claude Haiku provider, prompt v1, degrade-to-raw path, golden fixture set | §12.2, §12.5 | todo | needs ANTHROPIC_API_KEY |
| 10 | Auth: Google OAuth PKCE + deep link, magic link, JWT + refresh rotation, safeStorage, devices | §11, §17 | todo | |
| 11 | Settings system: electron-store, live-apply, settings UI shell, shortcut recorder | §19, §5.4 | todo | |
| 12 | Onboarding + permission flows + practice screen | §3.2, §5.2 | todo | |
| 13 | History: local SQLite + FTS5, home screen UI, undo, restore stack | §5.3, F14/F15 | todo | |
| 14 | Stabilization: insertion matrix, reconnect/replay, error taxonomy wiring | §3.1 table, §22 | todo | |
| 15 | Dictionary + language switching + STT keyword boosting | F10, F16 | todo | |
| 16 | App awareness (focus.node probes, profiles, rules UI) + parallel-LLM latency trick | §12.6, §14.2, F11 | todo | |
| 17 | Sync (settings doc, outbox, conflict merge) | §19.4, F22 | todo | |
| 18 | Billing: Stripe checkout/portal/webhooks, quotas, gating, trial | §20 | todo | |
| 19 | Distribution: electron-builder, signing, auto-update, channels | §14.4, §26 | todo | |
| 20 | Observability + hardening + launch checklist sweep | §15, §21–§25, §30 | todo | |

## Environment / decisions log

- 2026-07-07: Blueprint completed (BLUEPRINT.md). Stack locked: Electron + Vite/React/TS, NestJS/Fastify, Prisma/Postgres, Redis, Deepgram, Claude Haiku, custom PKCE auth, Stripe.
- Primary dev OS: Windows 11 → Windows-first for native layers; macOS parity deferred per phase notes.

## Phase notes

### Phase 0 — done (2026-07-07)
- Root: `package.json` (pnpm@10.32.1, turbo+prettier scripts), `pnpm-workspace.yaml` (apps/*, packages/*), `turbo.json` (build/typecheck/lint/test/dev), `.npmrc` (**node-linker=hoisted** — Electron tooling requirement, do not change), `.gitignore`, `.editorconfig`, `prettier.config.mjs`.
- `packages/config`: `tsconfig.base.json` (strict, ES2022, Bundler resolution), `tsconfig.node.json` (NodeNext), `tsconfig.react.json` (DOM+jsx), `eslint.base.mjs` (flat config, typescript-eslint), exported via package.json `exports`.
- Project `CLAUDE.md` created (base branch main, layout, no-transcript-logging rule).
- Verified: `pnpm install` clean in worktree; `turbo run lint` executes (0 tasks — no app packages yet, expected).
- Note: worktree DOES tolerate `pnpm install` fine — future phases can typecheck in-worktree.

### Phase 1 — done (2026-07-07)
Built `packages/shared` (tsc-built ESM, exports `./dist`):
- `src/errors.ts` — closed `ERROR_KINDS` taxonomy (13 kinds) + `FlowError` + `toErrorKind`.
- `src/settings.ts` — zod `LocalSettingsSchema`/`SyncedSettingsSchema` merged into `SettingsSchema`; `DEFAULT_SETTINGS`; `parseSettings` does per-key salvage of corrupt stores; `pickSyncedSettings`; key-partition lists.
- `src/entitlements.ts` — `Plan`, `entitlementsFor(plan)`, `quotaDecision` (ok/warn 80%/grace 100%/block 110%).
- `src/types.ts` — SessionInfo, DictationState/Phase, HistoryEntry/Page, UpdateStatus, UndoResult, SyncStatus.
- `src/ws-protocol.ts` — full §18 protocol as zod discriminated unions (client: session.start/finish/cancel/resume, rewrite.start, sync.push; server: ready/interim/result/error, rewrite.delta/done, subscription.updated, sync.changed, system.notice); binary audio framing `[u8 kind][u16be seq][s16le pcm]` encode/decode (PCM written via DataView — 3-byte header makes Int16Array views illegal); WS close codes; heartbeat const; safe `parseClientMessage`/`parseServerMessage`.
- `src/ipc.ts` — `FlowInvoke`/`FlowEvents` maps per §7.3, `FlowBridge` (the `window.flow` surface), overlay allowlists (`OVERLAY_INVOKE_ALLOWLIST`/`OVERLAY_EVENT_ALLOWLIST`).
- Tests: 13 vitest cases (settings salvage + key partition, ws parse/reject, audio-frame round-trip + seq wrap, quota bands). `turbo run build test typecheck` all green.
- Decision: server-message `entitlements` payload kept `z.unknown()` to avoid duplicating the TS shape in zod; validated app-side.
