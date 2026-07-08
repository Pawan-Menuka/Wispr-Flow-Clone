import WebSocket from 'ws';
import type { AppContext, ServerMessage } from '@flow/shared';
import { encodeAudioFrame, parseServerMessage } from '@flow/shared';

/**
 * Persistent WS connection to the Flow API, main-process side (§7.2 —
 * survives window lifecycle, tokens never enter a renderer). Kept warm with
 * automatic reconnection (250 ms → 4 s backoff). One active dictation
 * session at a time, mirroring the server.
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
      this.session?.emitError('NETWORK', 'connection lost');
      this.session = null;
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
  startSession(opts: {
    sessionId: string;
    language?: string;
    appContext: AppContext;
  }): SttSessionHandle | null {
    if (!this.isConnected || !this.socket) return null;
    this.session?.cancel();

    const session = new SessionImpl(this.socket, opts.sessionId);
    this.session = session;
    this.socket.send(
      JSON.stringify({
        t: 'session.start',
        sessionId: opts.sessionId,
        ...(opts.language && opts.language !== 'auto' ? { language: opts.language } : {}),
        appContext: opts.appContext,
        mode: 'dictate',
      }),
    );
    return session;
  }
}

class SessionImpl implements SttSessionHandle {
  private ready = false;
  private pending: Buffer[] = [];
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
  private done = false;

  constructor(
    private readonly socket: WebSocket,
    readonly id: string,
  ) {}

  sendAudio(seq: number, pcm: Int16Array): void {
    if (this.done) return;
    const frame = Buffer.from(encodeAudioFrame(seq, pcm));
    if (this.ready && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(frame);
    } else {
      this.pending.push(frame); // flushed on session.ready
    }
  }

  finish(lastSeq: number): void {
    if (this.done) return;
    this.send({ t: 'session.finish', sessionId: this.id, lastSeq });
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.send({ t: 'session.cancel', sessionId: this.id });
  }

  handleReady(): void {
    this.ready = true;
    if (this.socket.readyState === WebSocket.OPEN) {
      for (const frame of this.pending) this.socket.send(frame);
    }
    this.pending = [];
    for (const cb of this.readyCbs) cb();
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
    for (const cb of this.resultCbs) cb(result);
  }

  emitError(code: string, message: string, rawTextSoFar?: string): void {
    if (this.done) return;
    this.done = true;
    for (const cb of this.errorCbs) cb(code, message, rawTextSoFar);
  }

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

  private send(msg: object): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}
