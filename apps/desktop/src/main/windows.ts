import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { EventChannel, FlowEvents } from '@flow/shared';
import { OVERLAY_EVENT_ALLOWLIST } from '@flow/shared';

const PRELOAD_DIR = path.join(__dirname, '../preload');
const RENDERER_DIR = path.join(__dirname, '../renderer');

/** Hardened defaults shared by every window (BLUEPRINT §7.3 / §15). */
const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
} as const;

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private overlayWindow: BrowserWindow | null = null;
  private mainLoaded: Promise<void> | null = null;
  private overlayLoaded: Promise<void> | null = null;
  isQuitting = false;

  constructor(private readonly smokeMode = false) {}

  async createMainWindow(): Promise<BrowserWindow> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow;

    const win = new BrowserWindow({
      width: 980,
      height: 640,
      minWidth: 880,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#161618',
      webPreferences: {
        ...SECURE_WEB_PREFERENCES,
        preload: path.join(PRELOAD_DIR, 'index.js'),
      },
    });

    // Close-to-tray: hide instead of destroying (tray is the app's home).
    win.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        win.hide();
      }
    });

    this.mainWindow = win;
    this.mainLoaded = this.loadRenderer(win, 'index.html');
    await this.mainLoaded;
    return win;
  }

  async createOverlayWindow(): Promise<BrowserWindow> {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) return this.overlayWindow;

    const win = new BrowserWindow({
      width: 380,
      height: 110, // pill + action-chips row
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      closable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false, // must NEVER steal focus or the insertion target is lost
      hasShadow: false,
      webPreferences: {
        ...SECURE_WEB_PREFERENCES,
        preload: path.join(PRELOAD_DIR, 'overlay.js'),
        backgroundThrottling: false, // waveform must stay at 60 fps while visible
      },
    });

    // Above fullscreen apps where possible (BLUEPRINT §2 F6).
    win.setAlwaysOnTop(true, 'screen-saver');
    this.positionOverlay(win);

    this.overlayWindow = win;
    this.overlayLoaded = this.loadRenderer(win, 'overlay.html');
    await this.overlayLoaded;
    return win;
  }

  /** Bottom-center of the display containing the cursor. */
  private positionOverlay(win: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    const [w, h] = win.getSize();
    win.setPosition(Math.round(x + (width - (w ?? 380)) / 2), Math.round(y + height - (h ?? 110) - 40));
  }

  private async loadRenderer(win: BrowserWindow, page: string): Promise<void> {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    const query: Record<string, string> = {};
    if (this.smokeMode) query['smoke'] = '1';
    if (process.env['FLOW_SMOKE_ONBOARDING']) query['onboarding'] = '1';
    if (process.env['FLOW_SMOKE_PAGE']) query['page'] = process.env['FLOW_SMOKE_PAGE'];
    const search = Object.keys(query).length
      ? `?${new URLSearchParams(query).toString()}`
      : '';
    if (devUrl) {
      await win.loadURL(`${devUrl}/${page}${search}`);
    } else {
      await win.loadFile(path.join(RENDERER_DIR, page), search ? { query } : {});
    }
  }

  showMainWindow(): void {
    void this.createMainWindow().then((win) => {
      win.show();
      win.focus();
    });
  }

  showOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
    this.positionOverlay(this.overlayWindow);
    this.overlayWindow.showInactive(); // never focus
  }

  hideOverlay(): void {
    this.overlayWindow?.hide();
  }

  /** Debug/smoke helper: relay renderer console output. */
  pipeConsoleTo(sink: (line: string) => void): void {
    this.mainWindow?.webContents.on('console-message', (_e, _level, message) => {
      sink(message);
    });
  }

  /** Debug/smoke helper: PNG snapshot of the overlay window contents. */
  async captureOverlay(): Promise<Buffer | null> {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return null;
    const image = await this.overlayWindow.webContents.capturePage();
    return image.toPNG();
  }

  /** Debug/smoke helper: PNG snapshot of the main window contents. */
  async captureMain(): Promise<Buffer | null> {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return null;
    const image = await this.mainWindow.webContents.capturePage();
    return image.toPNG();
  }

  isOverlaySender(webContentsId: number): boolean {
    return this.liveId(this.overlayWindow) === webContentsId;
  }

  isKnownSender(webContentsId: number): boolean {
    return (
      this.liveId(this.mainWindow) === webContentsId ||
      this.liveId(this.overlayWindow) === webContentsId
    );
  }

  private liveId(win: BrowserWindow | null): number | null {
    return win && !win.isDestroyed() ? win.webContents.id : null;
  }

  /** Typed main→renderer event fanout; overlay only receives allowlisted channels. */
  broadcast<K extends EventChannel>(channel: K, payload: FlowEvents[K]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
    if (
      this.overlayWindow &&
      !this.overlayWindow.isDestroyed() &&
      (OVERLAY_EVENT_ALLOWLIST as readonly string[]).includes(channel)
    ) {
      this.overlayWindow.webContents.send(channel, payload);
    }
  }

  whenMainLoaded(): Promise<void> {
    return this.mainLoaded ?? Promise.reject(new Error('main window not created'));
  }

  whenOverlayLoaded(): Promise<void> {
    return this.overlayLoaded ?? Promise.reject(new Error('overlay window not created'));
  }
}
