import type { WebSocket } from 'ws';
import type { ServerMessage, WsErrorCode } from '@flow/shared';
import { decodeAudioFrame, parseClientMessage } from '@flow/shared';
import type { SttProvider, SttStream } from '../ai/stt.js';

interface ActiveSession {
  id: string;
  stream: SttStream;
  lastSeq: number;
  frames: number;
  startedAt: number;
  finishRequestedAt: number;
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
        void this.startSession(msg.sessionId, msg.language);
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

  private async startSession(sessionId: string, language?: string): Promise<void> {
    // A dangling previous session is replaced (client crashed mid-utterance).
    this.session?.stream.cancel();
    try {
      const stream = await this.stt.open({ language, sampleRate: 16_000 });
      const session: ActiveSession = {
        id: sessionId,
        stream,
        lastSeq: 0,
        frames: 0,
        startedAt: Date.now(),
        finishRequestedAt: 0,
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
      const text = await session.stream.finish();
      const durationMs = session.frames * 20;
      this.send({
        t: 'session.result',
        sessionId,
        finalText: text,
        rawText: text,
        formatted: false, // LLM formatting arrives in Phase 9
        wordCount: text ? text.trim().split(/\s+/).length : 0,
        durationMs,
        latencyMs: Date.now() - session.finishRequestedAt,
      });
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
