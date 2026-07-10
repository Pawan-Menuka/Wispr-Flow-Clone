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
| 5 | Global hotkey layer (Windows first): uiohook-napi, hold/toggle detection, DictationController state machine | §14.1, §3.1 | done | 2026-07-07 (STT stub until Ph. 7) |
| 6 | Backend skeleton: NestJS + Fastify + Prisma schema + WS gateway with echo-STT stub, full session.* protocol | §9, §10, §18 | done | 2026-07-07 (Redis/Prisma-client wiring deferred) |
| 7 | Deepgram streaming STT integration + interim relay → end-to-end raw dictation shown in overlay | §12.1, §12.4, §13.6–13.7 | done | 2026-07-07 (echo E2E verified; live Deepgram untested — needs DEEPGRAM_API_KEY) |
| 8 | Insertion engine v1: tier-2 clipboard-swap paste + restore + per-app quirks table → first real insertion 🎉 | §14.3, §2 F5/F17 | done | 2026-07-07 |
| 9 | LLM formatting: Claude Haiku provider, prompt v1, degrade-to-raw path, golden fixture set | §12.2, §12.5 | done | 2026-07-07 (live goldens need ANTHROPIC_API_KEY) |
| 10 | Auth: magic link, JWT + refresh rotation, safeStorage, devices | §11, §17 | done | 2026-07-07 (DB migrate + Google OAuth pending — see notes) |
| 11 | Settings system: live-apply, settings UI shell, shortcut recorder, theme | §19, §5.4 | done | 2026-07-08 |
| 12 | Onboarding + permission flows + practice screen | §3.2, §5.2 | done | 2026-07-08 |
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

### Phase 5 — done (2026-07-07)
Hotkey layer + real DictationController (demo remains as a tray item):
- `src/main/hotkeys/chords.ts` — **pure** chord parser (no uiohook import ⇒ testable): `parseChord('Ctrl+Win') → ChordGroups` where each group lists left/right keycode variants; keycode table mirrors uiohook-napi's `UiohookKey` constants; lone letters/modifiers rejected, lone F-keys allowed; `chordSatisfied(groups, downKeys)`.
- `src/main/hotkeys/hotkey-service.ts` — uiohook-napi global hook (listen-only: **cannot swallow keys**, fine for modifier chords; note if a printable-key chord is ever default, revisit with a native hook); tracks down-keys set, emits dictate chord edge events + Escape; live re-registration via settings.onChange in index.ts; **hook not started in --smoke runs** (controller driven directly).
- `src/main/dictation/controller.ts` — `DictationController`, Electron-free with injected `ControllerDeps` (broadcast/show/hide/requestCapture/takePreRoll/getHotkeyMode). Semantics: chord-down begins (armed→capture w/ pre-roll); release <300 ms = tap → latches toggle (next tap or VAD-silence finishes); ≥300 ms release = PTT finish; `hotkeyMode:'toggle'` always latches; Esc cancels; VAD speaking → listening; no speech by finish → `no-speech` error (4 s linger); confirmed lingers 3 s; 5-min frame cap. `finalize()` is the Phase-7 seam — currently emits a stub result with voiced/captured seconds. `results.ts` holds `lastResult` (moved out of demo.ts).
- Tray: "Start / stop dictation" → `controller.toggle()`. IPC `dictation:cancel` → `controller.cancel()` (handlers ctx now takes controller).
- Smoke: `--smoke-mic` now also runs `smokeDictationLoop` — simulated chord hold 1.5 s with real capture, passes on either `result` or `no-speech` outcome. Passing (got `result`).
- Tests: `chords.test.ts` (7) + `controller.test.ts` (6, fake deps/timers: PTT happy path, tap-latch + silence finish, second-tap finish, no-speech, cancel, mic-loss). Desktop pkg now has vitest.
- **Watch item**: smoke's live loop yielded `result` from ambient noise → default vadSensitivity 0.5 (threshold ≈0.024 post-AGC) may be too hot; tune while dogfooding Phase 7.
- macOS parity (CGEventTap/Fn key, secure-input detection) deferred per project rules.

### Phase 6 — done (2026-07-07)
`apps/api` (NestJS 10 + Fastify, ESM/NodeNext) + infra:
- `src/main.ts` — Nest bootstrap (FastifyAdapter), `attachDictationGateway(app.getHttpServer())` after listen; `src/app.module.ts` + `modules/health/health.controller.ts` (GET /health → `{ok,version}`; verified live with curl).
- **WS gateway is plain `ws`, deliberately NOT a Nest gateway** (binary frames + zod-validated `t`-routing don't fit Nest's event model): `modules/dictation/gateway.ts` — `/v1/stream`, ping/pong heartbeat (2 misses → close 4000), injectable provider + heartbeatMs for tests; `modules/dictation/connection.ts` — `ClientConnection`, one active session per socket, full §18 handling: start→ready, binary frames via shared `decodeAudioFrame`, interims relayed, finish→result (`formatted:false` until Phase 9), cancel, resume→`ready{ackSeq}` or `SESSION_UNKNOWN`, malformed input → `system.notice` warn, rewrite/sync → explicit not-available notices; dangling session replaced on new start; close cancels stream.
- `modules/ai/stt.ts` — §12.4 provider abstraction (`SttProvider`/`SttStream`: sendAudio/finish→Promise<string>/cancel/onInterim/onError) + `EchoSttProvider` (interim every 25 frames, final = frame accounting). **Phase 7 = implement `DeepgramSttProvider` against this interface; gateway untouched.**
- `prisma/schema.prisma` — complete §10 schema (User/AuthProvider/Device/RefreshToken/Dictation/DictionaryEntry/Snippet/AppRule/Subscription/UsageEvent/StripeEvent/AuditLog). **`prisma generate`/`migrate` NOT run yet** (engine download deferred — flaky network; no DB code exists yet). `@prisma/client` dep added in Phase 10 when first used. `pnpm db:generate` / `db:migrate` scripts ready.
- `infra/docker-compose.dev.yml` — postgres:16 + redis:7. `.env.example` (PORT/DATABASE_URL/REDIS_URL/REQUIRE_AUTH=false). Redis client wiring deferred to first use (quota, Phase 7+). **WS upgrade auth is stubbed — anonymous allowed until Phase 10.**
- Tests: `gateway.test.ts` — 4 integration tests over a real socket (full session with 50 frames → 2 interims + correct result/duration; resume ack + unknown-session error; malformed-message notices; finish-without-session). Session code is Nest-free ⇒ no decorator-metadata issues under vitest/esbuild.
- Verified: turbo build/typecheck/test **11/11**; server booted, `GET /health` → `{"ok":true,"version":"0.0.1"}`.
- Dev scripts: `pnpm dev` (tsx watch) in apps/api; desktop connects in Phase 7.

### Phase 7 — done (2026-07-07)
Real STT pipeline, desktop↔API:
- **API** `modules/ai/deepgram.ts` — `DeepgramSttProvider` (wss://api.deepgram.com/v1/listen, linear16/16k, interim_results+smart_format+punctuate, model env `DEEPGRAM_MODEL` default nova-2, language passthrough unless 'auto', keywords param ready for Phase 15); `accumulateDeepgram()` pure accumulator (finals[] + partial → interim text/stableWords) with 3 unit tests; finish = CloseStream → await socket close (5 s cap) → joined finals. Provider selected in `main.ts`: `DEEPGRAM_API_KEY` set → deepgram, else echo (logged at boot).
- **Desktop** `services/ws-client.ts` — `WsClient` ('ws' pkg, main process): warm connection at boot, reconnect backoff 250 ms→4 s, `startSession()` returns `SttSessionHandle` (null when disconnected); handle queues audio until `session.ready` then flushes (server drops pre-ready binary); routes interim/result/error by sessionId; connection loss mid-session emits `NETWORK` error to the handle.
- **Controller** — stub `finalize()` replaced: begin() opens the WS session (null → immediate `network` error with overlay flash), streams every frame live during LISTENING (§12.5 parallelism), finish() sends `session.finish{lastSeq}` + 6 s result timeout → `network`; server interims → `dictation:interim`; ws error codes mapped (`QUOTA→quota-exceeded, UNAUTHORIZED→unauthorized, LLM_TIMEOUT→llm-timeout, NETWORK→network, else stt-failed`); `chordDownAt` regression caught by tests (begin() must stamp it or every release looks held).
- `FLOW_API_URL` env override (default `ws://127.0.0.1:8787/v1/stream`); appContext.processName='unknown' until Phase 16.
- Controller tests rewritten around `FakeStt` handle — 8 scenarios incl. interim relay, API-unreachable, server-error mapping, result timeout.
- Smoke: dictation loop now injects synthetic `onVad(true)` (tests transport, not VAD — quiet rooms were skipping the round-trip); accepts result/no-speech/network outcomes and prints result text.
- **Verified E2E on dev machine**: API (echo) + `electron . --smoke --smoke-mic` → `result: "[echo] received 1.1s of audio (56 frames)"` — full path mic→worklet→MessagePort→WsClient→gateway→provider→overlay. Turbo 11/11 green.
- **To go live**: set `DEEPGRAM_API_KEY` in apps/api `.env`, run api + desktop, hold Ctrl+Win and speak — everything else is wired. Not yet tested against real Deepgram (no key on this machine).

### Phase 12 — done (2026-07-08)
First-run onboarding (§3.2):
- Shared: `onboardingComplete` local setting (default false) gates the flow; App renders `Onboarding` until set (skipped in smoke unless `FLOW_SMOKE_ONBOARDING=1` forces it via `?onboarding=1`).
- `app/Onboarding.tsx` — 6 steps with progress dots: **Welcome** → **Sign in** (magic-link, reuses auth IPC; "Skip for now" allowed while REQUIRE_AUTH=false — flip to mandatory with auth enforcement) → **Mic permission** (privacy copy first, then real `capture.start`; denied → recovery panel with `ms-settings:privacy-microphone` deep link [added to openExternal allowlist] + Check again) → **Hotkey tutorial** (inline ShortcutRecorder rebind) → **Practice** (focused textarea; success = `dictation:result` event AND non-empty box; skippable) → **Done** → sets flag + `window.close()` (close-to-tray).
- **Tooling fix**: recurring `@flow/api` build/typecheck/test flake was three parallel `prisma generate` calls colliding on Windows file locks — generate is now a `db:generate` turbo task that build/typecheck/test `dependsOn` (removed from the api scripts); verified two consecutive clean runs.
- UI fix: progress dots were inline spans (width/height ignored) — dots container is flex now.
- Verified: turbo 12/12 ×2; smoke exit 0; onboarding Welcome screen **visually confirmed** (title, copy, CTA, dots).
- Deferred: macOS accessibility-permission step (§3.2 step 4) with mac parity; analytics `activation:first_insertion` event with Phase 20 telemetry; mic "Check again" 2 s auto-poll (manual button only).

### Phase 11 — done (2026-07-08)
Settings system + UI shell:
- **Shortcut recorder, main-process capture** (Win key never reaches renderers): `chords.ts` gained `formatChordFromKeys` (keycode set → canonical "Ctrl+Shift+F9", modifiers ordered, left/right merged, multi-non-modifier rejected, round-trips parseChord; 5 new tests); `HotkeyService.captureNextChord()` — capture mode suspends chord matching, accumulates peak key set, resolves on full release (Esc cancels, 10 s timeout); IPC `shortcut:beginCapture`/`cancelCapture` → `shortcut:captured {chord, conflict}` broadcast (conflict = commandHotkey collision). **Live capture needs a manual keyboard test — uiohook is off in smoke runs.**
- **packages/ui**: `controls.tsx` — `SettingsRow`/`Switch`(role=switch)/`Select`/`Slider` primitives; `flow-spin` keyframes added to tokens.css (Spinner referenced it undefined).
- **Renderer restructure** (`app/`): `App.tsx` = left-nav shell (Home | Settings) using tokens; `SettingsPage.tsx` — §5.4 subset: General (launchAtLogin/theme/overlayScale), Dictation (ShortcutRecorder, hotkeyMode, vadSensitivity slider, language, MicSection moved into `MicSection.tsx`), Formatting (fillerRemoval/spokenPunctuation/tone), Privacy (historyRetention/releaseMicImmediately/telemetry); `useSettings.ts` — optimistic `set` + `settings:changed` merge; `useTheme` — resolves `system` via prefers-color-scheme, sets `data-theme`.
- Live-apply additions in main: `launchAtLogin` → `app.setLoginItemSettings` (applied at boot too, skipped in smoke); hotkey/vad/mic re-apply paths existed since Phases 4–5.
- Smoke: `FLOW_SMOKE_CAPTURE_MAIN=<path>` screenshots the main window; smoke runs default to the Settings page; SmokeInsertTarget moved to App level (still present for --smoke-insert).
- Verified: turbo 11/11 (chord tests 12 total); smoke exit 0; **settings screenshot visually confirmed** (dark theme, nav, rows, kbd chips, slider).
- Note: settings keys not yet surfaced (overlayPosition reset, updateChannel, preferOffline, customInstructions, syncHistory, readAppContext, numberStyle, commandHotkey) arrive with their features.

### Phase 10 — done with pending items (2026-07-07)
Auth end-to-end (magic-link path), §11:
- **API** `modules/auth/`: `tokens.ts` — `TokenService` (jose **HS256** 15-min access JWTs; RS256+JWKS deferred until a second consumer exists), refresh/magic/oauth code generators, sha256 (raw tokens never stored); `auth.service.ts` — magic-code create/redeem (10-min TTL, single-use, hash keyed email:code), `upsertUser` (email links providers to one account), `issueTokens` (device create + entitlement-based device limit + rotation family), **refresh rotation with family-reuse revocation** (§11.3: replayed rotated token ⇒ whole family deleted + audit row), logout, `getMe` (profile + entitlements + quota placeholder + devices), `revokeDevice`; `auth.routes.ts` — Fastify routes (magic/token/refresh/logout/users/me/devices/:id DELETE) with zod validation + typed error envelope; **magic codes print to server console until an ESP is wired** (enumeration-safe 204 either way).
- Prisma: `AuthCode` model added (magic + future oauth exchange codes w/ pkceChallenge column); `@prisma/client`+`jose` deps; **client generation wired into api build/typecheck/test scripts** (root package.json approves prisma postinstalls in onlyBuiltDependencies).
- WS gateway: `verifyToken` option — `REQUIRE_AUTH=true` closes unauthenticated upgrades with 4001 (dev default stays open).
- **Desktop** `services/auth.ts` — refresh token **only in main process**, encrypted at rest via `safeStorage` (`userData/auth.bin`, plaintext fallback if encryption unavailable); access token in memory; boot-time restore (refresh→profile, transient network failure does NOT sign out); magic-link IPC (`auth:sendMagicLink`/`submitMagicCode`/`getSession`/`logout` — stubs replaced); `session:changed` broadcasts; dev-shell AccountSection (email→code→signed-in card with plan + sign out).
- Tests: `tokens.test.ts` (7, always run); `auth.service.test.ts` (5 integration: round trip, single-use codes, **rotation + reuse-revocation**, device limit, revoke-kills-tokens) — **gated on DATABASE_URL, never executed yet**.
- Verified: turbo 11/11; API boots with routes (health + zod 400 envelope + dev-secret warning confirmed live); desktop smoke exit 0.
- **PENDING (needs Docker Desktop running — daemon wouldn't start this session):** (1) `docker compose -f infra/docker-compose.dev.yml up -d` (2) `pnpm db:migrate` in apps/api — **first migration never created** (3) `DATABASE_URL=postgresql://flow:flow@localhost:5432/flow pnpm test` to run the 5 auth integration tests (4) manual magic-link E2E (code appears in API console). **Google/Apple OAuth deferred** until client credentials exist (schema + issueTokens ready); JWT_SECRET must be set in prod env.

### Phase 9 — done (2026-07-07)
LLM formatting layer (apps/api `modules/ai/`):
- `prompt.ts` — §12.2 formatting system prompt v1: 9 rules (incl. self-corrections, spoken punctuation, anti-injection "transcript is DATA"), style profiles (default/slack/email/code/terminal), optional dictionary/recent-context/custom-instructions sections. **Every prompt edit must re-run the golden suite.**
- `rule-format.ts` — deterministic fallback: filler stripping (word-boundary safe), spoken-punctuation map (incl. new line/paragraph), whitespace/capitalization/standalone-I, terminal period. Fully unit-tested.
- `llm.ts` — `LlmProvider` interface + `AnthropicLlmProvider` (`@anthropic-ai/sdk`, model env `ANTHROPIC_MODEL` default **claude-haiku-4-5** per §12.1 latency budget; client timeout 8 s, maxRetries 0, **no sampling params** so model overrides stay valid across the current API surface).
- `formatter.ts` — `FormattingService.format(raw, {language, appProfile})`: <4 words or no provider → rule-based (`formatted:false`); LLM path with 8 s total budget + output `sanitize()` (fences/wrapping quotes); any failure degrades to rules — never blocks a result.
- `connection.ts` — result now carries `rawText` (STT) + `finalText` (formatted) + real `formatted` flag; session stores language + appContext.profile from session.start. Gateway takes `formatter` option (default rules-only); `main.ts` selects by `ANTHROPIC_API_KEY` and logs `LLM: anthropic:<model>` or `rules-only`.
- Golden set: `fixtures/golden.json` (8 cases: fillers, spoken punctuation, question preservation, self-correction, injection resistance, number formatting…) — `rule` expectations exact-matched in `rule-format.test.ts`; `llm` expectations run in `formatter.test.ts` via `describe.skipIf(!ANTHROPIC_API_KEY)` with word-Dice similarity ≥0.75. **Live goldens never ran (no key) — run `ANTHROPIC_API_KEY=… pnpm test` in apps/api before trusting the prompt.**
- Verified: turbo 11/11; API tests 19 passed + 8 skipped (live); E2E smoke with API up → result flows through formatter (echo text rule-formatted, `formatted:false`).
- Env: `.env.example` gained DEEPGRAM_API_KEY/DEEPGRAM_MODEL/ANTHROPIC_API_KEY/ANTHROPIC_MODEL.

### Phase 8 — done (2026-07-07)
Tier-2 insertion engine (§14.3) + controller integration:
- `src/main/services/insertion.ts` — `InsertionService.insertText(text, processName)`: full-format clipboard snapshot (text/html/rtf/image) → writeText → 40 ms propagate → synthetic paste via **`uIOhook.keyTap(V, [Ctrl])`** (works without the hook started; Meta on darwin) → settle (default 150 ms, per-quirk) → restore snapshot (image wins; empty formats omitted; all-empty → clear). Failure path per §3.1: text left ON the clipboard + OS notification "press Ctrl+V". `inFlight` guard prevents overlapping pastes. `APP_QUIRKS` table seeded (windowsterminal/wt/mintty → Ctrl+Shift+V; notion.exe → 400 ms settle); keyed by lowercase process name — callers pass 'unknown' until Phase 16's focus tracker.
- Controller: result → `inserting` phase → `deps.insertText` → `confirmed`, or `insertion-failed` error ("Copied to clipboard — press Ctrl+V"); empty results skip insertion; late results after cancel are ignored (sessionId check).
- Safety: regular `--smoke` uses a fake insertText (never pastes into the user's focused app); **`--smoke-insert`** pastes into OUR OWN window: WindowManager loads renderers with `?smoke=1` → App renders an autofocused `SmokeInsertTarget` input that console-logs its value; check asserts pasted text arrived AND a clipboard sentinel was restored.
- Verified: turbo 11/11 (incl. 2 new controller tests: inserted-phase sequence, insertion-failure degrade); `--smoke --smoke-insert` exit 0 — real synthetic paste into own window + clipboard restore confirmed.
- Tier 1 (AX direct) and tier 3 (unicode keystrokes) + verification-by-reread deferred to the native-addon phases (16+). **Manual matrix testing (Notepad/Word/browsers/terminals) still pending — start `insertion-matrix.md` when dogfooding begins.**
