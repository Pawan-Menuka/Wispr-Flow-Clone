import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@flow/shared';
import { encodeAudioFrame, parseServerMessage } from '@flow/shared';
import { attachDictationGateway } from './gateway.js';
import { FormattingService } from '../ai/formatter.js';
import type { LlmProvider } from '../ai/llm.js';

let server: Server;
let url = '';
let llmCalls = 0;

beforeAll(async () => {
  // Counting LLM fake: proves the §12.6 provisional path reuses one call.
  const countingProvider: LlmProvider = {
    name: 'counting-fake',
    complete: async (req) => {
      llmCalls++;
      return req.user.toUpperCase();
    },
  };
  server = createServer();
  attachDictationGateway(server, {
    heartbeatMs: 60_000,
    formatter: new FormattingService(countingProvider),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/stream`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function connect(): Promise<{ ws: WebSocket; next: () => Promise<ServerMessage> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue: ServerMessage[] = [];
    const waiters: ((msg: ServerMessage) => void)[] = [];
    ws.on('message', (data) => {
      const msg = parseServerMessage(data.toString());
      if (!msg) return;
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else queue.push(msg);
    });
    ws.on('open', () =>
      resolve({
        ws,
        next: () =>
          new Promise<ServerMessage>((res, rej) => {
            const msg = queue.shift();
            if (msg) return res(msg);
            waiters.push(res);
            setTimeout(() => rej(new Error('timed out waiting for message')), 5000);
          }),
      }),
    );
    ws.on('error', reject);
  });
}

describe('dictation gateway (echo STT)', () => {
  it('runs a full session: start → audio → interims → finish → result', async () => {
    const { ws, next } = await connect();
    const sessionId = randomUUID();

    ws.send(
      JSON.stringify({
        t: 'session.start',
        sessionId,
        appContext: { processName: 'test.exe' },
      }),
    );
    const ready = await next();
    expect(ready.t).toBe('session.ready');

    // 50 frames = 1 s of audio → 2 echo interims (every 25 frames).
    const pcm = new Int16Array(320).fill(1000);
    for (let seq = 0; seq < 50; seq++) {
      ws.send(Buffer.from(encodeAudioFrame(seq, pcm)));
    }
    ws.send(JSON.stringify({ t: 'session.finish', sessionId, lastSeq: 49 }));

    const messages: ServerMessage[] = [];
    for (;;) {
      const msg = await next();
      messages.push(msg);
      if (msg.t === 'session.result') break;
    }

    const interims = messages.filter((m) => m.t === 'session.interim');
    expect(interims.length).toBeGreaterThanOrEqual(2);
    const result = messages.at(-1)!;
    if (result.t === 'session.result') {
      expect(result.finalText).toContain('50 FRAMES'); // LLM fake uppercases
      expect(result.formatted).toBe(true);
      expect(result.durationMs).toBe(1000);
    }
    // Echo's textSoFar === its final text → the provisional call was reused.
    expect(llmCalls).toBe(1);
    ws.close();
  });

  it('resume echoes ackSeq for a live session and errors for unknown ones', async () => {
    const { ws, next } = await connect();
    const sessionId = randomUUID();

    ws.send(
      JSON.stringify({ t: 'session.start', sessionId, appContext: { processName: 'x' } }),
    );
    await next(); // ready
    ws.send(Buffer.from(encodeAudioFrame(7, new Int16Array(320))));
    ws.send(JSON.stringify({ t: 'session.resume', sessionId, fromSeq: 0 }));
    const resumed = await next();
    expect(resumed.t).toBe('session.ready');
    if (resumed.t === 'session.ready') expect(resumed.ackSeq).toBe(7);

    const ghost = randomUUID();
    ws.send(JSON.stringify({ t: 'session.resume', sessionId: ghost, fromSeq: 0 }));
    const error = await next();
    expect(error.t).toBe('session.error');
    if (error.t === 'session.error') expect(error.code).toBe('SESSION_UNKNOWN');
    ws.close();
  });

  it('rejects malformed messages with a notice, not a crash', async () => {
    const { ws, next } = await connect();
    ws.send('not json at all');
    const notice = await next();
    expect(notice.t).toBe('system.notice');

    ws.send(JSON.stringify({ t: 'session.finish', sessionId: 'not-a-uuid', lastSeq: 0 }));
    const notice2 = await next();
    expect(notice2.t).toBe('system.notice');
    ws.close();
  });

  it('finish without a session yields SESSION_UNKNOWN', async () => {
    const { ws, next } = await connect();
    const sessionId = randomUUID();
    ws.send(JSON.stringify({ t: 'session.finish', sessionId, lastSeq: 0 }));
    const error = await next();
    expect(error.t).toBe('session.error');
    if (error.t === 'session.error') expect(error.code).toBe('SESSION_UNKNOWN');
    ws.close();
  });
});
