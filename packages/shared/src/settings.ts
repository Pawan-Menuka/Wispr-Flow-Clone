import { z } from 'zod';

/**
 * Single source of truth for user settings (BLUEPRINT §19).
 * Local keys are device-specific and never leave the machine.
 * Synced keys are uploaded as one versioned document to /sync/settings.
 */

export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

export const LocalSettingsSchema = z.object({
  hotkey: z.string().default('Ctrl+Win'),
  hotkeyMode: z.enum(['hold', 'toggle']).default('hold'),
  commandHotkey: z.string().default('Ctrl+Win+Space'),
  micDeviceId: z.string().default('default'),
  vadSensitivity: z.number().min(0.2).max(0.8).default(0.5),
  /** Overlay position per displayId. */
  overlayPosition: z.record(z.string(), PointSchema).default({}),
  overlayScale: z.enum(['s', 'm', 'l']).default('m'),
  launchAtLogin: z.boolean().default(true),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  releaseMicImmediately: z.boolean().default(false),
  updateChannel: z.enum(['stable', 'beta']).default('stable'),
  preferOffline: z.boolean().default(false),
  /** First-run flow completed on this device (§3.2). */
  onboardingComplete: z.boolean().default(false),
});

export const SyncedSettingsSchema = z.object({
  language: z.string().default('auto'),
  fillerRemoval: z.boolean().default(true),
  tone: z.enum(['neutral', 'match-app', 'formal', 'casual']).default('match-app'),
  spokenPunctuation: z.boolean().default(true),
  numberStyle: z.enum(['auto', 'digits', 'words']).default('auto'),
  /** Pro feature — appended to the formatting prompt. */
  customInstructions: z.string().max(1000).default(''),
  historyRetention: z.enum(['forever', '30d', 'off']).default('forever'),
  syncHistory: z.boolean().default(false),
  readAppContext: z.boolean().default(false),
  telemetry: z.boolean().default(true),
});

export const SettingsSchema = LocalSettingsSchema.merge(SyncedSettingsSchema);

export type LocalSettings = z.infer<typeof LocalSettingsSchema>;
export type SyncedSettings = z.infer<typeof SyncedSettingsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export const LOCAL_SETTING_KEYS = Object.keys(
  LocalSettingsSchema.shape,
) as (keyof LocalSettings)[];
export const SYNCED_SETTING_KEYS = Object.keys(
  SyncedSettingsSchema.shape,
) as (keyof SyncedSettings)[];

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Parse a possibly-stale/partial stored object, falling back to defaults per key. */
export function parseSettings(raw: unknown): Settings {
  const result = SettingsSchema.safeParse(raw);
  if (result.success) return result.data;
  // Per-key salvage: keep every key that individually validates.
  const salvaged: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') {
    for (const [key, schema] of Object.entries(SettingsSchema.shape)) {
      const value = (raw as Record<string, unknown>)[key];
      if (value === undefined) continue;
      const parsed = (schema as z.ZodTypeAny).safeParse(value);
      if (parsed.success) salvaged[key] = parsed.data;
    }
  }
  return SettingsSchema.parse(salvaged);
}

/** Extract the synced subset for upload. */
export function pickSyncedSettings(settings: Settings): SyncedSettings {
  return SyncedSettingsSchema.parse(settings);
}
