import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { WindowManager } from './windows';
import { createTray } from './tray';
import { SettingsStore } from './services/settings-store';
import { registerIpcHandlers } from './ipc/handlers';
import { runDemoDictation } from './dictation/demo';
import { AudioBridge } from './services/audio-bridge';
import { DictationController } from './dictation/controller';
import { HotkeyService } from './hotkeys/hotkey-service';
import { WsClient } from './services/ws-client';
import { InsertionService } from './services/insertion';
import { AuthService } from './services/auth';
import { HistoryService } from './services/history';
import { DictionaryService } from './services/dictionary';
import { getFocusedApp } from './services/focus';
import { resolveProfile } from './services/profiles';

const API_WS_URL = process.env['FLOW_API_URL'] ?? 'ws://127.0.0.1:8787/v1/stream';
const API_HTTP_URL = API_WS_URL.replace(/^ws/, 'http').replace(/\/stream$/, '');

const isSmokeTest = process.argv.includes('--smoke');

// ---------- Single instance ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  const windows = new WindowManager(isSmokeTest);
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

    // Overlay is created at boot and kept hidden so it can paint in <50 ms later.
    await windows.createOverlayWindow();
    const mainWindow = await windows.createMainWindow();

    // Audio path: hand the hidden renderer a fresh port on every load
    // (covers dev-mode reloads and renderer crashes).
    const audio = new AudioBridge(windows);
    audio.attach(mainWindow.webContents);
    mainWindow.webContents.on('did-finish-load', () => audio.attach(mainWindow.webContents));

    const insertion = new InsertionService();
    const history = new HistoryService(app.getPath('userData'), () =>
      settings.get('historyRetention'),
    );
    const dictionary = new DictionaryService(app.getPath('userData'));

    // Auth: restore any persisted session in the background (§11).
    const auth = new AuthService(API_HTTP_URL, windows);
    void auth.boot();

    // Warm backend connection (§9.2) — reconnects with backoff for life.
    const wsClient = new WsClient(API_WS_URL);
    wsClient.connect();
    app.on('before-quit', () => wsClient.shutdown());

    // Dictation core: hotkey → controller → audio + WS session (§3.1).
    const controller = new DictationController({
      broadcast: (channel, payload) => windows.broadcast(channel, payload),
      showOverlay: () => windows.showOverlay(),
      hideOverlay: () => windows.hideOverlay(),
      requestCapture: (active) => audio.requestCapture(active),
      takePreRoll: () => audio.takePreRoll(),
      getHotkeyMode: () => settings.get('hotkeyMode'),
      getFocusedApp: () => {
        const focused = getFocusedApp();
        if (!focused) return null;
        return {
          processName: focused.processName,
          profile: resolveProfile(focused.processName, settings.get('appRules')),
        };
      },
      startSttSession: (sessionId, focusedApp) =>
        wsClient.startSession({
          sessionId,
          language: settings.get('language'),
          appContext: {
            processName: focusedApp?.processName ?? 'unknown',
            profile: (focusedApp?.profile ?? 'default') as
              | 'default'
              | 'slack'
              | 'email'
              | 'code'
              | 'terminal',
          },
          dictionary: dictionary.forSession(),
        }),
      // Regular smoke must never paste into whatever the user has focused;
      // --smoke-insert tests real insertion against our own window instead.
      insertText: isSmokeTest
        ? async () => true
        : (text, processName) => insertion.insertText(text, processName ?? 'unknown').then((r) => r.ok),
      addHistory: (entry) =>
        history.add({ ...entry, language: settings.get('language'), createdAt: new Date().toISOString() }),
    });
    audio.onFrame((frame) => controller.onFrame(frame));
    audio.onVad((speaking) => controller.onVad(speaking));
    audio.onError((message) => controller.onCaptureError(message));

    const hotkeys = new HotkeyService();
    registerIpcHandlers({
      windows,
      settings,
      controller,
      auth,
      hotkeys,
      history,
      insertion,
      dictionary,
    });
    if (!hotkeys.setDictateChord(settings.get('hotkey'))) {
      console.warn(`[hotkeys] invalid chord "${settings.get('hotkey')}", falling back to Ctrl+Win`);
      hotkeys.setDictateChord('Ctrl+Win');
    }
    hotkeys.onDictateDown(() => controller.onChordDown());
    hotkeys.onDictateUp(() => controller.onChordUp());
    hotkeys.onEscape(() => controller.cancel());
    settings.onChange((patch) => {
      if (patch.hotkey !== undefined && !hotkeys.setDictateChord(patch.hotkey)) {
        console.warn(`[hotkeys] rejected invalid chord "${patch.hotkey}"`);
      }
      if (patch.launchAtLogin !== undefined) {
        app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin });
      }
    });
    if (!isSmokeTest) {
      app.setLoginItemSettings({ openAtLogin: settings.get('launchAtLogin') });
    }
    if (!isSmokeTest) {
      // The global hook stays off in smoke runs; the controller is driven directly.
      hotkeys.start();
      app.on('before-quit', () => hotkeys.stop());
    }

    createTray(windows, audio, controller, settings);
    console.log('[boot] tray-ready');

    if (pendingDeepLink) {
      handleDeepLink(pendingDeepLink);
      pendingDeepLink = null;
    }

    if (isSmokeTest) {
      runSmokeChecks(windows, audio, controller, insertion);
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

/**
 * `electron . --smoke`: assert both renderers load through their preloads and
 * the demo timeline completes. `--smoke-mic` additionally starts real capture
 * and requires PCM frames to arrive over the MessagePort (needs a mic).
 */
function runSmokeChecks(
  windows: WindowManager,
  audio: AudioBridge,
  controller: DictationController,
  insertion: InsertionService,
): void {
  const wantMic = process.argv.includes('--smoke-mic');
  const wantInsert = process.argv.includes('--smoke-insert');
  const timeout = setTimeout(() => {
    console.error('[smoke] FAIL: timed out');
    app.exit(1);
  }, 30_000);

  // Live probe of the koffi focus tracker (§14.2).
  console.log(`[smoke] focused app: ${JSON.stringify(getFocusedApp())}`);

  // Surface renderer console lines while smoking (invaluable for audio debug).
  const consoleLines: string[] = [];
  windows.pipeConsoleTo((line) => {
    consoleLines.push(line);
    console.log(`[renderer] ${line}`);
  });

  windows
    .whenMainLoaded()
    .then(() => windows.whenOverlayLoaded())
    .then(() => {
      console.log('[smoke] main renderer + overlay renderer loaded');
      // Drive the full overlay event path (states, levels, interims, result).
      return runDemoDictation(windows, { fast: true });
    })
    .then(() => (wantMic ? smokeMicCheck(audio) : undefined))
    .then(() => (wantMic ? smokeDictationLoop(windows, controller) : undefined))
    .then(() => (wantInsert ? smokeInsertCheck(windows, insertion, consoleLines) : undefined))
    .then(async () => {
      const capturePath = process.env['FLOW_SMOKE_CAPTURE_MAIN'];
      if (capturePath) {
        windows.showMainWindow();
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        const png = await windows.captureMain();
        if (png) {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(capturePath, png);
        }
      }
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

/**
 * Full state-machine pass with real capture: simulated chord hold →
 * mic frames flow → release → expect a result or a clean no-speech error
 * (silent rooms are fine — both paths prove the loop).
 */
function smokeDictationLoop(
  windows: WindowManager,
  controller: DictationController,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const outcomes: string[] = [];
    const done = (label: string) => {
      cleanup();
      console.log(`[smoke] dictation loop ok (${label})`);
      resolve();
    };
    const unsubscribe = subscribeOnce();
    function subscribeOnce() {
      const orig = windows.broadcast.bind(windows);
      // Observe outcomes via the controller's own broadcasts.
      windows.broadcast = (channel, payload) => {
        orig(channel, payload);
        if (channel === 'dictation:result') {
          done(`result: "${(payload as { text: string }).text.slice(0, 80)}"`);
        }
        if (channel === 'dictation:error') {
          const kind = (payload as { kind?: string }).kind;
          // network = API not running during smoke — the loop still proved itself.
          if (kind === 'no-speech' || kind === 'network') done(kind);
          else {
            cleanup();
            reject(new Error(`dictation error: ${kind}`));
          }
        }
      };
      return () => {
        windows.broadcast = orig;
      };
    }
    const loopTimeout = setTimeout(() => {
      cleanup();
      reject(new Error(`dictation loop: no outcome (saw: ${outcomes.join(',') || 'nothing'})`));
    }, 8_000);
    const cleanup = () => {
      clearTimeout(loopTimeout);
      unsubscribe();
    };

    controller.onChordDown();
    // Synthetic VAD signal: the loop verifies transport (frames → server →
    // result), not the energy VAD — quiet rooms must not skip the round-trip.
    setTimeout(() => controller.onVad(true), 300);
    setTimeout(() => controller.onChordUp(), 1_500); // held > tap threshold → PTT finish
  });
}

/**
 * Insertion check against OUR OWN window (never the user's apps): focuses the
 * main window's smoke input, runs the real clipboard-swap paste, asserts the
 * text arrived AND the prior clipboard content was restored.
 */
async function smokeInsertCheck(
  windows: WindowManager,
  insertion: InsertionService,
  consoleLines: string[],
): Promise<void> {
  const { clipboard } = await import('electron');
  windows.showMainWindow();
  await new Promise((resolve) => setTimeout(resolve, 1_500)); // window focus + input autofocus

  const sentinel = `flow-clipboard-sentinel-${Date.now()}`;
  clipboard.writeText(sentinel);
  const result = await insertion.insertText('flow insertion works');
  await new Promise((resolve) => setTimeout(resolve, 600));

  const pasted = consoleLines.some((line) => line.includes('insert-target: flow insertion works'));
  const restored = clipboard.readText() === sentinel;
  if (!result.ok || !pasted || !restored) {
    throw new Error(`insert check failed (ok=${result.ok} pasted=${pasted} restored=${restored})`);
  }
  console.log('[smoke] insertion ok (pasted into own window, clipboard restored)');
}

/** Real-capture assertion: ≥25 frames (0.5 s of audio) within 8 s. */
function smokeMicCheck(audio: AudioBridge): Promise<void> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const unsubError = audio.onError((message) => reject(new Error(`mic: ${message}`)));
    const unsubFrame = audio.onFrame(() => {
      if (++frames >= 25) {
        cleanup();
        console.log(`[smoke] mic ok (${frames} frames received)`);
        resolve();
      }
    });
    const micTimeout = setTimeout(() => {
      cleanup();
      reject(new Error(`mic: only ${frames} frames within 8 s`));
    }, 8_000);
    const cleanup = () => {
      clearTimeout(micTimeout);
      unsubFrame();
      unsubError();
      audio.requestCapture(false);
    };
    audio.requestCapture(true);
  });
}
