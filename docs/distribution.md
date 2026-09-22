# Distribution — installers, updates, signing (BLUEPRINT §14.4, §26, §3.4)

## Building installers

From `apps/desktop` (main repo, not a worktree — packaging reads `node_modules`):

```bash
pnpm dist       # NSIS installer → apps/desktop/release/Flow-Setup-<version>.exe
pnpm dist:dir   # unpacked app only — fast config sanity check
```

Config lives in `apps/desktop/electron-builder.yml`. Notes:

- `npmRebuild: false` — koffi and uiohook-napi ship N-API prebuilds; no toolchain needed.
- Native modules are `asarUnpack`ed; tray/app icons ship via `extraResources` (read from `process.resourcesPath`).
- The installer registers the `flowapp://` protocol (auth deep links).
- Installed builds start the anonymous dictation gateway themselves on
  `127.0.0.1:8787`; no terminal process, PostgreSQL, or Redis is required for
  dictation. Put `DEEPGRAM_API_KEY=...` in
  `%APPDATA%\\@flow\\desktop\\local-api.env` for real transcription (without it, the
  local echo provider is used). A configured `FLOW_API_URL` still selects a
  separately hosted API instead.
- On a development machine, import only the Deepgram settings from the API
  environment once with
  `Flow.exe --import-local-api-env=C:\\path\\to\\apps\\api\\.env`. The app
  copies no database, auth, billing, or telemetry credentials.
- Uninstaller keeps user data; a data-removal checkbox needs a custom NSIS include (deferred).

## Update channels (§26)

Feed: GitHub Releases on `Pawan-Menuka/Wispr-Flow-Clone`.

| Channel | How to release                      | Who gets it                                              |
| ------- | ----------------------------------- | -------------------------------------------------------- |
| stable  | normal release, tag `vX.Y.Z`        | everyone on `updateChannel: stable` (default)            |
| beta    | **prerelease**, tag `vX.Y.Z-beta.N` | users who set Settings → General → Update channel → Beta |

Cut a release: bump `version` in `apps/desktop/package.json` → `pnpm dist` → create the GitHub release for the tag and upload everything in `release/` (installer, `.blockmap`, `latest.yml` / `beta.yml`). electron-builder can do this directly with `electron-builder --publish always` + a `GH_TOKEN` env var (CI job planned in Phase 20).

**Staged rollout**: after publishing a stable release, edit `latest.yml` in the release assets and add `stagingPercentage: 10` → raise to 50 after 24 h (watch Sentry) → remove for 100%.

## Update behavior in the app (§3.4)

- Checks at launch (+30 s) and every 6 h; respects the `updateChannel` setting live.
- Downloads in the background; when staged, tray shows "Restart to update" and a toast fires. The app **never force-restarts** — the update applies on quit (`autoInstallOnAppQuit`) or via the explicit restart button (tray / Settings → App updates).
- Crash-loop guard: if the app exits before reaching 60 s uptime twice in a row, the next boot shows a safe-mode dialog and skips update checks for that run (`crash-guard.json` in userData). Reinstall-previous-installer rollback is deferred (needs an installer cache).
- Dev/unpackaged builds never check; the settings row reports this if asked.

## Code signing (env-gated — nothing signs until credentials exist)

**Windows — Azure Trusted Signing** (chosen in §14.4; ~$10/mo, no dongle):

1. Create a Trusted Signing account + certificate profile in Azure.
2. Uncomment `win.azureSignOptions` in `electron-builder.yml` and fill in the account/profile.
3. Provide `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` in the CI environment.

**macOS — Developer ID + notarization** ($99/yr):

1. Install the Developer ID Application cert in the CI keychain (`CSC_LINK`/`CSC_KEY_PASSWORD`).
2. Set `notarize: true` in `electron-builder.yml` (or `mac.notarize: { teamId }`).
3. Provide `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
4. Hardened-runtime entitlements are already in `build/entitlements.mac.plist` (JIT + mic).

Unsigned builds install fine for dogfooding (SmartScreen "More info → Run anyway"), but **electron-updater on Windows refuses a publisher-name mismatch only when the old build was signed** — ship signed from the first public build so updates verify signatures end-to-end.
