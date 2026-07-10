import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeAudioFrame, parseClientMessage } from '@flow/shared';
import { WsClient } from './ws-client';

/**
 * Reconnect-with-replay integration test (§3.1): a mock protocol server that
 * murders the socket mid-session; the client must reconnect, re-start the
 * session, replay every frame, and still deliver a result. Zero word loss.
 */

interface MockState {
  connections: number;
  framesPerConnection: number[];
  killAfterFrames: number | null;
}

let httpServer: Server;
let wss: WebSocketServer;
let state: MockState;
let url = '';

beforeEach(async () => {
  state = { connections: 0, framesPerConnection: [], killAfterFrames: null };
  httpServer = createServer();
  wss = new WebSocketServer({ server: httpServer, path: '/v1/stream' });

  wss.on('connection', (socket) => {
    const connIndex = state.connections++;
    state.framesPerConnection[connIndex] = 0;
    let sessionId = '';

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const frame = decodeAudioFrame(data as Buffer);
        if (!frame) return;
        state.framesPerConnection[connIndex]!++;
        if (
          state.killAfterFrames !== null &&
          connIndex === 0 &&
          state.framesPerConnection[connIndex]! >= state.killAfterFrames
        ) {
          socket.terminate(); // simulate a network drop
        }
        return;
      }
      const msg = parseClientMessage((data as Buffer).toString('utf8'));
      if (!msg) return;
      if (msg.t === 'session.start') {
        sessionId = msg.sessionId;
        socket.send(JSON.stringify({ t: 'session.ready', sessionId }));
      }
      if (msg.t === 'session.finish') {
        socket.send(
          JSON.stringify({
            t: 'session.result',
            sessionId,
            finalText: `frames:${state.framesPerConnection[connIndex]}`,
            rawText: '',
            formatted: false,
            wordCount: 1,
            durationMs: 0,
            latencyMs: 1,
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/v1/stream`;
});

afterEach(async () => {
  wss.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function connectClient(): Promise<WsClient> {
  const client = new WsClient(url);
  client.connect();
  return waitFor(() => client.isConnected, 3_000).then(() => client);
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

const pcm = new Int16Array(320).fill(7);

describe('WsClient reconnect-with-replay', () => {
  it('happy path: frames flow, result arrives', async () => {
    const client = await connectClient();
    const handle = client.startSession({
      sessionId: randomUUID(),
      appContext: { processName: 'test', profile: 'default' },
    })!;

    let result = '';
    handle.onResult((r) => (result = r.finalText));
    for (let seq = 0; seq < 10; seq++) handle.sendAudio(seq, pcm);
    handle.finish(9);

    await waitFor(() => result !== '', 3_000);
    expect(result).toBe('frames:10');
    client.shutdown();
  });

  it('socket death mid-session: reconnects, replays ALL frames, result arrives', async () => {
    state.killAfterFrames = 5;
    const client = await connectClient();
    const handle = client.startSession({
      sessionId: randomUUID(),
      appContext: { processName: 'test', profile: 'default' },
    })!;

    let result = '';
    let error = '';
    handle.onResult((r) => (result = r.finalText));
    handle.onError((code) => (error = code));

    // 5 frames arrive, server kills the socket on the 5th.
    for (let seq = 0; seq < 5; seq++) handle.sendAudio(seq, pcm);
    await waitFor(() => state.connections === 1 && !client.isConnected, 3_000);

    // Speech continues while disconnected — frames buffer client-side.
    for (let seq = 5; seq < 12; seq++) handle.sendAudio(seq, pcm);
    handle.finish(11);

    await waitFor(() => result !== '' || error !== '', 6_000);
    expect(error).toBe('');
    // Second connection must have received the FULL buffer, not just the tail.
    expect(result).toBe('frames:12');
    expect(state.connections).toBe(2);
    client.shutdown();
  });

  it('no server at all: session fails with NETWORK after the resume deadline', async () => {
    const client = await connectClient();
    const handle = client.startSession({
      sessionId: randomUUID(),
      appContext: { processName: 'test', profile: 'default' },
    })!;
    let error = '';
    handle.onError((code) => (error = code));

    // Tear the server down entirely — nothing to reconnect to.
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    await waitFor(() => error !== '', 12_000);
    expect(error).toBe('NETWORK');
    client.shutdown();
  }, 15_000);
});
