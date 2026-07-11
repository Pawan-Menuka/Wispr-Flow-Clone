import { describe, expect, it } from 'vitest';
import { hashPii, redact } from './redact.js';

describe('redact (§25 — no transcript text in logs, ever)', () => {
  it('drops transcript-bearing and credential keys at any depth', () => {
    const out = redact({
      sessionId: 's1',
      finalText: 'the user said something private',
      rawText: 'raw words',
      text: 'more words',
      nested: { transcript: 'hi', interim: 'partial', latencyMs: 42 },
      authorization: 'Bearer abc',
      refresh_token: 'r1',
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/private|raw words|more words|Bearer|r1/);
    expect(out['sessionId']).toBe('s1');
    expect((out['nested'] as Record<string, unknown>)['latencyMs']).toBe(42);
  });

  it('hashes emails and process names instead of dropping them', () => {
    const out = redact({ email: 'Pawan@example.com', processName: 'chrome.exe' }) as Record<
      string,
      unknown
    >;
    expect(out['email']).toBe(hashPii('pawan@example.com'));
    expect(out['email']).not.toContain('@');
    expect(out['processName']).toHaveLength(12);
  });

  it('passes primitives, arrays and numbers through', () => {
    expect(redact({ words: 12, ok: true, kinds: ['a', 'b'] })).toEqual({
      words: 12,
      ok: true,
      kinds: ['a', 'b'],
    });
  });
});
