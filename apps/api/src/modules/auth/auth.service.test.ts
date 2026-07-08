import { describe, expect, it, beforeAll } from 'vitest';
import { AuthService, AuthError } from './auth.service.js';
import { TokenService } from './tokens.js';

/**
 * Integration tests against a real Postgres (compose: `docker compose -f
 * infra/docker-compose.dev.yml up -d` + `pnpm db:migrate`). Skipped when
 * DATABASE_URL is unset so the default suite stays DB-free.
 */
const dbUrl = process.env['DATABASE_URL'];

describe.skipIf(!dbUrl)('AuthService (integration, real Postgres)', () => {
  let auth: AuthService;
  const device = { name: 'Test Machine', platform: 'win32', appVersion: '0.0.1' };
  const email = `test-${Date.now()}@flow.test`;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    auth = new AuthService(prisma, new TokenService('integration-test-secret-16+'));
  });

  it('magic code round trip: create → redeem → tokens → /me', async () => {
    const code = await auth.createMagicCode(email);
    expect(code).toMatch(/^\d{6}$/);

    const session = await auth.redeemMagicCode(email, code, device);
    expect(session.user.email).toBe(email);
    expect(session.accessToken.split('.')).toHaveLength(3);

    const claims = await auth.tokens.verifyAccessToken(session.accessToken);
    expect(claims?.sub).toBe(session.user.id);

    const me = await auth.getMe(session.user.id);
    expect(me.plan).toBe('FREE');
    expect(me.devices.some((d) => d.id === session.device.id)).toBe(true);
  });

  it('codes are single-use and wrong codes rejected', async () => {
    const code = await auth.createMagicCode(email);
    await auth.redeemMagicCode(email, code, device);
    await expect(auth.redeemMagicCode(email, code, device)).rejects.toThrow(AuthError);
    await expect(auth.redeemMagicCode(email, '000000', device)).rejects.toThrow(AuthError);
  });

  it('refresh rotates; reusing a rotated token revokes the family', async () => {
    const freshEmail = `rotate-${Date.now()}@flow.test`;
    const code = await auth.createMagicCode(freshEmail);
    const session = await auth.redeemMagicCode(freshEmail, code, device);

    const rotated = await auth.refresh(session.refreshToken);
    expect(rotated.refreshToken).not.toBe(session.refreshToken);

    // Replay of the OLD token = theft signal → whole family dies.
    await expect(auth.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_REUSED',
    });
    // The rotated descendant is dead too.
    await expect(auth.refresh(rotated.refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('device limit enforced per plan (FREE = 2)', async () => {
    const limitEmail = `limit-${Date.now()}@flow.test`;
    for (let i = 0; i < 2; i++) {
      const code = await auth.createMagicCode(limitEmail);
      await auth.redeemMagicCode(limitEmail, code, device);
    }
    const code = await auth.createMagicCode(limitEmail);
    await expect(auth.redeemMagicCode(limitEmail, code, device)).rejects.toMatchObject({
      code: 'DEVICE_LIMIT',
    });
  });

  it('device revocation kills its refresh tokens', async () => {
    const revEmail = `revoke-${Date.now()}@flow.test`;
    const code = await auth.createMagicCode(revEmail);
    const session = await auth.redeemMagicCode(revEmail, code, device);

    await auth.revokeDevice(session.user.id, session.device.id);
    await expect(auth.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
    const me = await auth.getMe(session.user.id);
    expect(me.devices).toHaveLength(0);
  });
});
