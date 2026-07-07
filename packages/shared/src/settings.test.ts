import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  LOCAL_SETTING_KEYS,
  SYNCED_SETTING_KEYS,
  SettingsSchema,
  parseSettings,
  pickSyncedSettings,
} from './settings.js';

describe('settings schema', () => {
  it('produces complete defaults from an empty object', () => {
    expect(DEFAULT_SETTINGS.hotkey).toBe('Ctrl+Win');
    expect(DEFAULT_SETTINGS.tone).toBe('match-app');
    expect(DEFAULT_SETTINGS.telemetry).toBe(true);
  });

  it('every key is classified as exactly one of local/synced', () => {
    const all = Object.keys(SettingsSchema.shape).sort();
    const classified = [...LOCAL_SETTING_KEYS, ...SYNCED_SETTING_KEYS].sort();
    expect(classified).toEqual(all);
    const overlap = LOCAL_SETTING_KEYS.filter((k) =>
      (SYNCED_SETTING_KEYS as readonly string[]).includes(k),
    );
    expect(overlap).toEqual([]);
  });

  it('salvages valid keys from a partially corrupt store', () => {
    const settings = parseSettings({
      theme: 'dark',
      vadSensitivity: 99, // out of range → dropped
      tone: 'nonsense', // invalid enum → dropped
    });
    expect(settings.theme).toBe('dark');
    expect(settings.vadSensitivity).toBe(0.5);
    expect(settings.tone).toBe('match-app');
  });

  it('pickSyncedSettings strips device-local keys', () => {
    const synced = pickSyncedSettings(DEFAULT_SETTINGS);
    expect('hotkey' in synced).toBe(false);
    expect(synced.language).toBe('auto');
  });
});
