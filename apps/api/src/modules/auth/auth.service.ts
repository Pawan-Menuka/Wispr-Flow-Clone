import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { entitlementsFor } from '@flow/shared';
import type { Plan } from '@flow/shared';
import {
  REFRESH_TOKEN_TTL_MS,
  TokenService,
  generateMagicCode,
  generateRefreshToken,
  sha256,
} from './tokens.js';

/**
 * Auth flows (BLUEPRINT §11): email magic codes, token issuance, refresh
 * rotation with family-reuse revocation, device management. Google OAuth
 * reuses issueTokens() once its callback resolves a user (auth.controller).
 */

const MAGIC_CODE_TTL_MS = 10 * 60 * 1000;

export interface DeviceDescriptor {
  name: string;
  platform: string;
  appVersion: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  device: { id: string; name: string; platform: string };
}

export class AuthError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_CODE'
      | 'TOKEN_INVALID'
      | 'TOKEN_REUSED'
      | 'DEVICE_LIMIT'
      | 'DEVICE_REVOKED',
    message: string,
  ) {
    super(message);
  }
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    readonly tokens: TokenService,
    /** Weekly used-words lookup (QuotaService); defaults to 0 in tests. */
    private readonly usedWords: (userId: string) => Promise<number> = async () => 0,
  ) {}

  // ---------- Magic link ----------

  /**
   * Issues a 6-digit code. Returns it so the caller can deliver it — email
   * in production, console in dev (never in the HTTP response).
   */
  async createMagicCode(email: string): Promise<string> {
    const code = generateMagicCode();
    await this.prisma.authCode.create({
      data: {
        kind: 'magic',
        codeHash: sha256(`${email.toLowerCase()}:${code}`),
        email: email.toLowerCase(),
        expiresAt: new Date(Date.now() + MAGIC_CODE_TTL_MS),
      },
    });
    return code;
  }

  async redeemMagicCode(
    email: string,
    code: string,
    device: DeviceDescriptor,
  ): Promise<IssuedSession> {
    const normalized = email.toLowerCase();
    const record = await this.prisma.authCode.findUnique({
      where: { codeHash: sha256(`${normalized}:${code}`) },
    });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw new AuthError('INVALID_CODE', 'Invalid or expired code');
    }
    await this.prisma.authCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const user = await this.upsertUser('email', normalized, normalized);
    return this.issueTokens(user.id, device);
  }

  // ---------- Core issuance ----------

  async upsertUser(provider: string, providerId: string, email: string) {
    const existing = await this.prisma.authProvider.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    });
    if (existing) return existing.user;

    // Same email via a different provider links to the same account.
    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      await this.prisma.authProvider.create({
        data: { userId: byEmail.id, provider, providerId },
      });
      return byEmail;
    }

    return this.prisma.user.create({
      data: { email, authProviders: { create: { provider, providerId } } },
    });
  }

  async issueTokens(userId: string, descriptor: DeviceDescriptor): Promise<IssuedSession> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const activeDevices = await this.prisma.device.count({
      where: { userId, revokedAt: null },
    });
    const maxDevices = entitlementsFor(user.plan as Plan).maxDevices;
    if (activeDevices >= maxDevices) {
      throw new AuthError('DEVICE_LIMIT', `Device limit reached (${maxDevices})`);
    }

    const device = await this.prisma.device.create({
      data: {
        userId,
        name: descriptor.name.slice(0, 100),
        platform: descriptor.platform,
        appVersion: descriptor.appVersion,
      },
    });

    const refreshToken = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: sha256(refreshToken),
        userId,
        deviceId: device.id,
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      deviceId: device.id,
      plan: user.plan as Plan,
    });
    await this.audit(userId, 'login', { deviceId: device.id });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      device: { id: device.id, name: device.name, platform: device.platform },
    };
  }

  // ---------- Refresh rotation (§11.3) ----------

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true, device: true },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new AuthError('TOKEN_INVALID', 'Refresh token invalid or expired');
    }
    if (record.rotatedAt) {
      // Reuse of a rotated token ⇒ the family is compromised. Revoke it all.
      await this.prisma.refreshToken.deleteMany({ where: { familyId: record.familyId } });
      await this.audit(record.userId, 'token.reuse-revocation', { familyId: record.familyId });
      throw new AuthError('TOKEN_REUSED', 'Token reuse detected — session revoked');
    }
    if (record.device.revokedAt) {
      throw new AuthError('DEVICE_REVOKED', 'This device has been revoked');
    }

    const next = generateRefreshToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { rotatedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          tokenHash: sha256(next),
          userId: record.userId,
          deviceId: record.deviceId,
          familyId: record.familyId,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      }),
      this.prisma.device.update({
        where: { id: record.deviceId },
        data: { lastSeenAt: new Date() },
      }),
    ]);

    const accessToken = await this.tokens.signAccessToken({
      sub: record.userId,
      deviceId: record.deviceId,
      plan: record.user.plan as Plan,
    });
    return { accessToken, refreshToken: next };
  }

  async logout(refreshToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (record) {
      await this.prisma.refreshToken.deleteMany({ where: { familyId: record.familyId } });
      await this.audit(record.userId, 'logout', { deviceId: record.deviceId });
    }
  }

  // ---------- Profile & devices ----------

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { devices: { where: { revokedAt: null }, orderBy: { lastSeenAt: 'desc' } } },
    });
    const entitlements = entitlementsFor(user.plan as Plan);
    return {
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      plan: user.plan,
      entitlements,
      quota: {
        usedWords: await this.usedWords(user.id),
        limitWords: entitlements.wordsPerWeek,
        resetsAt: nextMondayIso(),
      },
      devices: user.devices.map((device) => ({
        id: device.id,
        name: device.name,
        platform: device.platform,
        appVersion: device.appVersion,
        lastSeenAt: device.lastSeenAt.toISOString(),
      })),
    };
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: { id: deviceId, userId },
      data: { revokedAt: new Date() },
    });
    await this.prisma.refreshToken.deleteMany({ where: { deviceId, userId } });
    await this.audit(userId, 'device.revoke', { deviceId });
  }

  private async audit(userId: string, action: string, meta?: object): Promise<void> {
    await this.prisma.auditLog.create({ data: { userId, action, meta: meta ?? {} } });
  }
}

function nextMondayIso(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  return monday.toISOString();
}
