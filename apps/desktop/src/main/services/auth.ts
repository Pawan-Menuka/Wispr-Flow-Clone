import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { DeviceInfo, SessionInfo } from '@flow/shared';
import { entitlementsFor } from '@flow/shared';
import type { WindowManager } from '../windows';

/**
 * Desktop auth (BLUEPRINT §11): the refresh token lives ONLY in the main
 * process, encrypted at rest via safeStorage (DPAPI/Keychain). The access
 * token stays in memory. Renderers see SessionInfo, never tokens.
 */

interface StoredAuth {
  refreshToken: string;
  device: { id: string; name: string; platform: string };
}

export class AuthService {
  private accessToken: string | null = null;
  private session: SessionInfo | null = null;
  private stored: StoredAuth | null = null;
  private readonly storePath: string;

  constructor(
    private readonly apiBaseUrl: string, // e.g. http://127.0.0.1:8787/v1
    private readonly windows: WindowManager,
  ) {
    this.storePath = path.join(app.getPath('userData'), 'auth.bin');
  }

  getSession(): SessionInfo | null {
    return this.session;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Restore a persisted session at boot (refresh → profile). Never throws. */
  async boot(): Promise<void> {
    try {
      this.stored = this.load();
      if (!this.stored) return;
      await this.refresh();
      await this.fetchProfile();
    } catch (err) {
      console.warn('[auth] session restore failed:', err instanceof Error ? err.message : err);
      // Keep stored token: transient network failure shouldn't sign the user out.
    }
  }

  async sendMagicLink(email: string): Promise<void> {
    await this.post('/auth/magic', { email }, false);
  }

  async submitMagicCode(email: string, code: string): Promise<SessionInfo> {
    const body = await this.post<{
      accessToken: string;
      refreshToken: string;
      user: SessionInfo['user'];
      device: { id: string; name: string; platform: string };
    }>('/auth/token', {
      grant: 'magic',
      email,
      code,
      device: {
        name: os.hostname(),
        platform: process.platform,
        appVersion: app.getVersion(),
      },
    }, false);

    this.accessToken = body.accessToken;
    this.stored = { refreshToken: body.refreshToken, device: body.device };
    this.persist();
    await this.fetchProfile();
    return this.session!;
  }

  async logout(): Promise<void> {
    if (this.stored) {
      await this.post('/auth/logout', { refreshToken: this.stored.refreshToken }, false).catch(
        () => undefined, // best effort — local wipe happens regardless
      );
    }
    this.accessToken = null;
    this.session = null;
    this.stored = null;
    fs.rmSync(this.storePath, { force: true });
    this.windows.broadcast('session:changed', null);
  }

  private async refresh(): Promise<void> {
    if (!this.stored) throw new Error('no stored session');
    const body = await this.post<{ accessToken: string; refreshToken: string }>(
      '/auth/refresh',
      { refreshToken: this.stored.refreshToken },
      false,
    );
    this.accessToken = body.accessToken;
    this.stored = { ...this.stored, refreshToken: body.refreshToken };
    this.persist();
  }

  private async fetchProfile(): Promise<void> {
    const me = await this.get<{
      user: SessionInfo['user'];
      plan: 'FREE' | 'PRO' | 'TEAM';
      quota: SessionInfo['quota'];
      devices: (Omit<DeviceInfo, 'current'>)[];
    }>('/users/me');

    const currentId = this.stored?.device.id;
    this.session = {
      user: me.user,
      device:
        (me.devices.find((d) => d.id === currentId) as DeviceInfo | undefined) ??
        ({
          id: currentId ?? 'unknown',
          name: os.hostname(),
          platform: process.platform as DeviceInfo['platform'],
          appVersion: app.getVersion(),
          lastSeenAt: new Date().toISOString(),
        } satisfies DeviceInfo),
      entitlements: entitlementsFor(me.plan),
      quota: me.quota,
    };
    this.session.device.current = true;
    this.windows.broadcast('session:changed', this.session);
  }

  // ---------- HTTP ----------

  private async post<T = void>(route: string, body: object, authed: boolean): Promise<T> {
    return this.request<T>('POST', route, body, authed);
  }

  private async get<T>(route: string): Promise<T> {
    return this.request<T>('GET', route, undefined, true);
  }

  private async request<T>(
    method: string,
    route: string,
    body: object | undefined,
    authed: boolean,
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${route}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(authed && this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new Error(detail?.error?.message ?? `${route} failed (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // ---------- Persistence (safeStorage) ----------

  private persist(): void {
    if (!this.stored) return;
    const plaintext = JSON.stringify(this.stored);
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(plaintext)
      : Buffer.from(plaintext, 'utf8'); // dev fallback (some Linux CI)
    fs.writeFileSync(this.storePath, data);
  }

  private load(): StoredAuth | null {
    try {
      const data = fs.readFileSync(this.storePath);
      const plaintext = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(data)
        : data.toString('utf8');
      return JSON.parse(plaintext) as StoredAuth;
    } catch {
      return null;
    }
  }
}
