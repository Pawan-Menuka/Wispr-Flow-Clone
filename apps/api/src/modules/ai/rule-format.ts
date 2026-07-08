/**
 * Rule-based formatting fallback (BLUEPRINT §13.8): applied when the LLM is
 * unavailable, times out, or the utterance is too short to be worth a call.
 * Deterministic and fully unit-tested — the floor the product never sinks below.
 */

const FILLER_PATTERN = /(?:^|\s)(?:um+|uh+|erm+|mhm+)(?=[\s,.!?]|$)/gi;

const SPOKEN_PUNCTUATION: [RegExp, string][] = [
  [/\s*\bnew paragraph\b\s*/gi, '\n\n'],
  [/\s*\bnew line\b\s*/gi, '\n'],
  [/\s*\bfull stop\b\s*/gi, '. '],
  [/\s*\bperiod\b\s*/gi, '. '],
  [/\s*\bcomma\b\s*/gi, ', '],
  [/\s*\bquestion mark\b\s*/gi, '? '],
  [/\s*\bexclamation (?:point|mark)\b\s*/gi, '! '],
  [/\s*\bsemicolon\b\s*/gi, '; '],
  [/\s*\bcolon\b\s*/gi, ': '],
];

export function ruleFormat(raw: string): string {
  let text = raw.trim();
  if (!text) return '';

  text = text.replace(FILLER_PATTERN, '');
  for (const [pattern, replacement] of SPOKEN_PUNCTUATION) {
    text = text.replace(pattern, replacement);
  }

  // Collapse whitespace but preserve intentional line breaks.
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Capitalize sentence starts.
  text = text.replace(/(^|[.!?]\s+|\n+)([a-z])/g, (_m, prefix: string, letter: string) => {
    return prefix + letter.toUpperCase();
  });
  // Standalone "i".
  text = text.replace(/\bi\b/g, 'I');

  // Terminal punctuation for prose (skip if it already ends with any).
  if (text && !/[.!?:;,\n]$/.test(text)) {
    text += '.';
  }
  return text;
}
