import { z } from 'zod';
import { SYNCED_SETTING_KEYS, SyncedSettingsSchema } from './settings.js';
import type { SyncedSettings } from './settings.js';

/**
 * Settings sync (BLUEPRINT §19.4): one versioned document per user with
 * per-key last-write timestamps. The server stores the doc opaquely and
 * bumps `version` on every accepted PUT; conflicts (stale baseVersion)
 * return 409 with the server copy and the CLIENT merges — newest stamp per
 * key wins.
 */

export const SyncedDocSchema = z.object({
  version: z.number().int().nonnegative(),
  values: SyncedSettingsSchema.partial(),
  /** ISO timestamp of the last local change per key. */
  stamps: z.record(z.string(), z.string()).default({}),
});
export type SyncedDoc = z.infer<typeof SyncedDocSchema>;

export const SyncPutSchema = z.object({
  values: SyncedSettingsSchema.partial(),
  stamps: z.record(z.string(), z.string()),
  baseVersion: z.number().int().nonnegative(),
});
export type SyncPut = z.infer<typeof SyncPutSchema>;

export interface MergeResult {
  /** The winning value set (push this). */
  values: Partial<SyncedSettings>;
  stamps: Record<string, string>;
  /** Remote-won keys the local store must adopt. */
  applyLocally: Partial<SyncedSettings>;
}

/** Per-key newest-stamp-wins merge. Missing stamps lose to any stamp. */
export function mergeSyncedDocs(
  local: { values: Partial<SyncedSettings>; stamps: Record<string, string> },
  remote: { values: Partial<SyncedSettings>; stamps: Record<string, string> },
): MergeResult {
  const values: Record<string, unknown> = {};
  const stamps: Record<string, string> = {};
  const applyLocally: Record<string, unknown> = {};

  for (const key of SYNCED_SETTING_KEYS) {
    const localHas = key in local.values;
    const remoteHas = key in remote.values;
    if (!localHas && !remoteHas) continue;

    const localStamp = local.stamps[key] ?? '';
    const remoteStamp = remote.stamps[key] ?? '';
    const remoteWins = remoteHas && (!localHas || remoteStamp > localStamp);

    if (remoteWins) {
      values[key] = remote.values[key];
      stamps[key] = remoteStamp;
      if (!localHas || !deepEqual(local.values[key], remote.values[key])) {
        applyLocally[key] = remote.values[key];
      }
    } else {
      values[key] = local.values[key];
      if (localStamp) stamps[key] = localStamp;
    }
  }

  return {
    values: values as Partial<SyncedSettings>,
    stamps,
    applyLocally: applyLocally as Partial<SyncedSettings>,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
