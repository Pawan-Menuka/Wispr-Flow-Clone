import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { attachDictationGateway } from '../../../../api/src/modules/dictation/gateway';
import { DeepgramSttProvider } from '../../../../api/src/modules/ai/deepgram';
import { EchoSttProvider } from '../../../../api/src/modules/ai/stt';
import { FormattingService } from '../../../../api/src/modules/ai/formatter';

const DEFAULT_PORT = 8787;

export interface LocalDictationServer {
  close(): Promise<void>;
}

/** Copy only local speech-provider settings, never database/auth credentials. */
export function importLocalDictationConfig(userDataDir: string, sourcePath: string): void {
  const source = parseEnv(fs.readFileSync(sourcePath, 'utf8'));
  const apiKey = source['DEEPGRAM_API_KEY'];
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is missing from the selected environment file');
  const lines = [`DEEPGRAM_API_KEY=${apiKey}`];
  if (source['DEEPGRAM_MODEL']) lines.push(`DEEPGRAM_MODEL=${source['DEEPGRAM_MODEL']}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'local-api.env'), `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/**
 * Runs the anonymous dictation gateway inside the desktop process so an
 * installed development build does not need `pnpm dev` in another terminal.
 * Account, billing, and sync routes deliberately remain server-side features.
 */
export async function startLocalDictationServer(
  userDataDir: string,
  developmentEnvPath?: string,
): Promise<LocalDictationServer | null> {
  const env = loadLocalEnv(userDataDir, developmentEnvPath);
  const apiKey = process.env['DEEPGRAM_API_KEY'] ?? env['DEEPGRAM_API_KEY'];
  const model = process.env['DEEPGRAM_MODEL'] ?? env['DEEPGRAM_MODEL'] ?? 'nova-2';
  const provider = apiKey ? new DeepgramSttProvider(apiKey, model) : new EchoSttProvider();

  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', stt: provider.name }));
      return;
    }
    response.writeHead(404).end();
  });
  const gateway = attachDictationGateway(server, {
    provider,
    formatter: new FormattingService(null),
  });

  const listening = await new Promise<boolean>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(DEFAULT_PORT, '127.0.0.1', () => resolve(true));
  });

  if (!listening) {
    gateway.close();
    console.log('[local-api] port 8787 is already in use; using the existing API');
    return null;
  }

  console.log(`[local-api] listening on 127.0.0.1:${DEFAULT_PORT} (STT: ${provider.name})`);
  return {
    close: () =>
      new Promise<void>((resolve) => {
        gateway.close(() => server.close(() => resolve()));
      }),
  };
}

function loadLocalEnv(userDataDir: string, developmentEnvPath?: string): Record<string, string> {
  const candidates = [
    path.join(userDataDir, 'local-api.env'),
    ...(developmentEnvPath ? [developmentEnvPath] : []),
  ];
  for (const candidate of candidates) {
    try {
      return parseEnv(fs.readFileSync(candidate, 'utf8'));
    } catch {
      // Missing/unreadable config falls through to the next candidate.
    }
  }
  return {};
}

function parseEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2]!;
    values[match[1]!] =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
  }
  return values;
}
