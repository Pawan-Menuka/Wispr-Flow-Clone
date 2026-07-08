import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError } from './auth.service.js';
import type { AuthService } from './auth.service.js';

/**
 * REST auth surface (BLUEPRINT §17). Registered directly on the Fastify
 * instance — same philosophy as the WS gateway: thin transport over a
 * service that owns the logic.
 *
 * Google/Apple OAuth endpoints land when client credentials exist to test
 * them against (§11.2); the token-issuance path they need is already here.
 */

const DeviceSchema = z.object({
  name: z.string().min(1).max(100),
  platform: z.string().max(20),
  appVersion: z.string().max(30),
});

const MagicSchema = z.object({ email: z.string().email() });
const TokenSchema = z.object({
  grant: z.literal('magic'),
  email: z.string().email(),
  code: z.string().length(6),
  device: DeviceSchema,
});
const RefreshSchema = z.object({ refreshToken: z.string().min(20) });

const AUTH_ERROR_STATUS: Record<AuthError['code'], number> = {
  INVALID_CODE: 401,
  TOKEN_INVALID: 401,
  TOKEN_REUSED: 401,
  DEVICE_REVOKED: 401,
  DEVICE_LIMIT: 403,
};

export function registerAuthRoutes(fastify: FastifyInstance, auth: AuthService): void {
  const guard = requireAuth(auth);

  fastify.post('/v1/auth/magic', async (request, reply) => {
    const body = MagicSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    const code = await auth.createMagicCode(body.data.email);
    // Email delivery arrives with an ESP key; until then the code goes to the
    // server console ONLY (enumeration-safe: response is identical either way).
    console.log(`[auth] magic code for ${body.data.email}: ${code}`);
    return reply.status(204).send();
  });

  fastify.post('/v1/auth/token', async (request, reply) => {
    const body = TokenSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    try {
      const session = await auth.redeemMagicCode(body.data.email, body.data.code, body.data.device);
      return reply.send(session);
    } catch (err) {
      return authFailure(reply, err);
    }
  });

  fastify.post('/v1/auth/refresh', async (request, reply) => {
    const body = RefreshSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    try {
      return reply.send(await auth.refresh(body.data.refreshToken));
    } catch (err) {
      return authFailure(reply, err);
    }
  });

  fastify.post('/v1/auth/logout', async (request, reply) => {
    const body = RefreshSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    await auth.logout(body.data.refreshToken);
    return reply.status(204).send();
  });

  fastify.get('/v1/users/me', async (request, reply) => {
    const claims = await guard(request, reply);
    if (!claims) return;
    return reply.send(await auth.getMe(claims.sub));
  });

  fastify.delete('/v1/devices/:id', async (request, reply) => {
    const claims = await guard(request, reply);
    if (!claims) return;
    const { id } = request.params as { id: string };
    await auth.revokeDevice(claims.sub, id);
    return reply.status(204).send();
  });
}

function requireAuth(auth: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const claims = token ? await auth.tokens.verifyAccessToken(token) : null;
    if (!claims) {
      await reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } });
      return null;
    }
    return claims;
  };
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({
    error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message ?? 'Invalid request' },
  });
}

function authFailure(reply: FastifyReply, err: unknown) {
  if (err instanceof AuthError) {
    return reply
      .status(AUTH_ERROR_STATUS[err.code])
      .send({ error: { code: err.code, message: err.message } });
  }
  throw err;
}
