import { MessageChannelMain } from 'electron';
import type { MessagePortMain, WebContents } from 'electron';
import type { WindowManager } from '../windows';

export interface AudioFrameMsg {
  seq: number;
  speaking: boolean;
  rms: number;
  pcm: Int16Array;
}

/** 300 ms pre-roll (BLUEPRINT §13.3) = 15 × 20 ms frames. */
const PRE_ROLL_FRAMES = 15;

/**
 * Main-process end of the audio path (§7.2): owns the MessagePort to the
 * hidden renderer, keeps the pre-roll ring, relays levels to the overlay,
 * and hands frames/VAD transitions to whoever is dictating (Phase 5).
 */
export class AudioBridge {
  private port: MessagePortMain | null = null;
  private preRoll: AudioFrameMsg[] = [];
  private captureActive = false;
  private levelTick = 0;
  private frameListeners = new Set<(frame: AudioFrameMsg) => void>();
  private vadListeners = new Set<(speaking: boolean) => void>();
  private errorListeners = new Set<(message: string) => void>();

  constructor(private readonly windows: WindowManager) {}

  /** Hand a fresh port pair to (each load of) the hidden renderer. */
  attach(webContents: WebContents): void {
    this.port?.close();
    const { port1, port2 } = new MessageChannelMain();
    this.port = port1;
    port1.on('message', (event) => this.onMessage(event.data));
    port1.start();
    webContents.postMessage('flow:audio-port', null, [port2]);
  }

  /** Ask the renderer to start/stop the mic. */
  requestCapture(active: boolean): void {
    this.windows.broadcast('audio:capture', { active });
    if (!active) this.preRoll = [];
  }

  get isCapturing(): boolean {
    return this.captureActive;
  }

  /** Drain the pre-roll ring (start of a speech segment must include it). */
  takePreRoll(): AudioFrameMsg[] {
    const frames = this.preRoll;
    this.preRoll = [];
    return frames;
  }

  onFrame(listener: (frame: AudioFrameMsg) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onVad(listener: (speaking: boolean) => void): () => void {
    this.vadListeners.add(listener);
    return () => this.vadListeners.delete(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const data = msg as Record<string, unknown>;
    switch (data['type']) {
      case 'frame': {
        const frame: AudioFrameMsg = {
          seq: Number(data['seq']),
          speaking: Boolean(data['speaking']),
          rms: Number(data['rms']),
          pcm: data['pcm'] as Int16Array,
        };
        this.preRoll.push(frame);
        if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
        for (const listener of this.frameListeners) listener(frame);
        // ~25 Hz level feed for the overlay waveform (every 2nd 20 ms frame).
        if (this.levelTick++ % 2 === 0) {
          this.windows.broadcast('audio:level', { rms: frame.rms });
        }
        break;
      }
      case 'vad':
        for (const listener of this.vadListeners) listener(Boolean(data['speaking']));
        break;
      case 'capture':
        this.captureActive = Boolean(data['active']);
        break;
      case 'error': {
        const message = String(data['message'] ?? 'mic error');
        console.warn('[audio] capture error:', message);
        for (const listener of this.errorListeners) listener(message);
        break;
      }
    }
  }
}
