import { WebSocket } from 'ws';
import type { SttInterim, SttOpenOptions, SttProvider, SttStream } from './stt.js';

/**
 * Deepgram streaming STT (BLUEPRINT §12.1). Linear16 PCM in, interim +
 * final transcripts out. One Deepgram WS per dictation session (the
 * pre-warmed pool arrives with scale, §9.2).
 */
export class DeepgramSttProvider implements SttProvider {
  readonly name = 'deepgram';

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env['DEEPGRAM_MODEL'] ?? 'nova-2',
  ) {}

  async open(opts: SttOpenOptions): Promise<SttStream> {
    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: String(opts.sampleRate),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      model: this.model,
    });
    if (opts.language && opts.language !== 'auto') params.set('language', opts.language);
    if (opts.keywords?.length) {
      for (const keyword of opts.keywords.slice(0, 100)) params.append('keywords', keyword);
    }

    const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('deepgram connect timeout')), 5_000);
      socket.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    return new DeepgramStream(socket);
  }
}

/** Pure accumulator for Deepgram result messages — unit-testable. */
export function accumulateDeepgram(
  finals: string[],
  raw: string,
): { interim: SttInterim | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { interim: null };
  }
  const msg = parsed as {
    type?: string;
    is_final?: boolean;
    channel?: { alternatives?: { transcript?: string }[] };
  };
  if (msg.type !== 'Results') return { interim: null };
  const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';

  if (msg.is_final) {
    if (transcript) finals.push(transcript);
    const text = finals.join(' ');
    return { interim: { text, stableWords: countWords(text) } };
  }
  if (!transcript) return { interim: null };
  const stable = finals.join(' ');
  const text = stable ? `${stable} ${transcript}` : transcript;
  return { interim: { text, stableWords: countWords(stable) } };
}

function countWords(text: string): number {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

class DeepgramStream implements SttStream {
  private finals: string[] = [];
  private interimListeners: ((interim: SttInterim) => void)[] = [];
  private errorListeners: ((message: string) => void)[] = [];
  private closed: Promise<void>;

  constructor(private readonly socket: WebSocket) {
    this.closed = new Promise((resolve) => socket.once('close', () => resolve()));
    socket.on('message', (data) => {
      const { interim } = accumulateDeepgram(this.finals, data.toString());
      if (interim) for (const listener of this.interimListeners) listener(interim);
    });
    socket.on('error', (err) => {
      for (const listener of this.errorListeners) listener(err.message);
    });
  }

  sendAudio(pcm: Int16Array): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  async finish(): Promise<string> {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'CloseStream' }));
    }
    // Deepgram flushes trailing finals then closes; cap the wait.
    await Promise.race([this.closed, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    return this.finals.join(' ');
  }

  cancel(): void {
    this.socket.close();
  }

  onInterim(listener: (interim: SttInterim) => void): void {
    this.interimListeners.push(listener);
  }

  onError(listener: (message: string) => void): void {
    this.errorListeners.push(listener);
  }
}
