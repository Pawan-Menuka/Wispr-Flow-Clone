import fs from 'node:fs';
import path from 'node:path';
import type { Settings, SyncedDoc, SyncedSettings } from '@flow/shared';
import { SYNCED_SETTING_KEYS, mergeSyncedDocs, pickSyncedSettings } from '@flow/shared';
import type { AuthService } from './auth';
import type { SettingsStore } from './settings-store';
import type { WindowManager } from '../windows';

/**
 * Settings sync client (§19.4). Local-first: every synced-key change is
 * stamped and debounced into a PUT; version conflicts pull the server doc
 * and merge per key (shared mergeSyncedDocs); remote-won keys are applied
 * to the local store without re-triggering a push. Signed-out = dormant.
 */

const PUSH_DEBOUNCE_MS = 2_000;
const RETRY_MS = 30_000;

interface SyncMeta {
  stamps: Record<string, string>;
  lastVersion: number;
}

export class SyncService {
  private meta: SyncMeta = { stamps: {}, lastVersion: 0 };
  private readonly metaPath: string;
  private dirty = false;
  private applyingRemote = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly auth: AuthService,
    private readonly settings: SettingsStore,
    private readonly windows: WindowManager,
    dir: string,
  ) {
    this.metaPath = path.join(dir, 'sync-meta.json');
    this.loadMeta();
  }

  start(): void {
    this.settings.onChange((patch) => {
      if (this.applyingRemote) return;
      const changedSynced = Object.keys(patch).filter((key) =>
        (SYNCED_SETTING_KEYS as readonly string[]).includes(key),
      );
      if (changedSynced.length === 0) return;
      const now = new Date().toISOString();
      for (const key of changedSynced) this.meta.stamps[key] = now;
      this.dirty = true;
      this.persistMeta();
      this.schedulePush();
    });

    this.auth.onSession((session) => {
      if (session) void this.pull();
    });
    if (this.auth.getSession()) void this.pull();
  }

  /** Boot/sign-in reconciliation: fetch, merge, adopt remote wins, push local wins. */
  async pull(): Promise<void> {
    const token = this.auth.getAccessToken();
    if (!token) return;
    try {
      const response = await fetch(`${this.apiBaseUrl}/sync/settings`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`pull failed (${response.status})`);
      const remote = (await response.json()) as SyncedDoc;
      this.meta.lastVersion = remote.version;

      const merged = mergeSyncedDocs(
        { values: pickSyncedSettings(this.settings.snapshot()), stamps: this.meta.stamps },
        { values: remote.values, stamps: remote.stamps },
      );
      this.applyRemote(merged.applyLocally, merged.stamps);

      // Local had newer keys than the server copy → publish them.
      if (JSON.stringify(merged.values) !== JSON.stringify(remote.values)) {
        this.dirty = true;
        this.schedulePush(0);
      } else {
        this.setStatus('synced');
      }
    } catch {
      this.setStatus('offline');
      this.scheduleRetry();
    }
  }

  private schedulePush(delay = PUSH_DEBOUNCE_MS): void {
    this.setStatus('pending');
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push(), delay);
  }

  private async push(attempt = 0): Promise<void> {
    if (!this.dirty) return;
    const token = this.auth.getAccessToken();
    if (!token) return; // signed out — stays pending until next session

    const body = {
      values: pickSyncedSettings(this.settings.snapshot()),
      stamps: this.meta.stamps,
      baseVersion: this.meta.lastVersion,
    };
    try {
      const response = await fetch(`${this.apiBaseUrl}/sync/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (response.status === 409 && attempt === 0) {
        const conflict = (await response.json()) as { doc: SyncedDoc };
        const merged = mergeSyncedDocs(
          { values: body.values, stamps: this.meta.stamps },
          { values: conflict.doc.values, stamps: conflict.doc.stamps },
        );
        this.applyRemote(merged.applyLocally, merged.stamps);
        this.meta.lastVersion = conflict.doc.version;
        this.persistMeta();
        return this.push(1);
      }
      if (response.status === 401 && attempt === 0) {
        const refreshed = await this.auth.refreshNow();
        if (refreshed) return this.push(1);
        throw new Error('unauthorized');
      }
      if (!response.ok) throw new Error(`push failed (${response.status})`);

      const { version } = (await response.json()) as { version: number };
      this.meta.lastVersion = version;
      this.dirty = false;
      this.persistMeta();
      this.setStatus('synced');
    } catch {
      this.setStatus('offline');
      this.scheduleRetry();
    }
  }

  private applyRemote(patch: Partial<SyncedSettings>, stamps: Record<string, string>): void {
    this.applyingRemote = true;
    try {
      for (const [key, value] of Object.entries(patch)) {
        this.settings.set(key as keyof Settings, value as Settings[keyof Settings]);
      }
      this.meta.stamps = { ...this.meta.stamps, ...stamps };
      this.persistMeta();
    } finally {
      this.applyingRemote = false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.dirty) void this.push();
      else void this.pull();
    }, RETRY_MS);
  }

  private setStatus(status: 'synced' | 'pending' | 'offline'): void {
    this.windows.broadcast('sync:status', status);
  }

  private loadMeta(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.metaPath, 'utf8')) as SyncMeta;
      if (raw && typeof raw.lastVersion === 'number') this.meta = raw;
    } catch {
      /* fresh start */
    }
  }

  private persistMeta(): void {
    const tmpPath = `${this.metaPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.meta), 'utf8');
    fs.renameSync(tmpPath, this.metaPath);
  }
}
