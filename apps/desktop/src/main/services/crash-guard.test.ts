import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CrashGuard, assessBoot } from './crash-guard';

const NOW = new Date('2026-07-11T10:00:00Z');

describe('assessBoot', () => {
  it('first boot ever is clean', () => {
    const { record, crashLoop } = assessBoot(null, NOW);
    expect(crashLoop).toBe(false);
    expect(record).toEqual({ bootAt: NOW.toISOString(), stable: false, quickExits: 0 });
  });

  it('a stable previous run resets the counter', () => {
    const prev = { bootAt: '2026-07-10T00:00:00Z', stable: true, quickExits: 5 };
    const { record, crashLoop } = assessBoot(prev, NOW);
    expect(crashLoop).toBe(false);
    expect(record.quickExits).toBe(0);
  });

  it('an unstable previous run increments the counter', () => {
    const prev = { bootAt: '2026-07-11T09:59:30Z', stable: false, quickExits: 0 };
    const { record, crashLoop } = assessBoot(prev, NOW);
    expect(crashLoop).toBe(false);
    expect(record.quickExits).toBe(1);
  });

  it('two quick exits in a row is a crash loop', () => {
    const prev = { bootAt: '2026-07-11T09:59:30Z', stable: false, quickExits: 1 };
    const { crashLoop } = assessBoot(prev, NOW);
    expect(crashLoop).toBe(true);
  });
});

describe('CrashGuard (file round-trip)', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('detects a loop across boots and clears after markStable', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'flow-crash-'));
    const file = path.join(dir, 'crash-guard.json');

    expect(new CrashGuard(file).boot(NOW)).toBe(false); // boot 1, never stable
    expect(new CrashGuard(file).boot(NOW)).toBe(false); // boot 2, never stable
    expect(new CrashGuard(file).boot(NOW)).toBe(true); // boot 3 → loop

    const recovered = new CrashGuard(file);
    expect(recovered.boot(NOW)).toBe(true); // still looping…
    recovered.markStable(); // …until a run survives
    expect(new CrashGuard(file).boot(NOW)).toBe(false);
  });
});
