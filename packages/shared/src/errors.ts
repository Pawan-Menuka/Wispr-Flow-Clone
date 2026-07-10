/**
 * Closed error taxonomy (BLUEPRINT §24). Every failure anywhere in the
 * pipeline must map to exactly one ErrorKind; an unmapped error is a bug.
 */
export const ERROR_KINDS = [
  'no-speech', // VAD never fired before the hotkey was released
  'no-mic', // no capture device available
  'mic-lost', // device disappeared mid-recording and no fallback existed
  'network', // WS/HTTP unreachable past retry budget
  'stt-failed', // all STT providers failed
  'llm-timeout', // formatting timed out (client still inserts raw text)
  'insertion-failed', // all three insertion tiers failed
  'quota-exceeded', // hard block past the grace threshold
  'secure-field', // focused element is a password/secure input
  'app-disabled', // user turned dictation off for the focused app (§5.4 profile: off)
  'unauthorized', // session invalid/revoked
  'cancelled', // user pressed Esc / session.cancel
  'offline-unavailable', // offline mode requested but no local model installed
  'unknown',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export class FlowError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? kind, options);
    this.name = 'FlowError';
  }
}

export function toErrorKind(value: unknown): ErrorKind {
  if (value instanceof FlowError) return value.kind;
  if (typeof value === 'string' && (ERROR_KINDS as readonly string[]).includes(value)) {
    return value as ErrorKind;
  }
  return 'unknown';
}
