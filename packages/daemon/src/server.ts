// Loopback HTTP server: Claude Code's PermissionRequest hook POSTs here and the request is held open
// until a verdict arrives (local CLI or, when paired, the relay), the hold expires, or Claude drops
// the connection. See docs/FLOW.md.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildPreview, toolCallKey, type Decision, type Verdict } from '@bridgegap/protocol';
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

type Outcome = Verdict | 'expired' | 'abandoned' | 'answered_locally';

interface Waiter {
  finish: (outcome: Outcome) => void;
  callKey: string; // toolCallKey(session, tool, input): how PostToolUse finds this request (D-018)
}

export function createDaemon(options: DaemonOptions): Daemon {
  const { store, holdMs, relay } = options;
  const log = options.log ?? (() => {});
  // requestId -> the held hook connection. Map iteration is insertion order, i.e. oldest first.
  const waiters = new Map<string, Waiter>();

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

    const outcome = new Promise<Outcome>((resolve) => {
      const finish = (value: Outcome) => {
        clearTimeout(timer);
        waiters.delete(request.requestId);
        resolve(value);
      };
      const timer = setTimeout(() => finish('expired'), holdMs);
      waiters.set(request.requestId, { finish, callKey: toolCallKey(input.session_id as string, request.toolName, input.tool_input) });
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
    if (result === 'answered_locally') {
      store.closeRequest(request.requestId, 'resolved', 'answered_locally');
      log(`LOCAL    ${request.replyCode}  answered in the terminal`);
      void relay?.close(request.requestId, 'resolved', 'Answered in the terminal.');
      // Claude already acted on the terminal answer and ignores whatever this returns (A-013).
      send(res, 200, {});
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
    const waiter = waiters.get(result.verdict.requestId);
    waiter?.finish(result.verdict);
    send(res, 200, { status: 'recorded', delivered: Boolean(waiter), requestId: result.verdict.requestId });
  }

  /**
   * PostToolUse / PostToolUseFailure: the tool ran, so if we are still holding its permission request,
   * the human must have approved it in the terminal (D-018). Always answers with an empty object, a
   * no-op for Claude, even when nothing matches (the usual case: the request was answered through us).
   */
  async function handleToolFinished(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireToken(req, options.hookToken, 'hook');
    const input = await readJson(req);
    if (typeof input.session_id === 'string' && typeof input.tool_name === 'string') {
      const key = toolCallKey(input.session_id, input.tool_name, input.tool_input);
      for (const waiter of waiters.values()) {
        if (waiter.callKey === key) {
          waiter.finish('answered_locally');
          break; // oldest identical call only
        }
      }
    }
    send(res, 200, {});
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
    waiters.get(verdict.requestId)?.finish(result.verdict);
  }

  const server = createServer((req, res) => {
    const route = `${req.method} ${req.url}`;
    const handled =
      route === 'POST /hooks/permission-request'
        ? handlePermissionRequest(req, res)
        : route === 'POST /hooks/tool-finished'
          ? handleToolFinished(req, res)
          : route === 'POST /verdicts'
          ? handleVerdict(req, res)
          : route === 'GET /requests/pending'
            ? Promise.resolve().then(() => handlePending(req, res))
            : Promise.reject(new HttpError(404, 'not found'));
    handled.catch((err: unknown) => {
      // A rejected hook call is invisible to the user (Claude just shows its own prompt), so say so here.
      if (err instanceof HttpError && err.status === 401) log(`REJECTED ${route}: ${err.message} (is BRIDGEGAP_HOOK_TOKEN set in the shell that started claude?)`);
      handleErrors(res, log)(err);
    });
  });
  // WHY: a hook request is held open for minutes while a human decides. Node's default
  // requestTimeout (300s) would cut it off, and Claude would treat that as a hook failure.
  server.requestTimeout = 0;
  return { server, acceptRelayVerdict };
}
