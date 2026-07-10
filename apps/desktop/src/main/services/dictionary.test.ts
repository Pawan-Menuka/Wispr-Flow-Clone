import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DictionaryService, SESSION_TERM_LIMIT } from './dictionary';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dict-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('DictionaryService', () => {
  it('adds, persists, and reloads terms newest-first', () => {
    const service = new DictionaryService(dir);
    service.add('Kubernetes');
    service.add('Mihijith', 'user name');

    const reloaded = new DictionaryService(dir);
    expect(reloaded.list().map((t) => t.phrase)).toEqual(['Mihijith', 'Kubernetes']);
    expect(reloaded.list()[0]!.hint).toBe('user name');
  });

  it('rejects duplicates (case-insensitive), empties, and oversized phrases', () => {
    const service = new DictionaryService(dir);
    service.add('Neon');
    service.add('neon');
    service.add('   ');
    service.add('x'.repeat(81));
    expect(service.list()).toHaveLength(1);
  });

  it('remove is case-insensitive', () => {
    const service = new DictionaryService(dir);
    service.add('Deepgram');
    service.remove('deepgram');
    expect(service.list()).toHaveLength(0);
  });

  it('forSession caps at the session limit', () => {
    const service = new DictionaryService(dir);
    for (let i = 0; i < SESSION_TERM_LIMIT + 10; i++) service.add(`term${i}`);
    expect(service.forSession()).toHaveLength(SESSION_TERM_LIMIT);
    expect(service.forSession()[0]).toBe(`term${SESSION_TERM_LIMIT + 9}`); // newest first
  });

  it('tolerates a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'dictionary.json'), '{broken', 'utf8');
    const service = new DictionaryService(dir);
    expect(service.list()).toEqual([]);
  });
});
