import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ruleFormat } from './rule-format.js';

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/golden.json'), 'utf8'),
) as { cases: { name: string; raw: string; rule?: string }[] };

describe('ruleFormat (deterministic fallback)', () => {
  for (const testCase of fixtures.cases.filter((c) => c.rule)) {
    it(testCase.name, () => {
      expect(ruleFormat(testCase.raw)).toBe(testCase.rule);
    });
  }

  it('handles empty and whitespace input', () => {
    expect(ruleFormat('')).toBe('');
    expect(ruleFormat('   ')).toBe('');
  });

  it('capitalizes standalone i and keeps existing punctuation', () => {
    expect(ruleFormat('i said i would go!')).toBe('I said I would go!');
  });

  it('does not mangle words containing filler substrings', () => {
    expect(ruleFormat('the umbrella is uhm mine')).toBe('The umbrella is uhm mine.');
  });
});
