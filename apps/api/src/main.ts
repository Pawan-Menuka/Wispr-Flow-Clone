import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { attachDictationGateway } from './modules/dictation/gateway.js';
import { DeepgramSttProvider } from './modules/ai/deepgram.js';
import { EchoSttProvider } from './modules/ai/stt.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ['warn', 'error', 'log'],
  });
  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? 8787);
  await app.listen(port, '0.0.0.0');

  const deepgramKey = process.env['DEEPGRAM_API_KEY'];
  const provider = deepgramKey ? new DeepgramSttProvider(deepgramKey) : new EchoSttProvider();
  attachDictationGateway(app.getHttpServer(), { provider });
  console.log(`[api] listening on :${port} — REST /health, WS /v1/stream (STT: ${provider.name})`);
}

void bootstrap();
