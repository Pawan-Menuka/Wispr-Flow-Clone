import type { EventChannel, FlowEvents } from '@flow/shared';
import type { TelemetryService } from './telemetry';

/**
 * Per-dictation stage metrics (BLUEPRINT §25 client logging + §23 events).
 * Observes the controller's own broadcasts (fed from index.ts), tracks phase
 * transition timestamps, and on completion emits:
 *   1. one structured log line — stage timings only, NEVER text,
 *   2. `dictation_completed` / `dictation_failed` telemetry (counts only).
 * The §12.5 latency SLO is measured here on every single dictation.
 */
export class SessionMetrics {
  private stages: Partial<Record<string, number>> = {};
  private sawFirstInsertion = false;

  constructor(
    private readonly telemetry: TelemetryService,
    private readonly getLanguage: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  observe<K extends EventChannel>(channel: K, payload: FlowEvents[K]): void {
    if (channel === 'dictation:state') {
      const { phase } = payload as FlowEvents['dictation:state'];
      if (phase === 'armed') this.stages = { armed: this.now() };
      else if (this.stages['armed'] && !(phase in this.stages)) this.stages[phase] = this.now();
      if (phase === 'confirmed') this.complete(true);
    }
    if (channel === 'dictation:error') {
      this.complete(false, (payload as FlowEvents['dictation:error']).kind);
    }
  }

  private complete(ok: boolean, kind?: string): void {
    const t0 = this.stages['armed'];
    if (t0 === undefined) return; // error outside a session (e.g. boot-time)
    const ms = (stage: string) => {
      const t = this.stages[stage];
      return t === undefined ? undefined : t - t0;
    };
    const line = {
      event: ok ? 'dictation.completed' : 'dictation.failed',
      stages: {
        listening: ms('listening'),
        processing: ms('processing'),
        inserting: ms('inserting'),
        done: this.now() - t0,
      },
      ...(kind ? { kind } : {}),
    };
    console.log(`[metrics] ${JSON.stringify(line)}`);

    if (ok) {
      this.telemetry.capture('dictation_completed', {
        durationMs: this.now() - t0,
        ...(ms('processing') !== undefined && ms('inserting') !== undefined
          ? { formatLatencyMs: (ms('inserting') ?? 0) - (ms('processing') ?? 0) }
          : {}),
        language: this.getLanguage(),
      });
      if (!this.sawFirstInsertion) {
        this.sawFirstInsertion = true;
        this.telemetry.capture('activation_first_insertion');
      }
    } else {
      this.telemetry.capture('dictation_failed', { kind: kind ?? 'unknown' });
    }
    this.stages = {};
  }
}
