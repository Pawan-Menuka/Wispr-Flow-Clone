import { describe, expect, it } from 'vitest';
import { chordSatisfied, parseChord } from './chords';

describe('parseChord', () => {
  it('parses the default Ctrl+Win chord with left/right variants', () => {
    const groups = parseChord('Ctrl+Win');
    expect(groups).toEqual([
      [29, 3613],
      [3675, 3676],
    ]);
  });

  it('is case/whitespace insensitive', () => {
    expect(parseChord(' ctrl + WIN ')).toEqual(parseChord('Ctrl+Win'));
  });

  it('allows a lone function key but not a lone letter or modifier', () => {
    expect(parseChord('F9')).toEqual([[67]]);
    expect(parseChord('V')).toBeNull();
    expect(parseChord('Ctrl')).toBeNull();
  });

  it('rejects unknown keys and empty chords', () => {
    expect(parseChord('Ctrl+Banana')).toBeNull();
    expect(parseChord('')).toBeNull();
  });
});

describe('chordSatisfied', () => {
  const groups = parseChord('Ctrl+Win')!;

  it('fires with either side of each modifier', () => {
    expect(chordSatisfied(groups, new Set([29, 3675]))).toBe(true);
    expect(chordSatisfied(groups, new Set([3613, 3676]))).toBe(true);
  });

  it('requires every group', () => {
    expect(chordSatisfied(groups, new Set([29]))).toBe(false);
    expect(chordSatisfied(groups, new Set())).toBe(false);
  });

  it('tolerates extra held keys', () => {
    expect(chordSatisfied(groups, new Set([29, 3675, 30]))).toBe(true);
  });
});
