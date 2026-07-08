import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { HEARTBEAT_INTERVAL_MS, WS_CLOSE_CODES } from '@flow/shared';
import { EchoSttProvider } from '../ai/stt.js';
import type { SttProvider } from '../ai/stt.js';
import { FormattingService } from '../ai/formatter.js';
import { ClientConnection } from './connection.js';

export interface GatewayOptions {
  provider?: SttProvider;
  formatter?: FormattingService;
  heartbeatMs?: number;
}

/**
 * Dictation WS endpoint at /v1/stream (BLUEPRINT §18). Plain `ws` on the
 * HTTP server — Nest's gateway abstraction is bypassed deliberately: our
 * protocol is binary-frame heavy and zod-validated, not event-name routed.
 *
 * Auth on upgrade is stubbed until Phase 10 (REQUIRE_AUTH=false in dev).
 */
export function attachDictationGateway(
  server: HttpServer,
  opts: GatewayOptions = {},
): WebSocketServer {
  const provider = opts.provider ?? new EchoSttProvider();
  const formatter = opts.formatter ?? new FormattingService(null);
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
  const wss = new WebSocketServer({ server, path: '/v1/stream' });

  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (socket) => {
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    new ClientConnection(socket, provider, formatter);
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (alive.get(socket) === false) {
        socket.close(WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, 'heartbeat timeout');
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, heartbeatMs);

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
