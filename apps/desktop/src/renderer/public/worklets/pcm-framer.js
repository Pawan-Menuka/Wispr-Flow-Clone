/**
 * PCM framing worklet (BLUEPRINT §13.2): converts the 128-sample float blocks
 * the audio graph delivers into 320-sample (20 ms @ 16 kHz) Int16 frames and
 * posts them with a transferred buffer (no copy on the message boundary).
 * Plain JS on purpose — served as a static asset so CSP stays `script-src 'self'`.
 */
class PcmFramer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(320);
    this.offset = 0;
    this.calls = 0;
    this.port.postMessage({ dbg: 'ctor' });
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (this.calls++ === 0) {
      this.port.postMessage({ dbg: 'first-process', hasInput: Boolean(channel) });
    }
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.frame[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.offset === 320) {
        const out = this.frame;
        this.port.postMessage(out, [out.buffer]);
        this.frame = new Int16Array(320);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-framer', PcmFramer);
