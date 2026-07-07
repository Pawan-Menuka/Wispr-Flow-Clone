import { describe, expect, it } from 'vitest';
import { TokenService, generateMagicCode, generateRefreshToken, sha256 } from './tokens.js';

describe('TokenService', () => {
  const service = new TokenService('test-secret-at-least-16-chars');

  it('round-trips access token claims', async () => {
    const token = await service.signAccessToken({ sub: 'user-1', deviceId: 'dev-1', plan: 'PRO' });
    const claims = await service.verifyAccessToken(token);
    expect(claims).toEqual({ sub: 'user-1', deviceId: 'dev-1', plan: 'PRO' });
  });

  it('rejects tampered and garbage tokens', async () => {
    const token = await service.signAccessToken({ sub: 'u', deviceId: 'd', plan: 'FREE' });
    expect(await service.verifyAccessToken(token.slice(0, -2) + 'xx')).toBeNull();
    expect(await service.verifyAccessToken('not-a-jwt')).toBeNull();
  });

  it('rejects tokens signed with a different secret', async () => {
    const other = new TokenService('another-secret-16-chars-long');
    const token = await other.signAccessToken({ sub: 'u', deviceId: 'd', plan: 'FREE' });
    expect(await service.verifyAccessToken(token)).toBeNull();
  });

  it('refuses weak secrets', () => {
    expect(() => new TokenService('short')).toThrow();
  });
});

describe('token generators', () => {
  it('magic codes are 6 digits with leading zeros allowed', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateMagicCode()).toMatch(/^\d{6}$/);
    }
  });

  it('refresh tokens are long, unique, url-safe', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(60);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('sha256 is stable', () => {
    expect(sha256('flow')).toBe(sha256('flow'));
    expect(sha256('flow')).toHaveLength(64);
  });
});
