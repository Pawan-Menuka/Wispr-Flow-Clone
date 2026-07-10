import { describe, expect, it } from 'vitest';
import {
  AUDIO_FRAME_KIND,
  decodeAudioFrame,
  encodeAudioFrame,
  parseClientMessage,
  parseServerMessage,
} from './ws-protocol.js';

const SESSION_ID = '5f0dc6a7-9d3a-4f89-8b56-8c9a4c1a2b3c';

describe('ws message parsing', () => {
  it('accepts a valid session.start and applies defaults', () => {
    const msg = parseClientMessage(
      JSON.stringify({
        t: 'session.start',
        sessionId: SESSION_ID,
        appContext: { processName: 'slack.exe' },
      }),
    );
    expect(msg).not.toBeNull();
    if (msg?.t === 'session.start') {
      expect(msg.mode).toBe('dictate');
      expect(msg.appContext.profile).toBe('default');
    }
  });

  it('session.start carries a bounded dictionary', () => {
    const msg = parseClientMessage(
      JSON.stringify({
        t: 'session.start',
        sessionId: SESSION_ID,
        appContext: { processName: 'x' },
        dictionary: ['Kubernetes', 'Pawan'],
      }),
    );
    if (msg?.t === 'session.start') {
      expect(msg.dictionary).toEqual(['Kubernetes', 'Pawan']);
    } else {
      expect.unreachable();
    }
    // over the 50-term cap → rejected
    expect(
      parseClientMessage(
        JSON.stringify({
          t: 'session.start',
          sessionId: SESSION_ID,
          appContext: { processName: 'x' },
          dictionary: Array(51).fill('term'),
        }),
      ),
    ).toBeNull();
  });

  it('rejects unknown message types and malformed JSON', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'evil.op' }))).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'session.finish', sessionId: 'not-a-uuid', lastSeq: 1 }))).toBeNull();
  });

  it('round-trips a server result message', () => {
    const raw = JSON.stringify({
      t: 'session.result',
      sessionId: SESSION_ID,
      finalText: 'Hello world.',
      rawText: 'hello world',
      formatted: true,
      wordCount: 2,
      durationMs: 1500,
      latencyMs: 480,
    });
    const msg = parseServerMessage(raw);
    expect(msg?.t).toBe('session.result');
  });
});

describe('audio framing', () => {
  it('encodes and decodes a frame losslessly', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234]);
    const buf = encodeAudioFrame(41, pcm);
    expect(new Uint8Array(buf)[0]).toBe(AUDIO_FRAME_KIND);
    const frame = decodeAudioFrame(buf);
    expect(frame?.seq).toBe(41);
    expect(Array.from(frame!.pcm)).toEqual(Array.from(pcm));
  });

  it('wraps seq at 16 bits', () => {
    const frame = decodeAudioFrame(encodeAudioFrame(65536 + 7, new Int16Array([5])));
    expect(frame?.seq).toBe(7);
  });

  it('rejects frames with a wrong kind byte', () => {
    const buf = encodeAudioFrame(1, new Int16Array([5]));
    new Uint8Array(buf)[0] = 0x02;
    expect(decodeAudioFrame(buf)).toBeNull();
  });
});
