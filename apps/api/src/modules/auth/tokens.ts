import { createHash, randomBytes, randomInt } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Plan } from '@flow/shared';

/**
 * Token primitives (BLUEPRINT §11.3). Access tokens are 15-minute JWTs;
 * refresh tokens are opaque random strings stored only as sha256 hashes,
 * grouped in rotation families for reuse detection.
 *
 * HS256 with a shared secret for now — RS256 + JWKS is the §11.3 target once
 * a second service needs to verify tokens; nothing else consumes them today.
 */

const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AccessClaims {
  sub: string; // userId
  deviceId: string;
  plan: Plan;
}

export class TokenService {
  private readonly secret: Uint8Array;

  constructor(secret: string) {
    if (!secret || secret.length < 16) {
      throw new Error('JWT_SECRET must be set (>=16 chars)');
    }
    this.secret = new TextEncoder().encode(secret);
  }

  async signAccessToken(claims: AccessClaims): Promise<string> {
    return new SignJWT({ deviceId: claims.deviceId, plan: claims.plan })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('flow-api')
      .setExpirationTime(`${ACCESS_TOKEN_TTL_S}s`)
      .sign(this.secret);
  }

  /** Returns claims or null (expired/invalid/garbage). */
  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: 'flow-api' });
      if (!payload.sub || typeof payload['deviceId'] !== 'string') return null;
      return {
        sub: payload.sub,
        deviceId: payload['deviceId'],
        plan: (payload['plan'] as Plan) ?? 'FREE',
      };
    } catch {
      return null;
    }
  }
}

/** Opaque refresh token; only its hash is persisted. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** 6-digit magic-link code (leading zeros allowed). */
export function generateMagicCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** One-time OAuth exchange code for the deep-link handoff. */
export function generateOauthCode(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
