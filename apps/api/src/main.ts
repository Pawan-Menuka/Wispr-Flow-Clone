import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { attachDictationGateway } from './modules/dictation/gateway.js';
import { DeepgramSttProvider } from './modules/ai/deepgram.js';
import { EchoSttProvider } from './modules/ai/stt.js';
import { AnthropicLlmProvider } from './modules/ai/llm.js';
import { FormattingService } from './modules/ai/formatter.js';
import { AuthService } from './modules/auth/auth.service.js';
import { TokenService } from './modules/auth/tokens.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerSyncRoutes } from './modules/sync/sync.routes.js';
import { getPrisma } from './modules/db.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ['warn', 'error', 'log'],
  });
  app.enableShutdownHooks();

  // ---------- Auth (§11) ----------
  const jwtSecret = process.env['JWT_SECRET'] ?? '';
  const tokens = new TokenService(
    jwtSecret || 'dev-only-secret-change-me-in-prod',
  );
  if (!jwtSecret) console.warn('[api] JWT_SECRET not set — using the DEV secret');
  const auth = new AuthService(getPrisma(), tokens);
  registerAuthRoutes(app.getHttpAdapter().getInstance(), auth);
  registerSyncRoutes(app.getHttpAdapter().getInstance(), getPrisma(), auth);

  const port = Number(process.env['PORT'] ?? 8787);
  try {
    await app.listen(port, '0.0.0.0');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `[api] port ${port} is already in use — is another Flow API running? (set PORT to override)`,
      );
      process.exit(1);
    }
    throw err;
  }

  const deepgramKey = process.env['DEEPGRAM_API_KEY'];
  const provider = deepgramKey ? new DeepgramSttProvider(deepgramKey) : new EchoSttProvider();

  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const formatter = new FormattingService(
    anthropicKey ? new AnthropicLlmProvider(anthropicKey) : null,
  );

  const requireAuth = process.env['REQUIRE_AUTH'] === 'true';
  attachDictationGateway(app.getHttpServer(), {
    provider,
    formatter,
    ...(requireAuth ? { verifyToken: (token: string) => tokens.verifyAccessToken(token) } : {}),
  });
  console.log(
    `[api] listening on :${port} — REST /health + /v1/auth, WS /v1/stream (STT: ${provider.name}, LLM: ${formatter.providerName}, auth: ${requireAuth ? 'required' : 'open'})`,
  );
}

void bootstrap();
