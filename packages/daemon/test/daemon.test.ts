// Drives the daemon over real HTTP the way Claude Code's hook and the approver CLI do.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';
import { createDaemon } from '../src/server.ts';
import { Store } from '../src/store.ts';

const HOOK_TOKEN = 'h'.repeat(64);
const ADMIN_TOKEN = 'a'.repeat(64);
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startDaemon(holdMs = 5_000) {
  const store = new Store(':memory:');
  const { server } = createDaemon({ store, hookToken: HOOK_TOKEN, adminToken: ADMIN_TOKEN, holdMs });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  return { store, base };
}

const hookInput = {
  session_id: 'sess-1234-abcd',
  hook_event_name: 'PermissionRequest',
  cwd: '/repo',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
};

function postJson(url: string, token: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForPending(store: Store) {
  for (let i = 0; i < 100; i++) {
    const [request] = store.listPending();
    if (request) return request;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no pending request appeared');
}

test('T-1 (local): approve resolves the held hook with an allow decision', async () => {
  const { store, base } = await startDaemon();
  const hook = postJson(`${base}/hooks/permission-request`, HOOK_TOKEN, hookInput);
  const pending = await waitForPending(store);
  assert.equal(pending.preview, 'Bash: npm test');

  const verdict = await postJson(`${base}/verdicts`, ADMIN_TOKEN, { code: pending.replyCode, decision: 'allow', approver: 'atharva' });
  assert.deepEqual(await verdict.json(), { status: 'recorded', delivered: true, requestId: pending.requestId });

  const res = await hook;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
  assert.equal(store.getRequest(pending.requestId)?.status, 'resolved');
  assert.deepEqual(
    store.auditTrail(pending.requestId).map((e) => e.event),
    ['request_created', 'verdict_allow'],
  );
});

test('deny passes the reason back to the agent', async () => {
  const { store, base } = await startDaemon();
  const hook = postJson(`${base}/hooks/permission-request`, HOOK_TOKEN, hookInput);
  const pending = await waitForPending(store);
  await postJson(`${base}/verdicts`, ADMIN_TOKEN, { code: pending.replyCode, decision: 'deny', approver: 'atharva', reason: 'use pnpm' });
  const body = (await (await hook).json()) as any;
  assert.equal(body.hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(body.hookSpecificOutput.decision.message, 'Denied by atharva via BridgeGap: use pnpm');
});

test('T-6: first verdict wins; a second answer for the same code is rejected', async () => {
  const { store, base } = await startDaemon();
  const hook = postJson(`${base}/hooks/permission-request`, HOOK_TOKEN, hookInput);
  const pending = await waitForPending(store);
  const first = await postJson(`${base}/verdicts`, ADMIN_TOKEN, { code: pending.replyCode, decision: 'deny', approver: 'a' });
  const second = await postJson(`${base}/verdicts`, ADMIN_TOKEN, { code: pending.replyCode, decision: 'allow', approver: 'b' });
  assert.equal(first.status, 200);
  assert.equal(second.status, 404);
  assert.deepEqual(await second.json(), { error: 'no_pending_request' });
  assert.equal(((await (await hook).json()) as any).hookSpecificOutput.decision.behavior, 'deny');
});

test('D-005: when the hold expires the hook returns no decision (local prompt), never allow', async () => {
  const { store, base } = await startDaemon(300);
  const hook = postJson(`${base}/hooks/permission-request`, HOOK_TOKEN, hookInput);
  const pending = await waitForPending(store);
  const res = await hook;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {});
  assert.equal(store.getRequest(pending.requestId)?.status, 'expired');
  const late = await postJson(`${base}/verdicts`, ADMIN_TOKEN, { code: pending.replyCode, decision: 'allow' });
  assert.equal(late.status, 404, 'an expired request cannot be approved afterwards');
});

test('a request whose agent hung up is marked abandoned and can no longer be approved', async () => {
  const { store, base } = await startDaemon();
  const controller = new AbortController();
  const hook = fetch(`${base}/hooks/permission-request`, {
    method: 'POST',
    headers: { authorization: `Bearer ${HOOK_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(hookInput),
    signal: controller.signal,
  }).catch(() => 'aborted');
  const pending = await waitForPending(store);
  controller.abort();
  assert.equal(await hook, 'aborted');
  for (let i = 0; i < 100 && store.getRequest(pending.requestId)?.status === 'pending'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(store.getRequest(pending.requestId)?.status, 'abandoned');
  const late = await postJson(`${base}/verdicts`, ADMIN_TOKEN, { code: pending.replyCode, decision: 'allow' });
  assert.equal(late.status, 404);
});

test('tokens are not interchangeable: the hook token cannot approve, a missing token cannot create', async () => {
  const { store, base } = await startDaemon();
  const hook = postJson(`${base}/hooks/permission-request`, HOOK_TOKEN, hookInput);
  const pending = await waitForPending(store);

  const withHookToken = await postJson(`${base}/verdicts`, HOOK_TOKEN, { code: pending.replyCode, decision: 'allow' });
  assert.equal(withHookToken.status, 401);
  const anonymous = await postJson(`${base}/hooks/permission-request`, '', hookInput);
  assert.equal(anonymous.status, 401);
  assert.equal(store.listPending().length, 1);

  await postJson(`${base}/verdicts`, ADMIN_TOKEN, { code: pending.replyCode, decision: 'deny' });
  await hook;
});

test('non-JSON bodies are rejected (blocks simple cross-site form posts from a browser)', async () => {
  const { base } = await startDaemon();
  const res = await fetch(`${base}/verdicts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'text/plain' },
    body: '{"code":"abcde","decision":"allow"}',
  });
  assert.equal(res.status, 415);
});

test('D-018: a PostToolUse for the held call closes it as answered in the terminal', async () => {
  const { store, base } = await startDaemon();
  const hook = postJson(`${base}/hooks/permission-request`, HOOK_TOKEN, hookInput);
  const pending = await waitForPending(store);

  // A different session's identical command, and a different command in this session, must not match.
  for (const other of [
    { ...hookInput, session_id: 'other-session' },
    { ...hookInput, tool_input: { command: 'npm run lint' } },
  ]) {
    const res = await postJson(`${base}/hooks/tool-finished`, HOOK_TOKEN, { ...other, hook_event_name: 'PostToolUse' });
    assert.deepEqual(await res.json(), {});
  }
  assert.equal(store.getRequest(pending.requestId)?.status, 'pending');

  // Same call, keys in a different order plus the tool_use_id PostToolUse adds: must match.
  const finished = await postJson(`${base}/hooks/tool-finished`, HOOK_TOKEN, {
    hook_event_name: 'PostToolUse',
    tool_use_id: 'toolu_123',
    tool_input: { command: 'npm test' },
    tool_name: 'Bash',
    session_id: 'sess-1234-abcd',
    cwd: '/repo',
  });
  assert.deepEqual(await finished.json(), {});
  assert.deepEqual(await (await hook).json(), {}, 'the held hook is released with no decision');
  assert.equal(store.getRequest(pending.requestId)?.status, 'resolved');
  assert.deepEqual(store.auditTrail(pending.requestId).map((e) => e.event), ['request_created', 'answered_locally']);

  const late = await postJson(`${base}/verdicts`, ADMIN_TOKEN, { code: pending.replyCode, decision: 'allow' });
  assert.equal(late.status, 404, 'a later remote answer is refused instead of being logged as an approval');
});

test('D-018: tool-finished needs the hook token and is a no-op when nothing is held', async () => {
  const { base } = await startDaemon();
  const anonymous = await postJson(`${base}/hooks/tool-finished`, '', hookInput);
  assert.equal(anonymous.status, 401);
  const res = await postJson(`${base}/hooks/tool-finished`, HOOK_TOKEN, hookInput);
  assert.equal(res.status, 200);
});

test('abandonOrphans closes requests left pending by a previous daemon run', () => {
  const store = new Store(':memory:');
  const request = store.createRequest({ sessionId: 's', cwd: '/', toolName: 'Bash', preview: 'Bash: ls', holdMs: 1_000 });
  assert.equal(store.abandonOrphans(), 1);
  assert.equal(store.getRequest(request.requestId)?.status, 'abandoned');
  store.close();
});
