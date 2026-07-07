/**
 * Chord parsing for global hotkeys (BLUEPRINT §14.1). Pure module — no
 * uiohook import — so it is unit-testable. Keycodes mirror uiohook-napi's
 * `UiohookKey` values (stable scancode-derived constants); left/right
 * variants of a modifier are interchangeable.
 */

/** Each group = acceptable keycodes for one chord member (left/right variants). */
export type ChordGroups = number[][];

const KEY_GROUPS: Record<string, number[]> = {
  ctrl: [29, 3613], // Ctrl, CtrlRight
  shift: [42, 54],
  alt: [56, 3640],
  win: [3675, 3676], // Meta, MetaRight
  cmd: [3675, 3676],
  meta: [3675, 3676],
  space: [57],
  esc: [1],
  tab: [15],
  // Function keys
  f1: [59], f2: [60], f3: [61], f4: [62], f5: [63], f6: [64],
  f7: [65], f8: [66], f9: [67], f10: [68], f11: [87], f12: [88],
};

// Letter keys (uiohook: A=30 follows QWERTY scancode order, not alphabetical).
const LETTER_CODES: Record<string, number> = {
  q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25,
  a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38,
  z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50,
};

export const ESC_KEYCODE = 1;

const MODIFIER_NAMES = new Set(['ctrl', 'shift', 'alt', 'win', 'cmd', 'meta']);

export function parseChord(chord: string): ChordGroups | null {
  const parts = chord
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const groups: ChordGroups = [];
  for (const part of parts) {
    const group = KEY_GROUPS[part] ?? (LETTER_CODES[part] ? [LETTER_CODES[part]] : undefined);
    if (!group) return null;
    groups.push(group);
  }

  // A chord that is a single non-modifier key (e.g. "F9") is allowed;
  // a single bare letter is not (would fire while typing).
  if (groups.length === 1) {
    const only = parts[0]!;
    if (LETTER_CODES[only]) return null;
    if (MODIFIER_NAMES.has(only)) return null; // lone modifier: too trigger-happy
  }
  return groups;
}

/** True when every chord group has at least one of its keycodes held down. */
export function chordSatisfied(groups: ChordGroups, downKeys: ReadonlySet<number>): boolean {
  return groups.every((group) => group.some((code) => downKeys.has(code)));
}
