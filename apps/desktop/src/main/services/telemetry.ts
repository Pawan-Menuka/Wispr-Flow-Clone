import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Product telemetry (BLUEPRINT §23). Rule zero: no transcript content, no
 * window titles, ever — callers may only pass counts/durations/booleans/enums.
 * Doubly gated: the `telemetry` setting (user opt-out) AND a PostHog key baked
 * in at build time (`FLOW_POSTHOG_KEY`) — absent key = permanent no-op, so dev
 * builds never phone home. Zero-dep: PostHog's capture endpoint is plain HTTP.
 */

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_AT = 20;

interface QueuedEvent {
  event: string;
  properties: Record<string, string | number | boolean>;
  timestamp: string;
}

export class TelemetryService {
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private anonId: string | null = null;

  constructor(
    private readonly userDataDir: string,
    private readonly isEnabled: () => boolean,
    private readonly apiKey = process.env['FLOW_POSTHOG_KEY'] ?? '',
    private readonly host = process.env['FLOW_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com',
    private readonly post: (url: string, body: unknown) => Promise<void> = defaultPost,
  ) {}

  /** §23 event vocabulary only — never free-form strings from user content. */
  capture(event: string, properties: Record<string, string | number | boolean> = {}): void {
    if (!this.apiKey || !this.isEnabled()) return;
    this.queue.push({ event, properties, timestamp: new Date().toISOString() });
    if (this.queue.length >= FLUSH_AT) void this.flush();
    else if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    try {
      await this.post(`${this.host}/batch/`, {
        api_key: this.apiKey,
        batch: batch.map((e) => ({
          event: e.event,
          distinct_id: this.distinctId(),
          timestamp: e.timestamp,
          properties: e.properties,
        })),
      });
    } catch {
      // Telemetry is fire-and-forget: never retry-spam, never surface errors.
    }
  }

  /** Random install id — no account linkage, survives in userData. */
  private distinctId(): string {
    if (this.anonId) return this.anonId;
    const file = path.join(this.userDataDir, 'telemetry-id');
    try {
      if (existsSync(file)) {
        this.anonId = readFileSync(file, 'utf8').trim();
        if (this.anonId) return this.anonId;
      }
    } catch {
      /* fall through to regenerate */
    }
    this.anonId = randomUUID();
    try {
      mkdirSync(this.userDataDir, { recursive: true });
      writeFileSync(file, this.anonId);
    } catch {
      /* ephemeral id is fine */
    }
    return this.anonId;
  }
}

async function defaultPost(url: string, body: unknown): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
}
