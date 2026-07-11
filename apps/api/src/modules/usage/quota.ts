import type { PrismaClient } from '@prisma/client';
import type { Plan } from '@flow/shared';
import { entitlementsFor, quotaDecision } from '@flow/shared';

/**
 * Weekly word quotas (§20, F30). Truth lives in UsageEvent; a per-process
 * cache keeps the hot path off the DB (Redis takes this seat at scale).
 * Decisions use the shared grace bands: warn 80% → grace 100% → block 110%.
 */

export interface UsageStore {
  /** Sum of words since the given ISO instant. */
  wordsSince(userId: string, sinceIso: string): Promise<number>;
  record(event: {
    userId: string;
    deviceId?: string;
    kind: 'dictation' | 'rewrite' | 'command';
    wordCount: number;
    durationMs: number;
    latencyMs?: number;
  }): Promise<void>;
}

export class MemoryUsageStore implements UsageStore {
  private events: { userId: string; wordCount: number; at: string }[] = [];

  async wordsSince(userId: string, sinceIso: string): Promise<number> {
    return this.events
      .filter((e) => e.userId === userId && e.at >= sinceIso)
      .reduce((sum, e) => sum + e.wordCount, 0);
  }

  async record(event: { userId: string; wordCount: number }): Promise<void> {
    this.events.push({ userId: event.userId, wordCount: event.wordCount, at: new Date().toISOString() });
  }
}

export class PrismaUsageStore implements UsageStore {
  constructor(private readonly prisma: PrismaClient) {}

  async wordsSince(userId: string, sinceIso: string): Promise<number> {
    const result = await this.prisma.usageEvent.aggregate({
      where: { userId, createdAt: { gte: new Date(sinceIso) } },
      _sum: { wordCount: true },
    });
    return result._sum.wordCount ?? 0;
  }

  async record(event: {
    userId: string;
    deviceId?: string;
    kind: 'dictation' | 'rewrite' | 'command';
    wordCount: number;
    durationMs: number;
    latencyMs?: number;
  }): Promise<void> {
    await this.prisma.usageEvent.create({
      data: {
        userId: event.userId,
        deviceId: event.deviceId ?? null,
        kind: event.kind,
        wordCount: event.wordCount,
        durationMs: event.durationMs,
        latencyMs: event.latencyMs ?? null,
      },
    });
  }
}

export class QuotaService {
  /** userId → {words, weekStart} hot cache. */
  private cache = new Map<string, { words: number; weekStart: string }>();

  constructor(private readonly store: UsageStore) {}

  async decision(userId: string, plan: Plan): Promise<'ok' | 'warn' | 'grace' | 'block'> {
    const limit = entitlementsFor(plan).wordsPerWeek;
    if (limit === null) return 'ok';
    const words = await this.usedWords(userId);
    return quotaDecision(words, limit);
  }

  async usedWords(userId: string): Promise<number> {
    const weekStart = startOfWeekUtc();
    const cached = this.cache.get(userId);
    if (cached && cached.weekStart === weekStart) return cached.words;
    const words = await this.store.wordsSince(userId, weekStart);
    this.cache.set(userId, { words, weekStart });
    return words;
  }

  async record(event: {
    userId: string;
    deviceId?: string;
    kind: 'dictation' | 'rewrite' | 'command';
    wordCount: number;
    durationMs: number;
    latencyMs?: number;
  }): Promise<void> {
    await this.store.record(event);
    const weekStart = startOfWeekUtc();
    const cached = this.cache.get(event.userId);
    if (cached && cached.weekStart === weekStart) {
      cached.words += event.wordCount;
    }
  }
}

export function startOfWeekUtc(): string {
  const now = new Date();
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  ).toISOString();
}
