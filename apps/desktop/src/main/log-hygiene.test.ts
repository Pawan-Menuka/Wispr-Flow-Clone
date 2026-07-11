import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §15.1 / §30: transcript text and window titles never appear in any log
 * line — source-level enforcement for the whole desktop main process
 * (renderer console is piped through main during smoke runs, so main is the
 * chokepoint that matters).
 */

const SRC_ROOT = __dirname; // src/main
const FORBIDDEN =
  /console\.\w+\s*\([^;]*?\b(finalText|rawText|transcript|interimText|windowTitle)\b/s;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

describe('log hygiene (desktop main)', () => {
  it('no console call references transcript/window-title identifiers', () => {
    const offenders = tsFiles(SRC_ROOT).filter((file) =>
      FORBIDDEN.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
