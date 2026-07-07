import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { WindowManager } from './windows';
import { createTray } from './tray';
import { SettingsStore } from './services/settings-store';
import { registerIpcHandlers } from './ipc/handlers';
import { runDemoDictation } from './dictation/demo';

const isSmokeTest = process.argv.includes('--smoke');

// ---------- Single instance ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  const windows = new WindowManager();
  let pendingDeepLink: string | null = extractDeepLink(process.argv);

  // ---------- Deep links (flowapp://) ----------
  if (process.defaultApp && process.argv[1]) {
    // Dev mode: `electron .` needs explicit args for protocol registration.
    app.setAsDefaultProtocolClient('flowapp', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('flowapp');
  }

  app.on('second-instance', (_event, argv) => {
    const link = extractDeepLink(argv);
    if (link) handleDeepLink(link);
    windows.showMainWindow();
  });

  app.on('open-url', (event, url) => {
    // macOS delivers deep links here.
    event.preventDefault();
    if (app.isReady()) handleDeepLink(url);
    else pendingDeepLink = url;
  });

  function handleDeepLink(url: string): void {
    // Phase 10 (auth) consumes flowapp://auth/callback. For now: log the route only —
    // never the query string (it will carry one-time auth codes).
    try {
      const parsed = new URL(url);
      console.log(`[deep-link] ${parsed.protocol}//${parsed.host}${parsed.pathname}`);
    } catch {
      console.warn('[deep-link] unparseable URL received');
    }
  }

  // ---------- Lifecycle ----------
  app.whenReady().then(async () => {
    const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    registerIpcHandlers({ windows, settings });

    // Overlay is created at boot and kept hidden so it can paint in <50 ms later.
    await windows.createOverlayWindow();
    const mainWindow = await windows.createMainWindow();
    createTray(windows);
    console.log('[boot] tray-ready');

    if (pendingDeepLink) {
      handleDeepLink(pendingDeepLink);
      pendingDeepLink = null;
    }

    if (isSmokeTest) {
      runSmokeChecks(windows);
    } else {
      // Until onboarding exists (Phase 12), show the main window on launch.
      mainWindow.show();
    }
  });

  // Tray-first app: closing all windows must NOT quit.
  app.on('window-all-closed', () => {
    /* keep running in tray */
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void windows.createMainWindow();
    windows.showMainWindow();
  });

  app.on('before-quit', () => {
    windows.isQuitting = true;
  });
}

function extractDeepLink(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith('flowapp://')) ?? null;
}

/** `electron . --smoke`: assert both renderers load through their preloads, then exit. */
function runSmokeChecks(windows: WindowManager): void {
  const timeout = setTimeout(() => {
    console.error('[smoke] FAIL: timed out waiting for renderers');
    app.exit(1);
  }, 15_000);

  windows
    .whenMainLoaded()
    .then(() => {
      console.log('[smoke] main renderer loaded');
      return windows.whenOverlayLoaded();
    })
    .then(() => {
      console.log('[smoke] main renderer + overlay renderer loaded');
      // Drive the full overlay event path (states, levels, interims, result).
      return runDemoDictation(windows, { fast: true });
    })
    .then(() => {
      clearTimeout(timeout);
      console.log('[smoke] ok: tray-ready, renderers loaded, demo dictation completed');
      app.exit(0);
    })
    .catch((err: unknown) => {
      clearTimeout(timeout);
      console.error('[smoke] FAIL:', err);
      app.exit(1);
    });
}
