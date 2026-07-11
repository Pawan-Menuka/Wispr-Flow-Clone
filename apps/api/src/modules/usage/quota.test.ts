import { describe, expect, it } from 'vitest';
import { MemoryUsageStore, QuotaService } from './quota.js';

describe('QuotaService', () => {
  it('PRO is always ok', async () => {
    const service = new QuotaService(new MemoryUsageStore());
    await service.record({ userId: 'u', kind: 'dictation', wordCount: 999_999, durationMs: 0 });
    expect(await service.decision('u', 'PRO')).toBe('ok');
  });

  it('FREE walks the grace bands: ok → warn → grace → block', async () => {
    const store = new MemoryUsageStore();
    const service = new QuotaService(store);
    const user = 'free-user';

    expect(await service.decision(user, 'FREE')).toBe('ok');

    await service.record({ userId: user, kind: 'dictation', wordCount: 1_600, durationMs: 0 });
    expect(await service.decision(user, 'FREE')).toBe('warn'); // 80% of 2000

    await service.record({ userId: user, kind: 'dictation', wordCount: 400, durationMs: 0 });
    expect(await service.decision(user, 'FREE')).toBe('grace'); // 100%

    await service.record({ userId: user, kind: 'dictation', wordCount: 200, durationMs: 0 });
    expect(await service.decision(user, 'FREE')).toBe('block'); // 110%
  });

  it('cache increments with records and isolates users', async () => {
    const service = new QuotaService(new MemoryUsageStore());
    await service.record({ userId: 'a', kind: 'dictation', wordCount: 100, durationMs: 0 });
    await service.record({ userId: 'b', kind: 'dictation', wordCount: 5, durationMs: 0 });
    expect(await service.usedWords('a')).toBe(100);
    expect(await service.usedWords('b')).toBe(5);
  });
});
