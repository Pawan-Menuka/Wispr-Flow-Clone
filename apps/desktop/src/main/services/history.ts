import fs from 'node:fs';
import path from 'node:path';
import type { HistoryEntry, HistoryPage, HistoryStats } from '@flow/shared';

/**
 * Local dictation history (BLUEPRINT §5.3, F14). Text only — audio never
 * persists. JSONL append log + in-memory index behind a store interface;
 * the better-sqlite3/FTS5 upgrade slots in here when scale demands it
 * (thousands of entries are fine in memory — a dictation is ~a tweet).
 */

export interface HistoryQuery {
  search?: string;
  /** ISO cursor: return entries strictly older than this. */
  before?: string;
  limit: number;
}

export class HistoryService {
  private entries: HistoryEntry[] = []; // newest first
  private readonly filePath: string;

  constructor(
    dir: string,
    private readonly getRetention: () => 'forever' | '30d' | 'off',
  ) {
    this.filePath = path.join(dir, 'history.jsonl');
    this.load();
    this.prune();
  }

  add(entry: HistoryEntry): void {
    if (this.getRetention() === 'off') return;
    this.entries.unshift(entry);
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
  }

  query(query: HistoryQuery): HistoryPage {
    const needle = query.search?.trim().toLowerCase();
    let matched = needle
      ? this.entries.filter((e) => e.finalText.toLowerCase().includes(needle))
      : this.entries;
    if (query.before) {
      matched = matched.filter((e) => e.createdAt < query.before!);
    }
    const page = matched.slice(0, Math.min(query.limit, 200));
    const nextBefore =
      matched.length > page.length && page.length > 0 ? page[page.length - 1]!.createdAt : null;
    return { entries: page, nextBefore };
  }

  get(id: string): HistoryEntry | null {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  delete(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.rewrite();
  }

  clear(): void {
    this.entries = [];
    this.rewrite();
  }

  stats(): HistoryStats {
    const weekStart = startOfWeekUtc();
    const thisWeek = this.entries.filter((e) => e.createdAt >= weekStart);
    const words = thisWeek.reduce((sum, e) => sum + e.wordCount, 0);
    const minutes = thisWeek.reduce((sum, e) => sum + e.durationMs, 0) / 60_000;
    return {
      wordsThisWeek: words,
      dictationsThisWeek: thisWeek.length,
      avgWpm: minutes > 0 ? Math.round(words / minutes) : 0,
    };
  }

  /** Retention enforcement (§19). Runs at boot; 'off' clears any leftovers. */
  prune(): void {
    const retention = this.getRetention();
    if (retention === 'forever') return;
    if (retention === 'off') {
      if (this.entries.length > 0) this.clear();
      return;
    }
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const kept = this.entries.filter((e) => e.createdAt >= cutoff);
    if (kept.length !== this.entries.length) {
      this.entries = kept;
      this.rewrite();
    }
  }

  private load(): void {
    try {
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n');
      const parsed: HistoryEntry[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          parsed.push(JSON.parse(line) as HistoryEntry);
        } catch {
          // torn write (crash mid-append) — skip the bad line
        }
      }
      parsed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      this.entries = parsed;
    } catch {
      this.entries = [];
    }
  }

  private rewrite(): void {
    const tmpPath = `${this.filePath}.tmp`;
    const lines = [...this.entries]
      .reverse() // file stays oldest-first for cheap appends
      .map((e) => JSON.stringify(e))
      .join('\n');
    fs.writeFileSync(tmpPath, lines ? lines + '\n' : '', 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}

function startOfWeekUtc(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  );
  return monday.toISOString();
}
