import { describe, expect, it } from 'vitest';
import { entitlementsFor, quotaDecision } from './entitlements.js';

describe('entitlements', () => {
  it('FREE plan gets blueprint §20 limits', () => {
    const e = entitlementsFor('FREE');
    expect(e.wordsPerWeek).toBe(2000);
    expect(e.maxDevices).toBe(2);
    expect(e.maxDictionaryEntries).toBe(20);
    expect(e.features.perAppRules).toBe(false);
  });

  it('PRO is unlimited with all features', () => {
    const e = entitlementsFor('PRO');
    expect(e.wordsPerWeek).toBeNull();
    expect(Object.values(e.features).every(Boolean)).toBe(true);
  });

  it('quota grace band: ok < 80% ≤ warn < 100% ≤ grace < 110% ≤ block', () => {
    expect(quotaDecision(0, 2000)).toBe('ok');
    expect(quotaDecision(1599, 2000)).toBe('ok');
    expect(quotaDecision(1600, 2000)).toBe('warn');
    expect(quotaDecision(2000, 2000)).toBe('grace');
    expect(quotaDecision(2199, 2000)).toBe('grace');
    expect(quotaDecision(2200, 2000)).toBe('block');
    expect(quotaDecision(999999, null)).toBe('ok');
  });
});
