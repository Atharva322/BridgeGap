// Small HTTP helpers shared by the daemon and relay servers (both use bare node:http, D-013).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export const MAX_BODY_BYTES = 1024 * 1024;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Constant-time bearer token check. */
export function tokenMatches(header: string | undefined, expected: string): boolean {
  const presented = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const wanted = Buffer.from(expected);
  return presented.length === wanted.length && timingSafeEqual(presented, wanted);
}

export function requireToken(req: IncomingMessage, expected: string, what: string): void {
  if (!tokenMatches(req.headers.authorization, expected)) throw new HttpError(401, `bad ${what} token`);
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  // JSON-only bodies: a browser cannot send this content type cross-site without a CORS preflight,
  // which we never answer (THREAT: website in the developer's browser).
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'expected application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'body must be a JSON object');
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Maps thrown errors to responses; anything that is not an HttpError is logged and hidden as a 500. */
export function handleErrors(res: ServerResponse, log: (line: string) => void) {
  return (err: unknown): void => {
    if (res.headersSent) return;
    if (err instanceof HttpError) send(res, err.status, { error: err.message });
    else {
      log(`ERROR    ${(err as Error).stack ?? err}`);
      send(res, 500, { error: 'internal error' });
    }
  };
}
