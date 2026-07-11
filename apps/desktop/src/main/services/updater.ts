import { Notification, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '@flow/shared';
import type { WindowManager } from '../windows';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // §3.4: launch + every 6 h
const INITIAL_DELAY_MS = 30_000;

export type UpdateChannel = 'stable' | 'beta';

/**
 * electron-updater wrapper (§3.4, F23). Background download, tray/renderer
 * status via `update:status`, applied on quit or explicit restart — the app
 * never force-restarts itself.
 */
export class UpdaterService {
  private status: UpdateStatus = { state: 'idle' };
  private readonly listeners = new Set<(status: UpdateStatus) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private wired = false;

  constructor(
    private readonly windows: WindowManager,
    private readonly getChannel: () => UpdateChannel,
  ) {}

  /** Wire events and schedule the launch + 6-hourly checks. */
  start(): void {
    if (!app.isPackaged) {
      console.log('[updater] unpackaged build — periodic checks disabled');
      return;
    }
    this.wire();
    setTimeout(() => this.checkNow(), INITIAL_DELAY_MS);
    this.timer = setInterval(() => this.checkNow(), CHECK_INTERVAL_MS);
    app.on('before-quit', () => {
      if (this.timer) clearInterval(this.timer);
    });
  }

  checkNow(): void {
    if (!app.isPackaged) {
      this.setStatus({ state: 'error', message: 'Updates are available only in installed builds' });
      return;
    }
    if (this.status.state === 'checking' || this.status.state === 'downloading') return;
    this.wire();
    this.applyChannel();
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      this.setStatus({ state: 'error', message: errorMessage(err) });
    });
  }

  /** Explicit restart-to-update (tray item / settings button). */
  installNow(): void {
    if (this.status.state !== 'ready') return;
    this.windows.isQuitting = true;
    autoUpdater.quitAndInstall();
  }

  /** Channel changed in settings — re-evaluate against the new feed. */
  setChannel(channel: UpdateChannel): void {
    if (!app.isPackaged) return;
    this.wire();
    this.applyChannel(channel);
    this.checkNow();
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  onStatus(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyChannel(channel = this.getChannel()): void {
    // GitHub releases feed: beta builds are published as prereleases
    // versioned `x.y.z-beta.n` (docs/distribution.md).
    autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest';
    autoUpdater.allowPrerelease = channel === 'beta';
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // "applied on quit" (§3.4.2)
    autoUpdater.disableWebInstaller = true;

    autoUpdater.on('checking-for-update', () => this.setStatus({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.setStatus({ state: 'idle' }));
    autoUpdater.on('update-available', () => this.setStatus({ state: 'downloading', pct: 0 }));
    autoUpdater.on('download-progress', (progress) =>
      this.setStatus({ state: 'downloading', pct: Math.round(progress.percent) }),
    );
    autoUpdater.on('update-downloaded', (info) => {
      this.setStatus({ state: 'ready', version: info.version });
      if (Notification.isSupported()) {
        new Notification({
          title: 'Flow update ready',
          body: `Version ${info.version} will apply when Flow restarts — no rush.`,
        }).show();
      }
    });
    autoUpdater.on('error', (err) => this.setStatus({ state: 'error', message: errorMessage(err) }));
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    this.windows.broadcast('update:status', status);
    for (const listener of this.listeners) listener(status);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
