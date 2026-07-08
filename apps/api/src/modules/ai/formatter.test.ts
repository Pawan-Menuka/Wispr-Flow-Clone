import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FormattingService, sanitize } from './formatter.js';
import { AnthropicLlmProvider } from './llm.js';
import type { LlmProvider } from './llm.js';

describe('FormattingService orchestration', () => {
  it('short utterances skip the LLM entirely', async () => {
    let called = false;
    const provider: LlmProvider = {
      name: 'fake',
      complete: async () => {
        called = true;
        return 'x';
      },
    };
    const service = new FormattingService(provider);
    const result = await service.format('send it now', { language: 'en', appProfile: 'default' });
    expect(called).toBe(false);
    expect(result).toEqual({ text: 'Send it now.', formatted: false });
  });

  it('LLM output is used when it succeeds', async () => {
    const provider: LlmProvider = {
      name: 'fake',
      complete: async () => 'So I think we should ship it on Friday.',
    };
    const service = new FormattingService(provider);
    const result = await service.format('um so i think we should uh ship it on friday', {
      language: 'en',
      appProfile: 'default',
    });
    expect(result.formatted).toBe(true);
    expect(result.text).toBe('So I think we should ship it on Friday.');
  });

  it('LLM failure degrades to rules, never throws', async () => {
    const provider: LlmProvider = {
      name: 'fake',
      complete: async () => {
        throw new Error('vendor down');
      },
    };
    const service = new FormattingService(provider);
    const result = await service.format('this is a longer utterance to format', {
      language: 'en',
      appProfile: 'default',
    });
    expect(result.formatted).toBe(false);
    expect(result.text).toBe('This is a longer utterance to format.');
  });

  it('empty LLM output degrades to rules', async () => {
    const provider: LlmProvider = { name: 'fake', complete: async () => '   ' };
    const service = new FormattingService(provider);
    const result = await service.format('another long utterance goes right here', {
      language: 'en',
      appProfile: 'default',
    });
    expect(result.formatted).toBe(false);
  });

  it('sanitize strips fences and wrapping quotes', () => {
    expect(sanitize('```\nHello there.\n```')).toBe('Hello there.');
    expect(sanitize('"Hello there."')).toBe('Hello there.');
    expect(sanitize('Plain text.')).toBe('Plain text.');
  });
});

// ---------- Live golden suite (runs only with a real key) ----------

const apiKey = process.env['ANTHROPIC_API_KEY'];

describe.skipIf(!apiKey)('formatting golden set (live LLM)', () => {
  const fixtures = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/golden.json'), 'utf8'),
  ) as { cases: { name: string; raw: string; llm?: string }[] };

  const service = new FormattingService(new AnthropicLlmProvider(apiKey!));

  for (const testCase of fixtures.cases.filter((c) => c.llm)) {
    it(testCase.name, { timeout: 15_000 }, async () => {
      const result = await service.format(testCase.raw, {
        language: 'en',
        appProfile: 'default',
      });
      expect(result.formatted).toBe(true);
      // LLM output is nondeterministic — assert similarity, not equality (§22).
      const score = similarity(result.text, testCase.llm!);
      expect(score, `got: "${result.text}" want≈ "${testCase.llm}"`).toBeGreaterThanOrEqual(0.75);
    });
  }
});

/** Word-level Dice coefficient. */
function similarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Map<string, number>();
  for (const token of tokensB) setB.set(token, (setB.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of tokensA) {
    const count = setB.get(token) ?? 0;
    if (count > 0) {
      overlap++;
      setB.set(token, count - 1);
    }
  }
  return (2 * overlap) / (tokensA.length + tokensB.length);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
}
