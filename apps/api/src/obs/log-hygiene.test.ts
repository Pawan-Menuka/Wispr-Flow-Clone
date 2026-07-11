import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * §15.1 / §30 launch checklist: "transcript text never appears in any log
 * line" — enforced with a source-level scan. Any console call whose argument
 * expression mentions a transcript-bearing identifier fails the build.
 */

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = /console\.\w+\s*\([^;]*?\b(finalText|rawText|transcript|interimText)\b/s;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

describe('log hygiene', () => {
  it('no console call references transcript text identifiers', () => {
    const offenders = tsFiles(SRC_ROOT).filter((file) =>
      FORBIDDEN.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
