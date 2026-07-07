import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '@flow/shared';
import { parseSettings } from '@flow/shared';

/**
 * Local settings persistence (BLUEPRINT §19). Plain JSON with atomic writes;
 * corrupt/stale files degrade per-key via parseSettings, never a full reset.
 * Sync of the synced subset arrives in Phase 17.
 */
export class SettingsStore {
  private settings: Settings;
  private listeners = new Set<(patch: Partial<Settings>) => void>();

  constructor(private readonly filePath: string) {
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return parseSettings(JSON.parse(raw));
    } catch {
      return parseSettings({});
    }
  }

  snapshot(): Settings {
    return { ...this.settings };
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.settings[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (Object.is(this.settings[key], value)) return;
    this.settings = { ...this.settings, [key]: value };
    this.persist();
    const patch = { [key]: value } as Partial<Settings>;
    for (const listener of this.listeners) listener(patch);
  }

  /** Services subscribe to react to live changes (hotkey re-registration etc.). */
  onChange(listener: (patch: Partial<Settings>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    const tmpPath = `${this.filePath}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
