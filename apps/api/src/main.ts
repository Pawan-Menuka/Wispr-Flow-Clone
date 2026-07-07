import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { attachDictationGateway } from './modules/dictation/gateway.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ['warn', 'error', 'log'],
  });
  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? 8787);
  await app.listen(port, '0.0.0.0');
  attachDictationGateway(app.getHttpServer());
  console.log(`[api] listening on :${port} — REST /health, WS /v1/stream (echo STT)`);
}

void bootstrap();
