import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { SyncPutSchema, SyncedDocSchema } from '@flow/shared';
import type { AuthService } from '../auth/auth.service.js';

/**
 * Settings-doc sync (BLUEPRINT §19.4). The server is deliberately dumb:
 * it stores the doc opaquely on User.settingsJson, bumps `version` on every
 * accepted PUT, and 409s stale writers with the current copy — the CLIENT
 * owns the per-key merge (shared mergeSyncedDocs).
 */
export function registerSyncRoutes(
  fastify: FastifyInstance,
  prisma: PrismaClient,
  auth: AuthService,
): void {
  const requireClaims = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const claims = token ? await auth.tokens.verifyAccessToken(token) : null;
    if (!claims) {
      await reply
        .status(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } });
      return null;
    }
    return claims;
  };

  fastify.get('/v1/sync/settings', async (request, reply) => {
    const claims = await requireClaims(request, reply);
    if (!claims) return;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: claims.sub },
      select: { settingsJson: true },
    });
    return reply.send(readDoc(user.settingsJson));
  });

  fastify.put('/v1/sync/settings', async (request, reply) => {
    const claims = await requireClaims(request, reply);
    if (!claims) return;
    const body = SyncPutSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: body.error.issues[0]?.message ?? 'Invalid' },
      });
    }

    // Optimistic concurrency: the write only lands if version still matches.
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: claims.sub },
      select: { settingsJson: true },
    });
    const currentDoc = readDoc(current.settingsJson);
    if (body.data.baseVersion !== currentDoc.version) {
      return reply.status(409).send({
        error: { code: 'VERSION_CONFLICT', message: 'Document changed' },
        doc: currentDoc,
      });
    }

    const nextDoc = {
      version: currentDoc.version + 1,
      values: body.data.values,
      stamps: body.data.stamps,
    };
    await prisma.user.update({
      where: { id: claims.sub },
      data: { settingsJson: nextDoc as Prisma.InputJsonValue },
    });
    return reply.send({ version: nextDoc.version });
  });
}

function readDoc(raw: unknown): { version: number; values: object; stamps: Record<string, string> } {
  const parsed = SyncedDocSchema.safeParse(raw);
  return parsed.success ? parsed.data : { version: 0, values: {}, stamps: {} };
}
