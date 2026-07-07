import { z } from 'zod';

/**
 * Realtime protocol between desktop app and API (BLUEPRINT §18).
 * Text frames = JSON messages validated by these schemas.
 * Binary frames = audio, framed per encodeAudioFrame below.
 */

// ---------- Client → Server ----------

export const AppContextSchema = z.object({
  /** Process name only — window titles never cross the wire (privacy rule). */
  processName: z.string().max(200),
  profile: z.enum(['default', 'slack', 'email', 'code', 'terminal']).default('default'),
});
export type AppContext = z.infer<typeof AppContextSchema>;

export const SessionStartSchema = z.object({
  t: z.literal('session.start'),
  sessionId: z.string().uuid(),
  language: z.string().optional(),
  appContext: AppContextSchema,
  mode: z.enum(['dictate', 'command']).default('dictate'),
});

export const SessionFinishSchema = z.object({
  t: z.literal('session.finish'),
  sessionId: z.string().uuid(),
  lastSeq: z.number().int().nonnegative(),
});

export const SessionCancelSchema = z.object({
  t: z.literal('session.cancel'),
  sessionId: z.string().uuid(),
});

export const SessionResumeSchema = z.object({
  t: z.literal('session.resume'),
  sessionId: z.string().uuid(),
  fromSeq: z.number().int().nonnegative(),
});

export const RewriteStartSchema = z.object({
  t: z.literal('rewrite.start'),
  requestId: z.string().uuid(),
  dictationId: z.string().optional(),
  text: z.string().max(20_000).optional(),
  instruction: z.string().max(1_000),
});

export const SyncPushSchema = z.object({
  t: z.literal('sync.push'),
  mutations: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.enum(['settings', 'dictionary', 'snippet', 'app-rule', 'history']),
      payload: z.unknown(),
      createdAt: z.string(),
    }),
  ),
});

export const ClientMessageSchema = z.discriminatedUnion('t', [
  SessionStartSchema,
  SessionFinishSchema,
  SessionCancelSchema,
  SessionResumeSchema,
  RewriteStartSchema,
  SyncPushSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- Server → Client ----------

export const WS_ERROR_CODES = [
  'STT_FAILED',
  'LLM_TIMEOUT',
  'QUOTA',
  'UNAUTHORIZED',
  'SESSION_UNKNOWN',
  'INTERNAL',
] as const;
export type WsErrorCode = (typeof WS_ERROR_CODES)[number];

export const SessionReadySchema = z.object({
  t: z.literal('session.ready'),
  sessionId: z.string().uuid(),
  /** Present on resume: highest audio seq the server already has. */
  ackSeq: z.number().int().nonnegative().optional(),
});

export const SessionInterimSchema = z.object({
  t: z.literal('session.interim'),
  sessionId: z.string().uuid(),
  text: z.string(),
  /** Count of leading words considered stable (render solid vs dimmed). */
  stableWords: z.number().int().nonnegative(),
});

export const SessionResultSchema = z.object({
  t: z.literal('session.result'),
  sessionId: z.string().uuid(),
  finalText: z.string(),
  rawText: z.string(),
  /** false = LLM degraded/skipped; client applies rule-based punctuation. */
  formatted: z.boolean(),
  wordCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
});

export const SessionErrorSchema = z.object({
  t: z.literal('session.error'),
  sessionId: z.string().uuid(),
  code: z.enum(WS_ERROR_CODES),
  message: z.string(),
  /** Best-effort transcript so the user's words are never lost. */
  rawTextSoFar: z.string().optional(),
});

export const RewriteDeltaSchema = z.object({
  t: z.literal('rewrite.delta'),
  requestId: z.string().uuid(),
  text: z.string(),
});

export const RewriteDoneSchema = z.object({
  t: z.literal('rewrite.done'),
  requestId: z.string().uuid(),
  text: z.string(),
});

export const SubscriptionUpdatedSchema = z.object({
  t: z.literal('subscription.updated'),
  // Entitlements shape is validated app-side; kept loose here to avoid drift.
  entitlements: z.unknown(),
});

export const SyncChangedSchema = z.object({
  t: z.literal('sync.changed'),
  keys: z.array(z.enum(['settings', 'dictionary', 'snippets', 'app-rules', 'history'])),
});

export const SystemNoticeSchema = z.object({
  t: z.literal('system.notice'),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion('t', [
  SessionReadySchema,
  SessionInterimSchema,
  SessionResultSchema,
  SessionErrorSchema,
  RewriteDeltaSchema,
  RewriteDoneSchema,
  SubscriptionUpdatedSchema,
  SyncChangedSchema,
  SystemNoticeSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ---------- Binary audio framing (§13.6) ----------

export const AUDIO_FRAME_KIND = 0x01;
/** 16 kHz mono 16-bit PCM, 20 ms per frame. */
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_FRAME_SAMPLES = 320;

export interface AudioFrame {
  seq: number;
  pcm: Int16Array;
}

/** Layout: [u8 kind][u16be seq][s16le pcm...]. Seq wraps at 65536. */
export function encodeAudioFrame(seq: number, pcm: Int16Array): ArrayBuffer {
  const buf = new ArrayBuffer(3 + pcm.length * 2);
  const view = new DataView(buf);
  view.setUint8(0, AUDIO_FRAME_KIND);
  view.setUint16(1, seq & 0xffff, false);
  // Header is 3 bytes so the PCM region starts at an odd offset — an
  // Int16Array view is illegal there; write samples via DataView.
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(3 + i * 2, pcm[i]!, true);
  }
  return buf;
}

export function decodeAudioFrame(data: ArrayBuffer | Uint8Array): AudioFrame | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 3 || bytes[0] !== AUDIO_FRAME_KIND) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seq = view.getUint16(1, false);
  const sampleCount = (bytes.length - 3) >> 1;
  const pcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    pcm[i] = view.getInt16(3 + i * 2, true);
  }
  return { seq, pcm };
}

// ---------- Close codes & heartbeat ----------

export const WS_CLOSE_CODES = {
  HEARTBEAT_TIMEOUT: 4000,
  UNAUTHORIZED: 4001,
  DEVICE_REVOKED: 4002,
  SERVER_SHUTDOWN: 4003,
} as const;

export const HEARTBEAT_INTERVAL_MS = 25_000;

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    return ClientMessageSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    return ServerMessageSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
