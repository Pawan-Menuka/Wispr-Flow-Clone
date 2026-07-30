import { config } from 'dotenv';

/**
 * Loads `apps/api/.env` into process.env. MUST be the first import in
 * main.ts: ES modules evaluate imports in declaration order, so anything
 * imported before this would read an unpopulated process.env.
 *
 * Without this, every env-gated feature (Deepgram, Anthropic, Stripe, Sentry,
 * DATABASE_URL) silently fell back to its stub even with a .env present.
 */
config({ quiet: true });
