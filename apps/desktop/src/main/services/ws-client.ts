import WebSocket from 'ws';
import type { AppContext, ServerMessage } from '@flow/shared';
import { encodeAudioFrame, parseServerMessage } from '@flow/shared';

/**
 * Persistent WS connection to the Flow API, main-process side (§7.2 —
 * survives window lifecycle, tokens never enter a renderer). Kept warm with
 * automatic reconnection (250 ms → 4 s backoff).
 *
 * Reconnect-with-replay (§3.1): every audio frame of the active session is
 * retained (60 s ring). If the socket drops mid-session, the session enters
 * a resume window instead of failing; on reconnect the client re-issues
 * session.start with the SAME sessionId and replays all frames (the server
 * treats it as a fresh stream — full audio in, full transcript out). Only
 * after RESUME_DEADLINE_MS without a connection does the session fail.
 */

export interface SttSessionEvents {
  onReady(cb: () => void): void;
  onInterim(cb: (interim: { text: string; stableWords: number }) => void): void;
  onResult(
    cb: (result: {
      finalText: string;
      formatted: boolean;
      wordCount: number;
      durationMs: number;
      latencyMs: number;
    }) => void,
  ): void;
  onError(cb: (code: string, message: string, rawTextSoFar?: string) => void): void;
}

export interface SttSessionHandle extends SttSessionEvents {
  sendAudio(seq: number, pcm: Int16Array): void;
  finish(lastSeq: number): void;
  cancel(): void;
}

const BACKOFF_MIN_MS = 250;
const BACKOFF_MAX_MS = 4_000;
const RESUME_DEADLINE_MS = 8_000;
const FRAME_RETENTION_LIMIT = 3_000; // 60 s of 20 ms frames

interface SessionOptions {
  sessionId: string;
  language?: string;
  appContext: AppContext;
  dictionary?: string[];
}

export class WsClient {
  private socket: WebSocket | null = null;
  private session: SessionImpl | null = null;
  private backoff = BACKOFF_MIN_MS;
  private closedByUs = false;

  constructor(private readonly url: string) {}

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  shutdown(): void {
    this.closedByUs = true;
    this.socket?.close();
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.on('open', () => {
      this.backoff = BACKOFF_MIN_MS;
      // A session waiting out a drop resumes on the fresh connection.
      if (this.session && !this.session.done) this.session.beginReplay();
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = parseServerMessage((data as Buffer).toString('utf8'));
      if (msg) this.route(msg);
    });
    socket.on('error', () => {
      /* close handler owns reconnection */
    });
    socket.on('close', () => {
      this.session?.onConnectionLost();
      if (!this.closedByUs) {
        setTimeout(() => this.open(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
      }
    });
  }

  private route(msg: ServerMessage): void {
    const session = this.session;
    if (!session) return;
    switch (msg.t) {
      case 'session.ready':
        if (msg.sessionId === session.id) session.handleReady();
        break;
      case 'session.interim':
        if (msg.sessionId === session.id) session.emitInterim(msg.text, msg.stableWords);
        break;
      case 'session.result':
        if (msg.sessionId === session.id) {
          session.emitResult({
            finalText: msg.finalText,
            formatted: msg.formatted,
            wordCount: msg.wordCount,
            durationMs: msg.durationMs,
            latencyMs: msg.latencyMs,
          });
          this.session = null;
        }
        break;
      case 'session.error':
        if (msg.sessionId === session.id) {
          session.emitError(msg.code, msg.message, msg.rawTextSoFar);
          this.session = null;
        }
        break;
      default:
        break; // subscription/sync events handled in later phases
    }
  }

  /** Returns null when disconnected — caller surfaces a network error. */
  startSession(opts: SessionOptions): SttSessionHandle | null {
    if (!this.isConnected || !this.socket) return null;
    this.session?.cancel();

    const session = new SessionImpl(() => this.socket, opts);
    this.session = session;
    session.sendStart();
    return session;
  }
}

class SessionImpl implements SttSessionHandle {
  readonly id: string;
  done = false;

  private ready = false;
  private replayFrom = 0; // index into frames not yet sent on the live socket
  private frames: Buffer[] = [];
  private finishSeq: number | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  private readyCbs: (() => void)[] = [];
  private interimCbs: ((i: { text: string; stableWords: number }) => void)[] = [];
  private resultCbs: ((r: {
    finalText: string;
    formatted: boolean;
    wordCount: number;
    durationMs: number;
    latencyMs: number;
  }) => void)[] = [];
  private errorCbs: ((code: string, message: string, rawTextSoFar?: string) => void)[] = [];

  constructor(
    private readonly getSocket: () => WebSocket | null,
    private readonly opts: SessionOptions,
  ) {
    this.id = opts.sessionId;
  }

  // ---------- Outbound ----------

  sendStart(): void {
    this.ready = false;
    this.sendJson({
      t: 'session.start',
      sessionId: this.id,
      ...(this.opts.language && this.opts.language !== 'auto'
        ? { language: this.opts.language }
        : {}),
      appContext: this.opts.appContext,
      mode: 'dictate',
      ...(this.opts.dictionary?.length ? { dictionary: this.opts.dictionary } : {}),
    });
  }

  sendAudio(seq: number, pcm: Int16Array): void {
    if (this.done) return;
    const frame = Buffer.from(encodeAudioFrame(seq, pcm));
    this.frames.push(frame);
    if (this.frames.length > FRAME_RETENTION_LIMIT) {
      this.frames.shift();
      if (this.replayFrom > 0) this.replayFrom--;
    }
    this.flush();
  }

  finish(lastSeq: number): void {
    if (this.done) return;
    this.finishSeq = lastSeq;
    this.flush();
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.clearResumeTimer();
    this.sendJson({ t: 'session.cancel', sessionId: this.id });
  }

  /** Send whatever the server hasn't seen yet: pending frames, then finish. */
  private flush(): void {
    const socket = this.getSocket();
    if (!this.ready || !socket || socket.readyState !== WebSocket.OPEN) return;
    while (this.replayFrom < this.frames.length) {
      socket.send(this.frames[this.replayFrom]!);
      this.replayFrom++;
    }
    if (this.finishSeq !== null) {
      this.sendJson({ t: 'session.finish', sessionId: this.id, lastSeq: this.finishSeq });
      this.finishSeq = null; // sent — server owns the result now
    }
  }

  // ---------- Resume lifecycle ----------

  onConnectionLost(): void {
    if (this.done) return;
    this.ready = false;
    this.replayFrom = 0; // the new stream needs the audio from the top
    if (!this.resumeTimer) {
      this.resumeTimer = setTimeout(() => {
        this.emitError('NETWORK', 'connection lost');
      }, RESUME_DEADLINE_MS);
    }
  }

  beginReplay(): void {
    if (this.done) return;
    this.clearResumeTimer();
    this.sendStart(); // ready ack triggers flush() of the full buffer
  }

  // ---------- Inbound ----------

  handleReady(): void {
    this.ready = true;
    for (const cb of this.readyCbs) cb();
    this.flush();
  }

  emitInterim(text: string, stableWords: number): void {
    for (const cb of this.interimCbs) cb({ text, stableWords });
  }

  emitResult(result: {
    finalText: string;
    formatted: boolean;
    wordCount: number;
    durationMs: number;
    latencyMs: number;
  }): void {
    if (this.done) return;
    this.done = true;
    this.clearResumeTimer();
    for (const cb of this.resultCbs) cb(result);
  }

  emitError(code: string, message: string, rawTextSoFar?: string): void {
    if (this.done) return;
    this.done = true;
    this.clearResumeTimer();
    for (const cb of this.errorCbs) cb(code, message, rawTextSoFar);
  }

  // ---------- Subscriptions ----------

  onReady(cb: () => void): void {
    this.readyCbs.push(cb);
  }
  onInterim(cb: (i: { text: string; stableWords: number }) => void): void {
    this.interimCbs.push(cb);
  }
  onResult(
    cb: (r: {
      finalText: string;
      formatted: boolean;
      wordCount: number;
      durationMs: number;
      latencyMs: number;
    }) => void,
  ): void {
    this.resultCbs.push(cb);
  }
  onError(cb: (code: string, message: string, rawTextSoFar?: string) => void): void {
    this.errorCbs.push(cb);
  }

  // ---------- Internals ----------

  private clearResumeTimer(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private sendJson(msg: object): void {
    const socket = this.getSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }
}
