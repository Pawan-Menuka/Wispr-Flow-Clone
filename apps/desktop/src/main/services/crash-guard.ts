import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Crash-loop detection (§3.4.3): a boot record is written at startup and
 * marked stable after 60 s of uptime (or a graceful quit). A previous record
 * that never went stable counts as a quick exit; two in a row = crash loop →
 * the caller shows the safe-mode dialog and skips update checks for the run.
 */

export const STABLE_AFTER_MS = 60_000;

export interface CrashRecord {
  bootAt: string;
  stable: boolean;
  quickExits: number;
}

export function assessBoot(prev: CrashRecord | null, now: Date): {
  record: CrashRecord;
  crashLoop: boolean;
} {
  const quickExits = prev && !prev.stable ? prev.quickExits + 1 : 0;
  return {
    record: { bootAt: now.toISOString(), stable: false, quickExits },
    crashLoop: quickExits >= 2,
  };
}

export class CrashGuard {
  private record: CrashRecord | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {}

  /** Record this boot; returns true when a crash loop is detected. */
  boot(now = new Date()): boolean {
    const { record, crashLoop } = assessBoot(this.read(), now);
    this.record = record;
    this.write(record);
    this.timer = setTimeout(() => this.markStable(), STABLE_AFTER_MS);
    this.timer.unref?.();
    return crashLoop;
  }

  /** Uptime reached 60 s, or the app is quitting gracefully. */
  markStable(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.record || this.record.stable) return;
    this.record = { ...this.record, stable: true };
    this.write(this.record);
  }

  private read(): CrashRecord | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as CrashRecord).stable === 'boolean' &&
        typeof (parsed as CrashRecord).quickExits === 'number'
      ) {
        return parsed as CrashRecord;
      }
    } catch {
      /* first boot or corrupt file — treat as clean */
    }
    return null;
  }

  private write(record: CrashRecord): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(record));
      renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[crash-guard] persist failed:', err instanceof Error ? err.message : err);
    }
  }
}
