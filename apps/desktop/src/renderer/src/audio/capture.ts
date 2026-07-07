import { EnergyVad, frameRms } from './vad';
import type { Vad } from './vad';

/**
 * Mic capture in the hidden main-window renderer (BLUEPRINT §7.2, §13.1–13.4):
 * getUserMedia (Chromium EC/NS/AGC for free) → AudioWorklet 20 ms Int16 frames
 * → VAD + RMS here → frames forwarded to the main process over a MessagePort
 * with transferred buffers.
 *
 * Port protocol (renderer → main):
 *   { type: 'frame', seq, speaking, rms, pcm: Int16Array }   (buffer transferred)
 *   { type: 'vad', speaking }                                 (transitions only)
 *   { type: 'capture', active }                               (ack of start/stop)
 *   { type: 'error', message }
 */
export class CaptureController {
  private mainPort: MessagePort | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private vad: Vad = new EnergyVad({ sensitivity: 0.5 });
  private sensitivity = 0.5;
  private seq = 0;
  private active = false;
  private levelListeners = new Set<(rms: number) => void>();

  /** Wire the MessagePort handed over by the main process. */
  attachMainPort(port: MessagePort): void {
    this.mainPort = port;
    port.start();
  }

  setSensitivity(sensitivity: number): void {
    this.sensitivity = sensitivity;
    this.vad = new EnergyVad({ sensitivity });
  }

  /** Local level subscription (device-test meter in settings/dev shell). */
  onLevel(listener: (rms: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  get isActive(): boolean {
    return this.active;
  }

  async start(deviceId: string): Promise<void> {
    if (this.active) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          channelCount: 1,
          sampleRate: 16_000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.audioContext = new AudioContext({ sampleRate: 16_000 });
      // Hidden window = no user gesture; Chromium may start the context suspended.
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      await this.audioContext.audioWorklet.addModule('worklets/pcm-framer.js');
      console.warn(`[capture] context ${this.audioContext.state} @${this.audioContext.sampleRate}Hz`);
      const source = this.audioContext.createMediaStreamSource(this.stream);
      // The node needs a path to the destination or the graph never pulls it
      // (process() would not run). Its output is silence, so this is inaudible.
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-framer', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.workletNode.port.onmessage = (event: MessageEvent<Int16Array>) => {
        if (!(event.data instanceof Int16Array)) {
          console.warn('[capture] worklet dbg:', JSON.stringify(event.data));
          return;
        }
        this.handleFrame(event.data);
      };
      source.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);
      this.vad.reset();
      this.seq = 0;
      this.active = true;
      this.mainPort?.postMessage({ type: 'capture', active: true });
    } catch (err) {
      this.mainPort?.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : 'mic capture failed',
      });
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    await this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.mainPort?.postMessage({ type: 'capture', active: false });
  }

  async restart(deviceId: string): Promise<void> {
    if (!this.active) return;
    await this.stop();
    await this.start(deviceId);
  }

  private handleFrame(pcm: Int16Array): void {
    if (!this.active) return;
    const rms = frameRms(pcm);
    const wasSpeaking = this.vad.speaking;
    const speaking = this.vad.update(rms);
    for (const listener of this.levelListeners) listener(rms);

    if (this.mainPort) {
      if (speaking !== wasSpeaking) {
        this.mainPort.postMessage({ type: 'vad', speaking });
      }
      // No transfer list: Electron ports only accept MessagePorts as
      // transferables — passing pcm.buffer throws. Copying 640 B is fine.
      this.mainPort.postMessage({ type: 'frame', seq: this.seq++, speaking, rms, pcm });
    }
  }
}

export const capture = new CaptureController();

/** List available microphones. Labels populate after first permission grant. */
export async function listMicrophones(): Promise<{ deviceId: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}
