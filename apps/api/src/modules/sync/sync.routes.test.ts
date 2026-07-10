import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/auth.service.js';
import { TokenService } from '../auth/tokens.js';
import { registerSyncRoutes } from './sync.routes.js';

/** Integration (real Postgres) — skipped without DATABASE_URL, like auth. */
const dbUrl = process.env['DATABASE_URL'];

describe.skipIf(!dbUrl)('sync routes (integration)', () => {
  let fastify: FastifyInstance;
  let bearer = '';

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const auth = new AuthService(prisma, new TokenService('sync-test-secret-16-chars'));
    fastify = Fastify();
    registerSyncRoutes(fastify, prisma, auth);

    const email = `sync-${Date.now()}@flow.test`;
    const code = await auth.createMagicCode(email);
    const session = await auth.redeemMagicCode(email, code, {
      name: 'Sync Test',
      platform: 'win32',
      appVersion: '0.0.1',
    });
    bearer = `Bearer ${session.accessToken}`;
  });

  afterAll(async () => {
    await fastify?.close();
  });

  it('requires auth', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/v1/sync/settings' });
    expect(response.statusCode).toBe(401);
  });

  it('fresh user gets an empty v0 doc', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/sync/settings',
      headers: { authorization: bearer },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: 0, values: {}, stamps: {} });
  });

  it('PUT bumps version; stale baseVersion gets 409 with the current doc', async () => {
    const put = (baseVersion: number, language: string) =>
      fastify.inject({
        method: 'PUT',
        url: '/v1/sync/settings',
        headers: { authorization: bearer },
        payload: {
          values: { language },
          stamps: { language: new Date().toISOString() },
          baseVersion,
        },
      });

    const first = await put(0, 'en');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ version: 1 });

    const stale = await put(0, 'de');
    expect(stale.statusCode).toBe(409);
    const conflict = stale.json() as { doc: { version: number; values: { language: string } } };
    expect(conflict.doc.version).toBe(1);
    expect(conflict.doc.values.language).toBe('en');

    const rebased = await put(1, 'de');
    expect(rebased.statusCode).toBe(200);
    expect(rebased.json()).toEqual({ version: 2 });
  });

  it('rejects junk keys via schema', async () => {
    const response = await fastify.inject({
      method: 'PUT',
      url: '/v1/sync/settings',
      headers: { authorization: bearer },
      payload: { values: { hacked: true }, stamps: {}, baseVersion: 2 },
    });
    expect(response.statusCode).toBe(400);
  });
});
