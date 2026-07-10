/**
 * STT provider abstraction (BLUEPRINT §12.4). The dictation gateway only
 * talks to these interfaces; Deepgram (Phase 7), a failover provider, and
 * the local echo stub all implement them.
 */

export interface SttInterim {
  text: string;
  stableWords: number;
}

export interface SttStream {
  sendAudio(pcm: Int16Array): void;
  /** Flush and resolve with the final transcript. */
  finish(): Promise<string>;
  cancel(): void;
  onInterim(listener: (interim: SttInterim) => void): void;
  onError(listener: (message: string) => void): void;
  /**
   * Finalized text accumulated so far (§12.6 parallelism) — lets the LLM
   * start on the bulk of the transcript while the tail finalizes.
   */
  textSoFar(): string;
}

export interface SttOpenOptions {
  language?: string;
  sampleRate: number;
  keywords?: string[];
}

export interface SttProvider {
  readonly name: string;
  open(opts: SttOpenOptions): Promise<SttStream>;
}

/**
 * Echo provider: no recognition, just accounting — proves the full protocol
 * (frames in, interims out, final on finish) without any vendor dependency.
 */
export class EchoSttProvider implements SttProvider {
  readonly name = 'echo';

  open(_opts: SttOpenOptions): Promise<SttStream> {
    return Promise.resolve(new EchoSttStream());
  }
}

const FRAMES_PER_INTERIM = 25; // every 500 ms of audio

class EchoSttStream implements SttStream {
  private frames = 0;
  private interimListeners: ((interim: SttInterim) => void)[] = [];
  private cancelled = false;

  sendAudio(_pcm: Int16Array): void {
    if (this.cancelled) return;
    this.frames++;
    if (this.frames % FRAMES_PER_INTERIM === 0) {
      const interim = { text: this.describe(), stableWords: 1 };
      for (const listener of this.interimListeners) listener(interim);
    }
  }

  finish(): Promise<string> {
    return Promise.resolve(this.cancelled ? '' : this.describe());
  }

  cancel(): void {
    this.cancelled = true;
  }

  onInterim(listener: (interim: SttInterim) => void): void {
    this.interimListeners.push(listener);
  }

  onError(_listener: (message: string) => void): void {
    // The echo stream cannot fail.
  }

  textSoFar(): string {
    return this.cancelled ? '' : this.describe();
  }

  private describe(): string {
    return `[echo] received ${((this.frames * 20) / 1000).toFixed(1)}s of audio (${this.frames} frames)`;
  }
}
