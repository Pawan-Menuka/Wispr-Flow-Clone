import { describe, expect, it } from 'vitest';
import { accumulateDeepgram } from './deepgram.js';

function results(transcript: string, isFinal: boolean): string {
  return JSON.stringify({
    type: 'Results',
    is_final: isFinal,
    channel: { alternatives: [{ transcript }] },
  });
}

describe('accumulateDeepgram', () => {
  it('builds interims from finals + current partial with stable word counts', () => {
    const finals: string[] = [];

    let out = accumulateDeepgram(finals, results('hello', false));
    expect(out.interim).toEqual({ text: 'hello', stableWords: 0 });

    out = accumulateDeepgram(finals, results('hello world', true));
    expect(out.interim).toEqual({ text: 'hello world', stableWords: 2 });

    out = accumulateDeepgram(finals, results('how are', false));
    expect(out.interim).toEqual({ text: 'hello world how are', stableWords: 2 });

    out = accumulateDeepgram(finals, results('how are you', true));
    expect(finals).toEqual(['hello world', 'how are you']);
    expect(out.interim).toEqual({ text: 'hello world how are you', stableWords: 5 });
  });

  it('ignores metadata, empty partials, and malformed JSON', () => {
    const finals: string[] = [];
    expect(accumulateDeepgram(finals, JSON.stringify({ type: 'Metadata' })).interim).toBeNull();
    expect(accumulateDeepgram(finals, results('', false)).interim).toBeNull();
    expect(accumulateDeepgram(finals, 'garbage').interim).toBeNull();
    expect(finals).toEqual([]);
  });

  it('empty final still emits (finalizes the interim display)', () => {
    const finals = ['hello'];
    const out = accumulateDeepgram(finals, results('', true));
    expect(out.interim).toEqual({ text: 'hello', stableWords: 1 });
    expect(finals).toEqual(['hello']);
  });
});
