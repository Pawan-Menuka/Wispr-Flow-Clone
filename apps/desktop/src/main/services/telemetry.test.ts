import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TelemetryService } from './telemetry';

describe('TelemetryService (§23 gating)', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function make(opts: { enabled: boolean; key: string }) {
    dir = mkdtempSync(path.join(tmpdir(), 'flow-telemetry-'));
    const posts: { url: string; body: unknown }[] = [];
    const svc = new TelemetryService(
      dir,
      () => opts.enabled,
      opts.key,
      'https://ph.example',
      async (url, body) => void posts.push({ url, body }),
    );
    return { svc, posts };
  }

  it('is a no-op without an API key (dev builds never phone home)', async () => {
    const { svc, posts } = make({ enabled: true, key: '' });
    svc.capture('dictation_completed', { durationMs: 1200 });
    await svc.flush();
    expect(posts).toEqual([]);
  });

  it('is a no-op when the telemetry setting is off', async () => {
    const { svc, posts } = make({ enabled: false, key: 'phc_test' });
    svc.capture('dictation_completed', { durationMs: 1200 });
    await svc.flush();
    expect(posts).toEqual([]);
  });

  it('batches events with a stable anonymous id and no extra fields', async () => {
    const { svc, posts } = make({ enabled: true, key: 'phc_test' });
    svc.capture('dictation_completed', { durationMs: 1200, language: 'en' });
    svc.capture('dictation_failed', { kind: 'network' });
    await svc.flush();

    expect(posts).toHaveLength(1);
    const body = posts[0]!.body as {
      api_key: string;
      batch: { event: string; distinct_id: string; properties: Record<string, unknown> }[];
    };
    expect(posts[0]!.url).toBe('https://ph.example/batch/');
    expect(body.api_key).toBe('phc_test');
    expect(body.batch.map((e) => e.event)).toEqual(['dictation_completed', 'dictation_failed']);
    expect(body.batch[0]!.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.batch[0]!.distinct_id).toBe(body.batch[1]!.distinct_id);
    expect(body.batch[0]!.properties).toEqual({ durationMs: 1200, language: 'en' });
  });

  it('swallows transport failures silently', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'flow-telemetry-'));
    const svc = new TelemetryService(dir, () => true, 'phc_test', 'https://ph.example', async () => {
      throw new Error('offline');
    });
    svc.capture('dictation_completed');
    await expect(svc.flush()).resolves.toBeUndefined();
  });
});
