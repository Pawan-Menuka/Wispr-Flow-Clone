import { randomUUID } from 'node:crypto';
import type { DictationPhase, ErrorKind, EventChannel, FlowEvents } from '@flow/shared';
import type { AudioFrameMsg } from '../services/audio-bridge';
import type { SttSessionHandle } from '../services/ws-client';
import { lastResult, pushRestoreStack } from './results';

/**
 * The §3.1 dictation state machine, main-process side.
 * IDLE → ARMED → LISTENING → PROCESSING → (INSERTING) → CONFIRMED → IDLE,
 * with ERROR(kind) branches. Electron-free by design (deps injected) so the
 * transitions are unit-testable.
 *
 * Hotkey semantics (BLUEPRINT §2 F1):
 *  - hotkeyMode 'hold': chord-up always finishes (strict push-to-talk).
 *  - hotkeyMode 'toggle': every press toggles.
 * Audio streams to the backend WS session while LISTENING (§12.5 — STT runs
 * during speech); finish() just awaits the server's result, capped by
 * RESULT_TIMEOUT_MS before degrading to a network error.
 */

const MAX_SESSION_FRAMES = 5 * 60 * 50; // 5 min of 20 ms frames
const CONFIRMED_LINGER_MS = 3_000;
const ERROR_LINGER_MS = 4_000;
// Must exceed the WsClient resume deadline (8 s) so a mid-finish reconnect
// gets its replay chance before the controller degrades.
const RESULT_TIMEOUT_MS = 10_000;

export interface ControllerDeps {
  broadcast<K extends EventChannel>(channel: K, payload: FlowEvents[K]): void;
  showOverlay(): void;
  hideOverlay(): void;
  requestCapture(active: boolean): void;
  takePreRoll(): AudioFrameMsg[];
  getHotkeyMode(): 'hold' | 'toggle';
  /** Focus snapshot at chord-down (§3.1 step 2). Null = unknown/non-Windows. */
  getFocusedApp(): { processName: string; profile: string } | null;
  /** Opens a backend dictation session; null when the API is unreachable. */
  startSttSession(
    sessionId: string,
    app: { processName: string; profile: string } | null,
  ): SttSessionHandle | null;
  /** Tier-2 insertion (§14.3); processName drives the quirks table. */
  insertText(text: string, processName: string | null): Promise<boolean>;
  /** Persist a finished dictation to local history (Phase 13). */
  addHistory(entry: {
    id: string;
    finalText: string;
    appName: string | null;
    wordCount: number;
    durationMs: number;
  }): void;
}

function mapWsError(code: string): ErrorKind {
  switch (code) {
    case 'QUOTA':
      return 'quota-exceeded';
    case 'UNAUTHORIZED':
      return 'unauthorized';
    case 'LLM_TIMEOUT':
      return 'llm-timeout';
    case 'NETWORK':
      return 'network';
    default:
      return 'stt-failed';
  }
}

export class DictationController {
  private phase: DictationPhase = 'idle';
  private sessionId: string | null = null;
  private stt: SttSessionHandle | null = null;
  private focusedApp: { processName: string; profile: string } | null = null;
  private latched = false; // true once the session runs in toggle mode
  private sawSpeech = false;
  private frameCount = 0;
  private lastSeq = 0;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  get currentPhase(): DictationPhase {
    return this.phase;
  }

  // ---------- Inputs ----------

  onChordDown(): void {
    if (this.phase === 'idle' || this.phase === 'error' || this.phase === 'confirmed') {
      this.begin();
    } else if ((this.phase === 'armed' || this.phase === 'listening') && this.latched) {
      // Second tap ends a latched (toggle) session.
      this.finish();
    }
  }

  onChordUp(): void {
    if (this.phase !== 'armed' && this.phase !== 'listening') return;
    if (this.latched) return; // toggle sessions ignore chord release
    if (this.deps.getHotkeyMode() === 'toggle') this.latched = true;
    else this.finish();
  }

  /** Tray "Start dictation" and programmatic triggers behave like a tap. */
  toggle(): void {
    if (this.phase === 'armed' || this.phase === 'listening') {
      this.finish();
    } else if (this.phase === 'idle' || this.phase === 'error' || this.phase === 'confirmed') {
      this.begin();
      this.latched = true;
    }
  }

  cancel(): void {
    if (this.phase === 'idle') return;
    this.clearTimers();
    this.deps.requestCapture(false);
    this.stt?.cancel();
    this.reset();
  }

  onVad(speaking: boolean): void {
    if (!this.sessionId) return;
    if (speaking) {
      this.sawSpeech = true;
      if (this.phase === 'armed') this.setPhase('listening');
    } else if (this.latched && this.phase === 'listening') {
      // EnergyVad already applied its 2 s hangover before reporting silence.
      this.finish();
    }
  }

  onFrame(frame: AudioFrameMsg): void {
    if (!this.sessionId || !this.stt) return;
    if (this.phase !== 'armed' && this.phase !== 'listening') return;
    this.stt.sendAudio(frame.seq, frame.pcm);
    this.lastSeq = frame.seq;
    if (++this.frameCount >= MAX_SESSION_FRAMES) this.finish();
  }

  onCaptureError(message: string): void {
    if (!this.sessionId) return;
    this.fail('no-mic', message || 'Microphone unavailable');
  }

  // ---------- Transitions ----------

  private begin(): void {
    this.clearTimers();
    const id = randomUUID();

    // Focus snapshot BEFORE anything else (§3.1 step 2) — the insertion
    // target is whatever had focus when the chord went down.
    this.focusedApp = this.deps.getFocusedApp();
    if (this.focusedApp?.profile === 'off') {
      this.sessionId = id;
      this.setPhase('armed');
      this.deps.showOverlay();
      this.fail('app-disabled', 'Dictation is turned off for this app');
      return;
    }

    const stt = this.deps.startSttSession(id, this.focusedApp);
    if (!stt) {
      this.sessionId = id;
      this.setPhase('armed'); // brief flash so the error has a visible home
      this.deps.showOverlay();
      this.fail('network', "Can't reach Flow — check your connection");
      return;
    }

    this.sessionId = id;
    this.stt = stt;
    this.latched = false;
    this.sawSpeech = false;
    this.frameCount = 0;
    this.lastSeq = 0;

    stt.onInterim(({ text, stableWords }) => {
      if (this.sessionId === id) {
        this.deps.broadcast('dictation:interim', { text, stableWords });
      }
    });
    stt.onResult((result) => {
      if (this.sessionId === id) this.onServerResult(result.finalText);
    });
    stt.onError((code, message, rawTextSoFar) => {
      if (this.sessionId === id) {
        if (rawTextSoFar) pushRestoreStack(id, rawTextSoFar); // words never lost (§3.1)
        this.deps.broadcast('dictation:error', {
          kind: mapWsError(code),
          message,
          ...(rawTextSoFar ? { rawText: rawTextSoFar } : {}),
        });
        this.deps.requestCapture(false);
        this.setPhase('error', { kind: mapWsError(code), message });
        this.lingerTimer = setTimeout(() => {
          if (this.phase === 'error') this.reset();
        }, ERROR_LINGER_MS);
      }
    });

    // Pre-roll only carries frames when capture idles armed (releaseMicImmediately=false path).
    for (const frame of this.deps.takePreRoll()) {
      stt.sendAudio(frame.seq, frame.pcm);
    }

    this.setPhase('armed');
    this.deps.showOverlay();
    this.deps.requestCapture(true);
  }

  private finish(): void {
    if (this.phase !== 'armed' && this.phase !== 'listening') return;
    this.deps.requestCapture(false);

    if (!this.sawSpeech) {
      this.stt?.cancel();
      this.fail('no-speech', "Didn't catch anything — hold the key and speak");
      return;
    }

    this.setPhase('processing');
    this.stt?.finish(this.lastSeq);
    this.resultTimer = setTimeout(() => {
      if (this.phase === 'processing') {
        this.fail('network', 'Timed out waiting for the transcript');
      }
    }, RESULT_TIMEOUT_MS);
  }

  private onServerResult(text: string): void {
    this.clearTimers();
    const id = this.sessionId!;
    lastResult.id = id;
    lastResult.text = text;
    pushRestoreStack(id, text);
    const appName = this.focusedApp?.processName ?? null;
    if (text.trim()) {
      this.deps.addHistory({
        id,
        finalText: text,
        appName,
        wordCount: text.trim().split(/\s+/).length,
        durationMs: this.frameCount * 20,
      });
    }
    this.deps.broadcast('dictation:result', { id, text, appName });

    if (!text.trim()) {
      this.confirm();
      return;
    }

    this.setPhase('inserting');
    void this.deps
      .insertText(text, this.focusedApp?.processName ?? null)
      .then((ok) => {
        if (this.sessionId !== id) return; // cancelled/superseded meanwhile
        if (ok) this.confirm();
        else this.fail('insertion-failed', 'Copied to clipboard — press Ctrl+V to paste');
      })
      .catch(() => {
        if (this.sessionId !== id) return;
        this.fail('insertion-failed', 'Copied to clipboard — press Ctrl+V to paste');
      });
  }

  private confirm(): void {
    this.setPhase('confirmed');
    this.lingerTimer = setTimeout(() => {
      if (this.phase === 'confirmed') this.reset();
    }, CONFIRMED_LINGER_MS);
  }

  private fail(kind: ErrorKind, message: string): void {
    this.clearTimers();
    this.deps.broadcast('dictation:error', { kind, message });
    this.setPhase('error', { kind, message });
    this.lingerTimer = setTimeout(() => {
      if (this.phase === 'error') this.reset();
    }, ERROR_LINGER_MS);
  }

  private reset(): void {
    this.sessionId = null;
    this.stt = null;
    this.frameCount = 0;
    this.latched = false;
    this.setPhase('idle');
    this.deps.hideOverlay();
  }

  private setPhase(phase: DictationPhase, error?: { kind: ErrorKind; message: string }): void {
    this.phase = phase;
    this.deps.broadcast('dictation:state', {
      phase,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(error ? { error } : {}),
    });
  }

  private clearTimers(): void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    if (this.resultTimer) {
      clearTimeout(this.resultTimer);
      this.resultTimer = null;
    }
  }
}
