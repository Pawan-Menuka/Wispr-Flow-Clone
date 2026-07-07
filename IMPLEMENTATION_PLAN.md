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
| 2 | Electron shell: boots to tray, single-instance, deep-link stub, windows (main + overlay), typed IPC plumbing | §7.2, §5.5 | done | 2026-07-07 |
| 3 | Overlay pill UI + design tokens (`packages/ui`): all 6 states, driven by mock state machine | §4, §5.1 | done | 2026-07-07 |
| 4 | Audio pipeline: getUserMedia, AudioWorklet framing, pre-roll ring, VAD, waveform, device picker | §13.1–13.4 | done | 2026-07-07 (energy VAD; Silero deferred) |
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

### Phase 2 — done (2026-07-07)
Built `apps/desktop` on **electron-vite 3** (CJS main/preload — no `"type":"module"`, required for sandboxed preloads; `@flow/shared` ESM gets bundled in):
- `src/main/index.ts` — single-instance lock, `flowapp://` protocol registration + deep-link routing stub (logs route only, never query strings), tray-first lifecycle (`window-all-closed` keeps running), `--smoke` mode (asserts both renderers load, exit 0/1).
- `src/main/windows.ts` — `WindowManager`: main window (980×640, close-to-tray) + overlay (frameless/transparent/alwaysOnTop `screen-saver`/skipTaskbar/**focusable:false**, backgroundThrottling off, preloaded at boot, bottom-center positioning); hardened webPreferences everywhere (contextIsolation+sandbox+no nodeIntegration); typed `broadcast()` honoring `OVERLAY_EVENT_ALLOWLIST`; load promises stored for smoke checks (`webContents.isLoading()` proved unreliable post-load — do NOT reintroduce it).
- `src/main/ipc/handlers.ts` — typed `handle()` wrapper: sender-identity guard (destroyed-window-safe `liveId`), overlay invoke-allowlist enforcement, zod arg validation. Implemented: settings:get/set (per-key schema validation + `settings:changed` broadcast), app:getVersion/openExternal (URL allowlist)/openLogsFolder; stubs registered: auth:getSession→null, dictation:cancel, app:checkForUpdates.
- `src/main/services/settings-store.ts` — atomic JSON store (tmp+rename) using shared `parseSettings` salvage; `onChange` subscription for live-apply (Phase 5 hotkey service will use).
- `src/preload/index.ts` (full bridge, channel-shape check) + `src/preload/overlay.ts` (reduced bridge enforcing both overlay allowlists) exposing `window.flow`.
- Renderers: `src/renderer/index.html→src/app/App.tsx` (dev shell proving invoke/set/subscribe round-trip incl. theme cycle) and `overlay.html→src/overlay/main.tsx` (pill placeholder rendering `dictation:state`). CSP meta on both.
- `scripts/gen-icons.mjs` — dependency-free PNG encoder generating `resources/tray.png`/`icon.png` (committed).
- **Gotcha fixed**: pnpm 10 blocks postinstall scripts → Electron binary never downloaded; root package.json now has `pnpm.onlyBuiltDependencies: ["electron","esbuild"]`.
- Verified: `turbo run build typecheck test` 5/5 green; `electron . --smoke` exits 0 (tray-ready + both renderers). Teardown IPC rejections in smoke stderr are the sender guard working (windows destroyed during exit), not a bug.
- Deviation from §8: overlay entry lives at `src/renderer/overlay.html` + `src/renderer/src/overlay/` (electron-vite wants one renderer root) instead of a separate `src/overlay/` dir.

### Phase 3 — done (2026-07-07)
- `packages/ui` (tsc-built like shared): `src/tokens.css` — full §4.1 token set (light + `[data-theme=dark]`, theme-invariant `--pill-*` palette, reduced-motion zeroes durations), exported as `@flow/ui/tokens.css`; primitives `Button`/`Spinner`/`Kbd` in `src/Button.tsx`.
- Shared contract addition: `clipboard:copyResult` invoke channel + added to `OVERLAY_INVOKE_ALLOWLIST` (Copy chip needs main-process clipboard).
- Overlay (apps/desktop `src/renderer/src/overlay/`): `OverlayPill.tsx` renders phases armed/listening/processing+inserting/confirmed/error (+offline chip); `Waveform.tsx` — 20-bar canvas ribbon fed by `audio:level` (~30 Hz), DPR-aware, reduced-motion→static level bar; `InterimText` uses RTL-ellipsis trick to keep the newest words visible, unstable tail dimmed via `stableWords`; `ActionChips` (Undo/Copy) with `-webkit-app-region: no-drag` (pill itself is drag-region). `overlay.css` has all pill styling.
- Main process: `src/main/dictation/demo.ts` — scripted dictation timeline (armed→listening w/ interims+levels→processing→result→confirmed→idle), exports `lastResult` consumed by the `clipboard:copyResult` handler; tray gained "Demo dictation"; overlay window now 380×110 (chips row); `WindowManager.captureOverlay()` + `FLOW_SMOKE_CAPTURE=<path>` env writes a PNG of the listening pill during `--smoke`.
- Handlers: `clipboard:copyResult` (guarded by dictationId match), `insertion:undo` stub (`{ok:false,method:'none'}`), `rewrite:run` stub.
- Main window imports tokens.css, pinned `data-theme=dark` until Phase 11.
- Verified: turbo build/typecheck/test 7/7; `--smoke` (now includes fast demo run) exit 0; **overlay screenshot visually confirmed** (dark pill, animated accent waveform, dimmed unstable tail).

### Phase 4 — done (2026-07-07)
Audio pipeline, mic → main process, per §13.1–13.4:
- **Renderer** (`src/renderer/src/audio/`): `capture.ts` `CaptureController` — getUserMedia (16 kHz mono, EC/NS/AGC, exact deviceId), `AudioContext({sampleRate:16000})` with explicit `resume()` (hidden window ⇒ may start suspended), worklet node, RMS + VAD per frame, frames posted to main over MessagePort; `vad.ts` — `Vad` interface + `EnergyVad` (threshold from vadSensitivity 0.2–0.8, 2-frame attack, 2 s hangover) + `frameRms`; `wire.ts` — receives the relayed port, obeys `audio:capture` events, live-follows micDeviceId/vadSensitivity settings.
- **Worklet**: `src/renderer/public/worklets/pcm-framer.js` — plain JS static asset (CSP stays `script-src 'self'`), 128-sample blocks → 320-sample (20 ms) Int16 frames, transferred to the renderer thread; posts `{dbg}` diagnostics on ctor/first-process.
- **Main**: `services/audio-bridge.ts` `AudioBridge` — `MessageChannelMain` handed to each renderer load via `webContents.postMessage('flow:audio-port')` (preload relays with `window.postMessage`), 15-frame (300 ms) pre-roll ring + `takePreRoll()`, `onFrame/onVad/onError` subscriptions for Phase 5, ~25 Hz `audio:level` broadcast → overlay waveform; `dictation/mic-check.ts` + tray "Mic check (5 s)" (real waveform in the pill); `WindowManager.pipeConsoleTo` (renderer console relay during smoke).
- Shared: new `audio:capture {active}` event channel.
- Smoke: `--smoke-mic` flag = real-capture assertion (≥25 frames/8 s). Passing on dev machine.
- **Gotchas fixed (do not regress)**: (1) AudioWorkletNode with no output path to `ctx.destination` is never pulled — node has 1 silent output connected to destination; (2) **Electron MessagePort transfer lists accept only MessagePorts** — transferring `pcm.buffer` throws; frames are copied (640 B) instead; (3) hidden-window AudioContext may start `suspended` — always `resume()`.
- Deviation: VAD is energy-based behind the `Vad` interface; **Silero ONNX upgrade pending** (onnxruntime-web + ~2 MB model) — slot into Phase 14 stabilization.
