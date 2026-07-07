/**
 * Voice-activity detection behind a stable interface (BLUEPRINT §13.4).
 * Current engine is energy-based (RMS threshold + hangover) — good enough to
 * gate streaming and drive UX. Silero ONNX drops into the same interface
 * later without touching callers.
 */
export interface Vad {
  /** Feed one 20 ms frame's RMS (0..1). Returns current speaking state. */
  update(rms: number): boolean;
  readonly speaking: boolean;
  reset(): void;
}

export interface VadOptions {
  /** settings.vadSensitivity, 0.2 (least sensitive) .. 0.8 (most). */
  sensitivity: number;
  /** Silence duration that ends a speech segment. */
  hangoverMs?: number;
}

const FRAME_MS = 20;

export class EnergyVad implements Vad {
  private threshold: number;
  private readonly hangoverFrames: number;
  private aboveStreak = 0;
  private silenceStreak = 0;
  private _speaking = false;

  constructor(opts: VadOptions) {
    // sensitivity 0.2 → threshold ~0.040 (needs loud speech)
    // sensitivity 0.8 → threshold ~0.007 (picks up quiet speech)
    this.threshold = 0.051 - opts.sensitivity * 0.055;
    this.hangoverFrames = Math.round((opts.hangoverMs ?? 2000) / FRAME_MS);
  }

  get speaking(): boolean {
    return this._speaking;
  }

  update(rms: number): boolean {
    if (rms >= this.threshold) {
      this.aboveStreak++;
      this.silenceStreak = 0;
      // Two consecutive voiced frames (40 ms) to start — rejects clicks.
      if (!this._speaking && this.aboveStreak >= 2) this._speaking = true;
    } else {
      this.aboveStreak = 0;
      if (this._speaking && ++this.silenceStreak >= this.hangoverFrames) {
        this._speaking = false;
      }
    }
    return this._speaking;
  }

  reset(): void {
    this.aboveStreak = 0;
    this.silenceStreak = 0;
    this._speaking = false;
  }
}

export function frameRms(pcm: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i]! / 0x8000;
    sum += sample * sample;
  }
  return Math.sqrt(sum / pcm.length);
}
