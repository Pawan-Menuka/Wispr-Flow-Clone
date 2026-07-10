import { describe, expect, it } from 'vitest';
import { mergeSyncedDocs } from './sync.js';

const T1 = '2026-07-10T10:00:00.000Z';
const T2 = '2026-07-10T11:00:00.000Z';

describe('mergeSyncedDocs', () => {
  it('newer stamp wins per key, independently', () => {
    const result = mergeSyncedDocs(
      { values: { language: 'en', tone: 'formal' }, stamps: { language: T2, tone: T1 } },
      { values: { language: 'de', tone: 'casual' }, stamps: { language: T1, tone: T2 } },
    );
    expect(result.values.language).toBe('en'); // local newer
    expect(result.values.tone).toBe('casual'); // remote newer
    expect(result.applyLocally).toEqual({ tone: 'casual' });
  });

  it('remote-only keys are adopted; local-only keys are kept', () => {
    const result = mergeSyncedDocs(
      { values: { fillerRemoval: false }, stamps: { fillerRemoval: T1 } },
      { values: { language: 'fr' }, stamps: { language: T1 } },
    );
    expect(result.values).toEqual({ fillerRemoval: false, language: 'fr' });
    expect(result.applyLocally).toEqual({ language: 'fr' });
  });

  it('equal values from remote produce no local apply even when remote is newer', () => {
    const result = mergeSyncedDocs(
      { values: { language: 'en' }, stamps: { language: T1 } },
      { values: { language: 'en' }, stamps: { language: T2 } },
    );
    expect(result.applyLocally).toEqual({});
    expect(result.stamps['language']).toBe(T2); // still adopts the newer stamp
  });

  it('missing stamps lose to stamped values', () => {
    const result = mergeSyncedDocs(
      { values: { language: 'en' }, stamps: {} },
      { values: { language: 'de' }, stamps: { language: T1 } },
    );
    expect(result.values.language).toBe('de');
  });

  it('unknown keys in either doc are dropped (schema hygiene)', () => {
    const result = mergeSyncedDocs(
      { values: { hacked: true } as never, stamps: { hacked: T2 } },
      { values: {}, stamps: {} },
    );
    expect(result.values).toEqual({});
  });

  it('object values (appRules) merge as whole values by stamp', () => {
    const result = mergeSyncedDocs(
      { values: { appRules: { 'a.exe': 'code' } }, stamps: { appRules: T1 } },
      { values: { appRules: { 'b.exe': 'off' } }, stamps: { appRules: T2 } },
    );
    expect(result.values.appRules).toEqual({ 'b.exe': 'off' });
    expect(result.applyLocally).toEqual({ appRules: { 'b.exe': 'off' } });
  });
});
