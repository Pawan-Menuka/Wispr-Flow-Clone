/** Plans and entitlements (BLUEPRINT §20). Server-computed; client uses for UX gating only. */

export type Plan = 'FREE' | 'PRO' | 'TEAM';

export interface Entitlements {
  plan: Plan;
  /** null = unlimited (fair-use enforced separately). */
  wordsPerWeek: number | null;
  maxDevices: number;
  /** null = unlimited. */
  maxDictionaryEntries: number | null;
  /** null = unlimited retention; 0 = no synced history. */
  historySyncDays: number | null;
  features: {
    allLanguages: boolean;
    perAppRules: boolean;
    snippets: boolean;
    customInstructions: boolean;
    commandMode: boolean;
  };
  /** ISO date when a trial ends, if trialing. */
  trialEndsAt?: string;
}

export function entitlementsFor(plan: Plan, trialEndsAt?: string): Entitlements {
  const pro = plan === 'PRO' || plan === 'TEAM';
  return {
    plan,
    wordsPerWeek: pro ? null : 2000,
    maxDevices: pro ? 5 : 2,
    maxDictionaryEntries: pro ? null : 20,
    historySyncDays: pro ? null : 7,
    features: {
      allLanguages: pro,
      perAppRules: pro,
      snippets: pro,
      customInstructions: pro,
      commandMode: pro,
    },
    ...(trialEndsAt ? { trialEndsAt } : {}),
  };
}

/** Grace policy: soft-allow up to 110% of the weekly limit (BLUEPRINT §3.1). */
export function quotaDecision(
  usedWords: number,
  limit: number | null,
): 'ok' | 'warn' | 'grace' | 'block' {
  if (limit === null) return 'ok';
  if (usedWords >= limit * 1.1) return 'block';
  if (usedWords >= limit) return 'grace';
  if (usedWords >= limit * 0.8) return 'warn';
  return 'ok';
}
