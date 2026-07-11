# Observability — crash reporting, telemetry, logging, CI (BLUEPRINT §21–25)

## Hard rule (§15.1, enforced)

**Transcript text and window titles never appear in any log line, telemetry
event, or crash report.** Enforced three ways:

- Source-level: `log-hygiene.test.ts` (in both `apps/api/src/obs/` and
  `apps/desktop/src/main/`) fails the build if any `console.*` call references
  a transcript-bearing identifier.
- Runtime: every structured API log goes through `redact()`
  ([apps/api/src/obs/redact.ts](../apps/api/src/obs/redact.ts)) — drops
  text/credential keys, hashes emails and process names.
- Review rule: telemetry `capture()` accepts only counts/durations/booleans/enums.

## Crash reporting (Sentry, env-gated)

No DSN → permanent no-op; nothing initializes.

| Side | Env var | Where |
|---|---|---|
| API | `SENTRY_DSN` | `apps/api/src/main.ts` (`@sentry/node`) |
| Desktop | `FLOW_SENTRY_DSN` (baked at build) | `src/main/services/crash-reporting.ts` (`@sentry/electron`) |

Both scrub before send: no `extra`, no request bodies, IPC breadcrumbs dropped.
Crash recovery (§24): main-process `uncaughtException` → log + relaunch once;
the Phase 19 crash guard turns repeat crashes into safe mode.

## Telemetry (PostHog, doubly gated)

`src/main/services/telemetry.ts` — zero-dep HTTP batching to PostHog EU.
Sends only when **both** hold: the user's `telemetry` setting is on AND
`FLOW_POSTHOG_KEY` was baked in at build time (dev builds never phone home).
Identity is a random install UUID (`userData/telemetry-id`), no account linkage.
Events (§23 vocabulary): `dictation_completed {durationMs, language}`,
`dictation_failed {kind}`, `activation_first_insertion`.

## Logging

- **Desktop**: electron-log rotating files (5 MB) in the OS logs dir
  (Settings → the `app:openLogsFolder` IPC opens it). One `[metrics]` line per
  dictation with stage timings (`armed→listening→processing→inserting→done`),
  produced by `src/main/services/metrics.ts`. Skipped in `--smoke` runs.
- **API**: one `[obs] {"event":"session.completed", durationMs, latencyMs,
  words, formatted, profile}` line per session — the §12.5 latency SLO dataset.
  Magic-code console output is dev-only (`NODE_ENV !== 'production'`).

## CI (`.github/workflows/`)

- **ci.yml** (every PR + pushes to main/Develop): ubuntu job with a real
  Postgres 16 service — `prisma db push` then `turbo build typecheck lint test`,
  which unlocks the previously never-run DB-gated integration suites (auth
  rotation ×5, sync routes ×4, stripe lifecycle ×2); then
  `pnpm audit --prod --audit-level high` (repo is currently at **zero known
  vulnerabilities** after the Nest 11 / Fastify 5 upgrade). Second job:
  Electron smoke test on windows-latest.
- **release-desktop.yml** (tag `v*`): builds the NSIS installer, uploads it to
  a **draft** GitHub release with the updater feed files, then smoke-tests the
  packaged exe. Publish the draft manually (see docs/distribution.md).
