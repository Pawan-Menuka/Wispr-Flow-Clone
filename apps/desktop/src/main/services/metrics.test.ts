import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionMetrics } from './metrics';
import type { TelemetryService } from './telemetry';

function fakeTelemetry() {
  const events: { event: string; props: Record<string, unknown> }[] = [];
  const telemetry = {
    capture: (event: string, props: Record<string, unknown> = {}) =>
      void events.push({ event, props }),
  } as unknown as TelemetryService;
  return { telemetry, events };
}

describe('SessionMetrics', () => {
  let clock: number;
  const now = () => clock;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clock = 1_000;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('emits stage timings + telemetry on a completed dictation, with no text', () => {
    const { telemetry, events } = fakeTelemetry();
    const metrics = new SessionMetrics(telemetry, () => 'en', now);

    metrics.observe('dictation:state', { phase: 'armed' });
    clock += 50;
    metrics.observe('dictation:state', { phase: 'listening' });
    clock += 2_000;
    metrics.observe('dictation:state', { phase: 'processing' });
    clock += 400;
    metrics.observe('dictation:state', { phase: 'inserting' });
    clock += 100;
    metrics.observe('dictation:result', { id: 'd1', text: 'secret words', appName: null });
    metrics.observe('dictation:state', { phase: 'confirmed' });

    const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('[metrics]'));
    expect(line).toBeDefined();
    expect(line).toContain('"listening":50');
    expect(line).toContain('"processing":2050');
    expect(line).not.toContain('secret'); // transcript text never logged (§25)

    expect(events.map((e) => e.event)).toEqual([
      'dictation_completed',
      'activation_first_insertion',
    ]);
    expect(events[0]!.props['durationMs']).toBe(2_550);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('emits dictation_failed with the error kind', () => {
    const { telemetry, events } = fakeTelemetry();
    const metrics = new SessionMetrics(telemetry, () => 'en', now);
    metrics.observe('dictation:state', { phase: 'armed' });
    clock += 500;
    metrics.observe('dictation:error', { kind: 'no-speech', message: 'nothing heard' });
    expect(events).toEqual([{ event: 'dictation_failed', props: { kind: 'no-speech' } }]);
  });

  it('ignores errors outside a session', () => {
    const { telemetry, events } = fakeTelemetry();
    const metrics = new SessionMetrics(telemetry, () => 'en', now);
    metrics.observe('dictation:error', { kind: 'network', message: 'offline' });
    expect(events).toEqual([]);
  });
});
