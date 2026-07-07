import { randomUUID } from 'node:crypto';
import type { DictationPhase, ErrorKind, EventChannel, FlowEvents } from '@flow/shared';
import type { AudioFrameMsg } from '../services/audio-bridge';
import { lastResult } from './results';

/**
 * The §3.1 dictation state machine, main-process side.
 * IDLE → ARMED → LISTENING → PROCESSING → (INSERTING) → CONFIRMED → IDLE,
 * with ERROR(kind) branches. Electron-free by design (deps injected) so the
 * transitions are unit-testable.
 *
 * Hotkey semantics (BLUEPRINT §2 F1):
 *  - hotkeyMode 'hold': chord-up finishes (push-to-talk), unless the press was
 *    a tap (< 300 ms) — then it latches into toggle: next tap or 2 s VAD
 *    silence finishes.
 *  - hotkeyMode 'toggle': every press toggles.
 * Phase 5 stub: "processing" produces a placeholder result from the captured
 * frames. Phases 6–7 replace finalize() with the streaming STT session.
 */

const TAP_THRESHOLD_MS = 300;
const MAX_SESSION_FRAMES = 5 * 60 * 50; // 5 min of 20 ms frames
const CONFIRMED_LINGER_MS = 3_000;
const ERROR_LINGER_MS = 4_000;

export interface ControllerDeps {
  broadcast<K extends EventChannel>(channel: K, payload: FlowEvents[K]): void;
  showOverlay(): void;
  hideOverlay(): void;
  requestCapture(active: boolean): void;
  takePreRoll(): AudioFrameMsg[];
  getHotkeyMode(): 'hold' | 'toggle';
  now?(): number;
}

export class DictationController {
  private phase: DictationPhase = 'idle';
  private sessionId: string | null = null;
  private latched = false; // true once the session runs in toggle mode
  private chordDownAt = 0;
  private sawSpeech = false;
  private frames: AudioFrameMsg[] = [];
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;

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
    const heldMs = this.now() - this.chordDownAt;
    if (this.deps.getHotkeyMode() === 'toggle' || heldMs < TAP_THRESHOLD_MS) {
      this.latched = true; // tap → latch into toggle
    } else {
      this.finish(); // push-to-talk release
    }
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
    this.clearLinger();
    this.deps.requestCapture(false);
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
    if (!this.sessionId) return;
    if (this.phase !== 'armed' && this.phase !== 'listening') return;
    this.frames.push(frame);
    if (this.frames.length >= MAX_SESSION_FRAMES) this.finish();
  }

  onCaptureError(message: string): void {
    if (!this.sessionId) return;
    this.fail('no-mic', message || 'Microphone unavailable');
  }

  // ---------- Transitions ----------

  private begin(): void {
    this.clearLinger();
    this.sessionId = randomUUID();
    this.latched = false;
    this.sawSpeech = false;
    this.chordDownAt = this.now();
    this.frames = this.deps.takePreRoll();
    this.setPhase('armed');
    this.deps.showOverlay();
    this.deps.requestCapture(true);
  }

  private finish(): void {
    if (this.phase !== 'armed' && this.phase !== 'listening') return;
    this.deps.requestCapture(false);

    if (!this.sawSpeech) {
      this.fail('no-speech', "Didn't catch anything — hold the key and speak");
      return;
    }

    this.setPhase('processing');
    void this.finalize();
  }

  /**
   * Phase 5 stub finalization. Phases 6–7 replace this with the WS streaming
   * session (audio already streamed during LISTENING; this just awaits the
   * server result).
   */
  private async finalize(): Promise<void> {
    const id = this.sessionId!;
    const durationMs = this.frames.length * 20;
    const voiced = this.frames.filter((frame) => frame.speaking).length;
    const text = `[stub] heard ${(voiced * 20 / 1000).toFixed(1)}s of speech (${durationMs / 1000}s captured) — STT arrives in Phase 7`;

    lastResult.id = id;
    lastResult.text = text;
    this.deps.broadcast('dictation:result', { id, text, appName: null });
    this.setPhase('confirmed');
    this.lingerTimer = setTimeout(() => {
      if (this.phase === 'confirmed') this.reset();
    }, CONFIRMED_LINGER_MS);
  }

  private fail(kind: ErrorKind, message: string): void {
    this.deps.broadcast('dictation:error', { kind, message });
    this.setPhase('error', { kind, message });
    this.lingerTimer = setTimeout(() => {
      if (this.phase === 'error') this.reset();
    }, ERROR_LINGER_MS);
  }

  private reset(): void {
    this.sessionId = null;
    this.frames = [];
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

  private clearLinger(): void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}
