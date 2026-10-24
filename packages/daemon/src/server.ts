// Loopback HTTP server: Claude Code's PermissionRequest hook POSTs here and the request is held open
// until a verdict arrives, the hold expires, or Claude drops the connection. See docs/FLOW.md.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { buildPreview, type Decision, type Verdict } from '@bridgegap/protocol';
import type { Store } from './store.ts';

export interface DaemonOptions {
  store: Store;
  hookToken: string; // presented by Claude Code's hook; can only create requests
  adminToken: string; // presented by the approver CLI; can resolve requests
  holdMs: number; // must be shorter than the hook's own timeout so we answer before Claude gives up
  log?: (line: string) => void;
}

const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const presented = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const wanted = Buffer.from(expected);
  return presented.length === wanted.length && timingSafeEqual(presented, wanted);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Claude Code's PermissionRequest output schema. */
function hookDecision(verdict: Verdict): unknown {
  const decision: Record<string, unknown> = { behavior: verdict.decision };
  if (verdict.decision === 'deny') {
    decision.message = verdict.reason
      ? `Denied by ${verdict.approver} via BridgeGap: ${verdict.reason}`
      : `Denied by ${verdict.approver} via BridgeGap.`;
  }
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}

export function createDaemonServer(options: DaemonOptions): Server {
  const { store, holdMs } = options;
  const log = options.log ?? (() => {});
  // requestId -> delivers a verdict to the hook connection that is waiting for it.
  const waiters = new Map<string, (verdict: Verdict) => void>();

  async function handlePermissionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!tokenMatches(req.headers.authorization, options.hookToken)) throw new HttpError(401, 'bad hook token');
    const input = await readJson(req);
    if (typeof input.session_id !== 'string' || typeof input.tool_name !== 'string') {
      throw new HttpError(400, 'expected session_id and tool_name');
    }
    const request = store.createRequest({
      sessionId: input.session_id,
      cwd: typeof input.cwd === 'string' ? input.cwd : '',
      toolName: input.tool_name,
      preview: buildPreview(input.tool_name, input.tool_input),
      holdMs,
    });
    log(`PENDING  ${request.replyCode}  ${request.preview}  (session ${request.sessionId.slice(0, 8)})`);

    const outcome = await new Promise<Verdict | 'expired' | 'abandoned'>((resolve) => {
      const finish = (value: Verdict | 'expired' | 'abandoned') => {
        clearTimeout(timer);
        waiters.delete(request.requestId);
        resolve(value);
      };
      const timer = setTimeout(() => finish('expired'), holdMs);
      waiters.set(request.requestId, finish);
      // Claude cancelled the hook (user interrupted, or its own timeout fired before ours).
      res.on('close', () => {
        if (waiters.has(request.requestId)) finish('abandoned');
      });
    });

    if (outcome === 'abandoned') {
      store.closeRequest(request.requestId, 'abandoned');
      log(`GONE     ${request.replyCode}  agent stopped waiting`);
      return;
    }
    if (outcome === 'expired') {
      store.closeRequest(request.requestId, 'expired');
      log(`EXPIRED  ${request.replyCode}  handing back to the local prompt`);
      // D-005: no decision means Claude Code shows its normal permission dialog. Never auto-allow.
      send(res, 200, {});
      return;
    }
    log(`${outcome.decision.toUpperCase().padEnd(8)} ${request.replyCode}  by ${outcome.approver}`);
    send(res, 200, hookDecision(outcome));
  }

  async function handleVerdict(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!tokenMatches(req.headers.authorization, options.adminToken)) throw new HttpError(401, 'bad admin token');
    const body = await readJson(req);
    const decision = body.decision;
    if (typeof body.code !== 'string' || (decision !== 'allow' && decision !== 'deny')) {
      throw new HttpError(400, 'expected code and decision (allow|deny)');
    }
    const approver = typeof body.approver === 'string' && body.approver ? body.approver : 'unknown';
    const reason = typeof body.reason === 'string' && body.reason ? body.reason : undefined;
    const result = store.recordVerdict(body.code.trim().toLowerCase(), decision as Decision, approver, reason);
    if (!result.ok) {
      send(res, 404, { error: result.reason });
      return;
    }
    const deliver = waiters.get(result.verdict.requestId);
    deliver?.(result.verdict);
    send(res, 200, { status: 'recorded', delivered: Boolean(deliver), requestId: result.verdict.requestId });
  }

  function handlePending(req: IncomingMessage, res: ServerResponse): void {
    if (!tokenMatches(req.headers.authorization, options.adminToken)) throw new HttpError(401, 'bad admin token');
    send(res, 200, { pending: store.listPending() });
  }

  const server = createServer((req, res) => {
    const route = `${req.method} ${req.url}`;
    const handled =
      route === 'POST /hooks/permission-request'
        ? handlePermissionRequest(req, res)
        : route === 'POST /verdicts'
          ? handleVerdict(req, res)
          : route === 'GET /requests/pending'
            ? Promise.resolve(handlePending(req, res))
            : Promise.reject(new HttpError(404, 'not found'));
    handled.catch((err: unknown) => {
      if (res.headersSent) return;
      if (err instanceof HttpError) send(res, err.status, { error: err.message });
      else {
        log(`ERROR    ${(err as Error).message}`);
        send(res, 500, { error: 'internal error' });
      }
    });
  });
  // WHY: a hook request is held open for minutes while a human decides. Node's default
  // requestTimeout (300s) would cut it off, and Claude would treat that as a hook failure.
  server.requestTimeout = 0;
  return server;
}
