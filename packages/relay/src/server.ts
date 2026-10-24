// The relay's daemon-facing API (D-014). Every route needs the daemon token, and the token only lets
// a daemon submit and close its requests and read signed verdicts; it can never create a verdict.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { RelayRequest } from '@bridgegap/protocol';
import { handleErrors, HttpError, readJson, requireToken, send } from '@bridgegap/protocol/http';
import type { Broker } from './broker.ts';

const MAX_WAIT_MS = 25_000;
const CLOSE_STATUSES = new Set(['resolved', 'expired', 'abandoned']);

function parseRequest(body: Record<string, unknown>): RelayRequest {
  const strings = ['requestId', 'replyCode', 'sessionId', 'cwd', 'toolName', 'preview'] as const;
  for (const key of strings) if (typeof body[key] !== 'string') throw new HttpError(400, `expected string ${key}`);
  if (body.agent !== 'claude-code') throw new HttpError(400, 'unsupported agent');
  if (typeof body.createdAt !== 'number' || typeof body.expiresAt !== 'number') throw new HttpError(400, 'expected createdAt/expiresAt');
  return body as unknown as RelayRequest;
}

export function createRelayServer(options: { broker: Broker; daemonToken: string; log?: (line: string) => void }): Server {
  const { broker, daemonToken } = options;
  const log = options.log ?? (() => {});

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://relay');
    const key = `${req.method} ${url.pathname}`;
    if (key === 'GET /v1/health') return send(res, 200, { ok: true });
    requireToken(req, daemonToken, 'daemon');

    if (key === 'POST /v1/requests') {
      broker.submit(parseRequest(await readJson(req)));
      return send(res, 200, { status: 'accepted' });
    }
    if (key === 'POST /v1/requests/close') {
      const body = await readJson(req);
      if (typeof body.requestId !== 'string' || !CLOSE_STATUSES.has(body.status as string)) {
        throw new HttpError(400, 'expected requestId and status (resolved|expired|abandoned)');
      }
      broker.close(body.requestId, body.status as 'resolved' | 'expired' | 'abandoned', typeof body.detail === 'string' ? body.detail : '');
      return send(res, 200, { status: 'ok' });
    }
    if (key === 'GET /v1/verdicts') {
      const after = Number(url.searchParams.get('after') ?? '-1');
      const wait = Math.min(Number(url.searchParams.get('wait') ?? '0'), MAX_WAIT_MS);
      if (!Number.isInteger(after) || !Number.isFinite(wait)) throw new HttpError(400, 'bad after/wait');
      const hangup = new AbortController();
      res.on('close', () => hangup.abort());
      const page = await broker.waitForVerdicts(after, wait, hangup.signal);
      if (!res.destroyed) send(res, 200, page);
      return;
    }
    throw new HttpError(404, 'not found');
  }

  const server = createServer((req, res) => {
    route(req, res).catch(handleErrors(res, log));
  });
  server.requestTimeout = 0; // long-polls are held open up to MAX_WAIT_MS
  return server;
}
