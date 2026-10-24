// Loopback HTTP server: Claude Code's PermissionRequest hook POSTs here and the request is held open
// until a verdict arrives (local CLI or, when paired, the relay), the hold expires, or Claude drops
// the connection. See docs/FLOW.md.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildPreview, type Decision, type Verdict } from '@bridgegap/protocol';
import { handleErrors, HttpError, readJson, requireToken, send } from '@bridgegap/protocol/http';
import type { RelayClient } from './relay-client.ts';
import type { Store } from './store.ts';

export interface DaemonOptions {
  store: Store;
  hookToken: string; // presented by Claude Code's hook; can only create requests
  adminToken: string; // presented by the approver CLI; can resolve requests
  holdMs: number; // must be shorter than the hook's own timeout so we answer before Claude gives up
  relay?: RelayClient; // set once paired (Stage 2); absent means local-only
  log?: (line: string) => void;
}

export interface Daemon {
  server: Server;
  /** Entry point for verdicts from the relay; signature already verified by RelayClient. */
  acceptRelayVerdict(verdict: Verdict): void;
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

export function createDaemon(options: DaemonOptions): Daemon {
  const { store, holdMs, relay } = options;
  const log = options.log ?? (() => {});
  // requestId -> delivers a verdict to the hook connection that is waiting for it.
  const waiters = new Map<string, (verdict: Verdict) => void>();

  async function handlePermissionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireToken(req, options.hookToken, 'hook');
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

    const outcome = new Promise<Verdict | 'expired' | 'abandoned'>((resolve) => {
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
    // Registered as a waiter before forwarding, so even an instant remote verdict has somewhere to land.
    if (relay) void relay.submit(request);
    const result = await outcome;

    if (result === 'abandoned') {
      store.closeRequest(request.requestId, 'abandoned');
      log(`GONE     ${request.replyCode}  agent stopped waiting`);
      void relay?.close(request.requestId, 'abandoned', 'The agent stopped waiting.');
      return;
    }
    if (result === 'expired') {
      store.closeRequest(request.requestId, 'expired');
      log(`EXPIRED  ${request.replyCode}  handing back to the local prompt`);
      void relay?.close(request.requestId, 'expired', 'No answer in time; handed back to the local prompt.');
      // D-005: no decision means Claude Code shows its normal permission dialog. Never auto-allow.
      send(res, 200, {});
      return;
    }
    log(`${result.decision.toUpperCase().padEnd(8)} ${request.replyCode}  by ${result.approver} via ${result.channel}`);
    if (result.channel !== 'slack') {
      void relay?.close(request.requestId, 'resolved', `${result.decision === 'allow' ? 'Allowed' : 'Denied'} locally by ${result.approver}.`);
    }
    send(res, 200, hookDecision(result));
  }

  async function handleVerdict(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireToken(req, options.adminToken, 'admin');
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
    requireToken(req, options.adminToken, 'admin');
    send(res, 200, { pending: store.listPending() });
  }

  function acceptRelayVerdict(verdict: Verdict): void {
    // Same first-wins rule as the CLI: a verdict for a request that is no longer pending here
    // (answered locally, expired, from a previous daemon run) is dropped.
    const result = store.applyVerdict(verdict);
    if (!result.ok) {
      log(`IGNORED  relay verdict for ${verdict.requestId}: not pending here`);
      return;
    }
    waiters.get(verdict.requestId)?.(result.verdict);
  }

  const server = createServer((req, res) => {
    const route = `${req.method} ${req.url}`;
    const handled =
      route === 'POST /hooks/permission-request'
        ? handlePermissionRequest(req, res)
        : route === 'POST /verdicts'
          ? handleVerdict(req, res)
          : route === 'GET /requests/pending'
            ? Promise.resolve().then(() => handlePending(req, res))
            : Promise.reject(new HttpError(404, 'not found'));
    handled.catch(handleErrors(res, log));
  });
  // WHY: a hook request is held open for minutes while a human decides. Node's default
  // requestTimeout (300s) would cut it off, and Claude would treat that as a hook failure.
  server.requestTimeout = 0;
  return { server, acceptRelayVerdict };
}
