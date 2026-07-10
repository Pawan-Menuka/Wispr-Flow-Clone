import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@flow/shared';
import { HistoryService } from './history';

let dir: string;
let retention: 'forever' | '30d' | 'off' = 'forever';

function entry(id: string, text: string, daysAgo = 0, words = 5): HistoryEntry {
  return {
    id,
    finalText: text,
    appName: null,
    language: 'en',
    wordCount: words,
    durationMs: words * 400, // 150 wpm
    createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-history-'));
  retention = 'forever';
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const make = () => new HistoryService(dir, () => retention);

describe('HistoryService', () => {
  it('persists across restarts, newest first', () => {
    const service = make();
    service.add(entry('a', 'first thing', 2));
    service.add(entry('b', 'second thing', 1));

    const reloaded = make();
    const page = reloaded.query({ limit: 10 });
    expect(page.entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('search is case-insensitive substring', () => {
    const service = make();
    service.add(entry('a', 'Send the Quarterly report'));
    service.add(entry('b', 'lunch order for tuesday'));
    expect(service.query({ search: 'quarterly', limit: 10 }).entries).toHaveLength(1);
    expect(service.query({ search: 'pizza', limit: 10 }).entries).toHaveLength(0);
  });

  it('paginates with a before cursor', () => {
    const service = make();
    for (let i = 0; i < 5; i++) service.add(entry(`e${i}`, `item ${i}`, 5 - i));
    const first = service.query({ limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextBefore).not.toBeNull();
    const second = service.query({ limit: 10, before: first.nextBefore! });
    expect(second.entries).toHaveLength(3);
    expect(second.nextBefore).toBeNull();
  });

  it('delete and clear rewrite the log', () => {
    const service = make();
    service.add(entry('a', 'keep me'));
    service.add(entry('b', 'delete me'));
    service.delete('b');
    expect(make().query({ limit: 10 }).entries.map((e) => e.id)).toEqual(['a']);
    service.clear();
    expect(make().query({ limit: 10 }).entries).toHaveLength(0);
  });

  it('retention off: add() is a no-op and prune clears leftovers', () => {
    const service = make();
    service.add(entry('a', 'stored while on'));
    retention = 'off';
    service.add(entry('b', 'never stored'));
    expect(service.get('b')).toBeNull();
    service.prune();
    expect(service.query({ limit: 10 }).entries).toHaveLength(0);
  });

  it('30d retention prunes old entries at boot', () => {
    const service = make();
    service.add(entry('old', 'ancient words', 45));
    service.add(entry('new', 'fresh words', 1));
    retention = '30d';
    const reloaded = make(); // constructor prunes
    expect(reloaded.query({ limit: 10 }).entries.map((e) => e.id)).toEqual(['new']);
  });

  it('stats cover the current week', () => {
    const service = make();
    service.add(entry('a', 'five words right here now', 0, 5));
    service.add(entry('b', 'and five more words here', 0, 5));
    service.add(entry('ancient', 'not this week', 20, 100));
    const stats = service.stats();
    expect(stats.dictationsThisWeek).toBe(2);
    expect(stats.wordsThisWeek).toBe(10);
    expect(stats.avgWpm).toBe(150);
  });

  it('survives a torn trailing write', () => {
    const service = make();
    service.add(entry('a', 'good line'));
    fs.appendFileSync(path.join(dir, 'history.jsonl'), '{"id":"broken', 'utf8');
    const reloaded = make();
    expect(reloaded.query({ limit: 10 }).entries.map((e) => e.id)).toEqual(['a']);
  });
});
