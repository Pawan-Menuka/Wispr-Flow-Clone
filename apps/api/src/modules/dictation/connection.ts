import type { WebSocket } from 'ws';
import type { AppContext, ServerMessage, WsErrorCode } from '@flow/shared';
import { decodeAudioFrame, parseClientMessage } from '@flow/shared';
import type { SttProvider, SttStream } from '../ai/stt.js';
import type { FormattingService } from '../ai/formatter.js';
import type { QuotaService } from '../usage/quota.js';
import { logEvent } from '../../obs/redact.js';
import type { Plan } from '@flow/shared';

export interface ConnectionUser {
  sub: string;
  deviceId: string;
  plan: Plan;
}

interface ActiveSession {
  id: string;
  stream: SttStream;
  lastSeq: number;
  frames: number;
  startedAt: number;
  finishRequestedAt: number;
  language: string;
  profile: AppContext['profile'];
  dictionary: string[];
}

/**
 * One WS client = one ClientConnection. Speaks the §18 protocol exactly:
 * JSON text frames validated by shared zod schemas, binary audio frames per
 * the shared codec. One active dictation session per connection.
 */
export class ClientConnection {
  private session: ActiveSession | null = null;

  constructor(
    private readonly socket: WebSocket,
    private readonly stt: SttProvider,
    private readonly formatter: FormattingService,
    private readonly user: ConnectionUser | null = null,
    private readonly quota: QuotaService | null = null,
  ) {
    socket.on('message', (data, isBinary) => {
      if (isBinary) this.onAudio(data as Buffer);
      else this.onText((data as Buffer).toString('utf8'));
    });
    socket.on('close', () => this.session?.stream.cancel());
  }

  private onText(raw: string): void {
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.send({ t: 'system.notice', level: 'warn', message: 'invalid message ignored' });
      return;
    }

    switch (msg.t) {
      case 'session.start':
        void this.startSession(
          msg.sessionId,
          msg.language,
          msg.appContext.profile,
          msg.dictionary ?? [],
        );
        break;
      case 'session.finish':
        void this.finishSession(msg.sessionId);
        break;
      case 'session.cancel':
        if (this.session?.id === msg.sessionId) {
          this.session.stream.cancel();
          this.session = null;
        }
        break;
      case 'session.resume':
        if (this.session?.id === msg.sessionId) {
          this.send({ t: 'session.ready', sessionId: msg.sessionId, ackSeq: this.session.lastSeq });
        } else {
          this.sendError(msg.sessionId, 'SESSION_UNKNOWN', 'no such session to resume');
        }
        break;
      case 'rewrite.start':
        // Phase 9+ (LLM). Explicit not-implemented beats silence.
        this.send({ t: 'system.notice', level: 'warn', message: 'rewrite not available yet' });
        break;
      case 'sync.push':
        this.send({ t: 'system.notice', level: 'warn', message: 'sync not available yet' });
        break;
    }
  }

  private async startSession(
    sessionId: string,
    language: string | undefined,
    profile: AppContext['profile'],
    dictionary: string[],
  ): Promise<void> {
    // Quota gate (§3.1: block only past 110% — grace inserts still succeed).
    if (this.user && this.quota) {
      const decision = await this.quota.decision(this.user.sub, this.user.plan);
      if (decision === 'block') {
        this.sendError(sessionId, 'QUOTA', 'Weekly word limit reached — upgrade to keep dictating');
        return;
      }
    }

    // A dangling previous session is replaced (client crashed mid-utterance).
    this.session?.stream.cancel();
    try {
      const stream = await this.stt.open({ language, sampleRate: 16_000, keywords: dictionary });
      const session: ActiveSession = {
        id: sessionId,
        stream,
        lastSeq: 0,
        frames: 0,
        startedAt: Date.now(),
        finishRequestedAt: 0,
        language: language ?? 'auto',
        profile,
        dictionary,
      };
      stream.onInterim((interim) => {
        if (this.session?.id === sessionId) {
          this.send({ t: 'session.interim', sessionId, ...interim });
        }
      });
      stream.onError((message) => {
        if (this.session?.id === sessionId) {
          this.sendError(sessionId, 'STT_FAILED', message);
          this.session = null;
        }
      });
      this.session = session;
      this.send({ t: 'session.ready', sessionId });
    } catch (err) {
      this.sendError(sessionId, 'STT_FAILED', err instanceof Error ? err.message : 'stt open failed');
    }
  }

  private onAudio(data: Buffer): void {
    if (!this.session) return;
    const frame = decodeAudioFrame(data);
    if (!frame) return;
    this.session.lastSeq = frame.seq;
    this.session.frames++;
    this.session.stream.sendAudio(frame.pcm);
  }

  private async finishSession(sessionId: string): Promise<void> {
    const session = this.session;
    if (!session || session.id !== sessionId) {
      this.sendError(sessionId, 'SESSION_UNKNOWN', 'no active session');
      return;
    }
    session.finishRequestedAt = Date.now();
    try {
      const formatCtx = {
        language: session.language,
        appProfile: session.profile,
        ...(session.dictionary.length ? { dictionary: session.dictionary } : {}),
      };

      // §12.6 parallelism: most audio is already transcribed by finish-time.
      // Fire the LLM on the finalized-so-far text WHILE the STT tail flushes;
      // if the tail didn't change anything, the answer is already in flight.
      const provisionalText = session.stream.textSoFar().trim();
      const provisional =
        provisionalText.split(/\s+/).length >= 4
          ? { text: provisionalText, promise: this.formatter.format(provisionalText, formatCtx) }
          : null;

      const rawText = await session.stream.finish();
      const { text: finalText, formatted } =
        provisional && rawText.trim() === provisional.text
          ? await provisional.promise
          : await this.formatter.format(rawText, formatCtx);
      const durationMs = session.frames * 20;
      this.send({
        t: 'session.result',
        sessionId,
        finalText,
        rawText,
        formatted,
        wordCount: finalText ? finalText.trim().split(/\s+/).length : 0,
        durationMs,
        latencyMs: Date.now() - session.finishRequestedAt,
      });
      // §25: one structured line per session — stage timings only, never text.
      logEvent('session.completed', {
        sessionId,
        durationMs,
        latencyMs: Date.now() - session.finishRequestedAt,
        words: finalText ? finalText.trim().split(/\s+/).length : 0,
        formatted,
        profile: session.profile,
      });
      if (this.user && this.quota && finalText) {
        void this.quota.record({
          userId: this.user.sub,
          deviceId: this.user.deviceId,
          kind: 'dictation',
          wordCount: finalText.trim().split(/\s+/).length,
          durationMs,
          latencyMs: Date.now() - session.finishRequestedAt,
        });
      }
    } catch (err) {
      this.sendError(
        sessionId,
        'STT_FAILED',
        err instanceof Error ? err.message : 'finalization failed',
      );
    } finally {
      if (this.session?.id === sessionId) this.session = null;
    }
  }

  private sendError(sessionId: string, code: WsErrorCode, message: string): void {
    this.send({ t: 'session.error', sessionId, code, message });
  }

  private send(msg: ServerMessage): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}
