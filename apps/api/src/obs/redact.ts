import { createHash } from 'node:crypto';

/**
 * Log redaction (BLUEPRINT §25, §15.1): transcript text NEVER appears in a
 * log line, emails are hashed, credentials dropped. Every structured log in
 * this app must pass through `redact()` — log-hygiene.test.ts enforces the
 * source-level rule, this enforces it at runtime for dynamic objects.
 */

const DROP_KEYS = new Set([
  'finaltext',
  'rawtext',
  'text',
  'transcript',
  'interim',
  'dictionary',
  'authorization',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'apikey',
]);

const HASH_KEYS = new Set(['email', 'username', 'processname', 'appname']);

export function hashPii(value: string): string {
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 12);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const norm = key.toLowerCase().replace(/[_-]/g, '');
    if (DROP_KEYS.has(norm)) continue;
    if (HASH_KEYS.has(norm) && typeof v === 'string') {
      out[key] = hashPii(v);
      continue;
    }
    out[key] = redact(v, depth + 1);
  }
  return out;
}

/** One structured line per event: `[obs] {"event":…}` — timings/counts only. */
export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(`[obs] ${JSON.stringify({ event, ...(redact(fields) as object) })}`);
}
