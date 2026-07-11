import { app } from 'electron';

/**
 * Sentry crash reporting (BLUEPRINT F25, §25), env-gated: without a DSN baked
 * in at build time (`FLOW_SENTRY_DSN`) this is a permanent no-op. Breadcrumbs
 * are scrubbed — event payloads must never carry transcript text or IPC data.
 */
export function initCrashReporting(): void {
  const dsn = process.env['FLOW_SENTRY_DSN'];
  if (!dsn) return;
  import('@sentry/electron/main')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        release: `flow-desktop@${app.getVersion()}`,
        // Crash triage only — no performance tracing, no session replay.
        tracesSampleRate: 0,
        beforeBreadcrumb(breadcrumb) {
          // Drop payload data wholesale; categories/timestamps are enough.
          if (breadcrumb.category === 'ipc') return null;
          delete breadcrumb.data;
          return breadcrumb;
        },
        beforeSend(event) {
          delete event.extra; // never ship free-form context objects
          if (event.request) delete event.request.data;
          return event;
        },
      });
      console.log('[crash-reporting] sentry enabled');
    })
    .catch((err: unknown) => {
      console.warn('[crash-reporting] init failed:', err instanceof Error ? err.message : err);
    });
}
