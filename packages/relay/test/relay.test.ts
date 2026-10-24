// Relay tests: broker rules, the Slack channel against a fake Slack API, and the full chain
// daemon hook -> relay -> Slack click -> signed verdict -> daemon -> hook response, over real HTTP.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';
import { newRequestId, verifyVerdict, type RelayRequest } from '@bridgegap/protocol';
import { RelayClient } from '../../daemon/src/relay-client.ts';
import { createDaemon } from '../../daemon/src/server.ts';
import { Store } from '../../daemon/src/store.ts';
import { Broker } from '../src/broker.ts';
import { createRelayServer } from '../src/server.ts';
import { SlackChannel, type SlackApi } from '../src/slack.ts';
import { RelayStore } from '../src/store.ts';

const APPROVER = 'U0APPROVER';
const DAEMON_TOKEN = 'd'.repeat(64);
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

function request(overrides: Partial<RelayRequest> = {}): RelayRequest {
  const now = Date.now();
  return {
    requestId: newRequestId(now),
    replyCode: 'abcde',
    agent: 'claude-code',
    sessionId: 'sess-1',
    cwd: '/repo',
    toolName: 'Bash',
    preview: 'Bash: npm test',
    createdAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

/** Records Slack API calls; answers chat.postMessage like Slack does (channel + ts). */
function fakeSlack() {
  const calls: { method: string; body: Record<string, any> }[] = [];
  const responses: { url: string; body: Record<string, unknown> }[] = [];
  let ts = 0;
  const api: SlackApi = {
    async call(method, body) {
      calls.push({ method, body });
      return method === 'chat.postMessage' ? { ok: true, channel: `D-${body.channel}`, ts: String(++ts) } : { ok: true };
    },
    async respond(url, body) {
      responses.push({ url, body });
    },
  };
  return { api, calls, responses };
}

function click(requestId: string, userId: string, action: 'bridgegap_allow' | 'bridgegap_deny' = 'bridgegap_allow') {
  return {
    type: 'block_actions',
    user: { id: userId, username: 'atharva' },
    response_url: 'https://hooks.slack.test/resp',
    actions: [{ action_id: action, value: requestId }],
  };
}

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function setupRelay() {
  const { privateKey, publicKey, publicKeyPem } = keys();
  const store = new RelayStore(':memory:');
  const broker = new Broker(store, privateKey);
  const slack = fakeSlack();
  const channel = new SlackChannel({ broker, store, api: slack.api, approvers: [APPROVER] });
  cleanups.push(() => store.close());
  return { store, broker, slack, channel, publicKey, publicKeyPem };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('broker: first verdict wins, verdicts are signed, duplicate submits are ignored', () => {
  const { broker, store, publicKey } = setupRelay();
  const req = request();
  broker.submit(req);
  broker.submit(req);
  const first = broker.decide(req.requestId, 'deny', 'slack:U1', 'slack');
  const second = broker.decide(req.requestId, 'allow', 'slack:U2', 'slack');
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, reason: 'not_pending' });
  assert.deepEqual(broker.decide('nope', 'allow', 'x', 'slack'), { ok: false, reason: 'unknown_request' });
  const [signed] = store.verdictsAfter(0);
  assert.ok(signed && verifyVerdict(signed.verdict, signed.signature, publicKey));
  assert.deepEqual(store.auditTrail(req.requestId).map((e) => e.event), ['request_received', 'verdict_deny']);
});

test('T-2: a verdict issued while no daemon is polling is delivered on the next poll from the cursor', async () => {
  const { broker } = setupRelay();
  const start = await broker.waitForVerdicts(-1, 0, new AbortController().signal);
  const req = request();
  broker.submit(req);
  broker.decide(req.requestId, 'allow', 'slack:U1', 'slack'); // nobody is listening right now
  const page = await broker.waitForVerdicts(start.cursor, 0, new AbortController().signal);
  assert.equal(page.verdicts.length, 1);
  assert.equal(page.verdicts[0]!.verdict.requestId, req.requestId);
  const again = await broker.waitForVerdicts(page.cursor, 0, new AbortController().signal);
  assert.equal(again.verdicts.length, 0, 'delivered once per cursor');
});

test('broker: long-poll wakes up as soon as a verdict is made', async () => {
  const { broker } = setupRelay();
  const req = request();
  broker.submit(req);
  const started = Date.now();
  const poll = broker.waitForVerdicts(0, 5_000, new AbortController().signal);
  setTimeout(() => broker.decide(req.requestId, 'allow', 'slack:U1', 'slack'), 50);
  const page = await poll;
  assert.equal(page.verdicts.length, 1);
  assert.ok(Date.now() - started < 2_000);
});

test('broker: expired requests are closed and can no longer be decided', () => {
  const { broker, store } = setupRelay();
  const req = request({ expiresAt: Date.now() - 1 });
  broker.submit(req);
  broker.expireDue();
  assert.equal(store.getRequest(req.requestId)?.status, 'expired');
  assert.deepEqual(broker.decide(req.requestId, 'allow', 'slack:U1', 'slack'), { ok: false, reason: 'not_pending' });
});

test('slack: each approver gets a DM with Allow/Deny; the message is rewritten when decided', async () => {
  const { broker, slack, channel } = setupRelay();
  const req = request();
  broker.submit(req);
  await until(() => slack.calls.length === 1, 'postMessage');
  const post = slack.calls[0]!;
  assert.equal(post.method, 'chat.postMessage');
  assert.equal(post.body.channel, APPROVER);
  const buttons = post.body.blocks.at(-1).elements.map((e: any) => [e.action_id, e.value]);
  assert.deepEqual(buttons, [['bridgegap_allow', req.requestId], ['bridgegap_deny', req.requestId]]);

  await channel.handleInteraction(click(req.requestId, APPROVER));
  await until(() => slack.calls.some((c) => c.method === 'chat.update'), 'chat.update');
  const update = slack.calls.find((c) => c.method === 'chat.update')!;
  assert.deepEqual([update.body.channel, update.body.ts], [`D-${APPROVER}`, '1']);
  assert.match(JSON.stringify(update.body.blocks), new RegExp(`Allowed by <@${APPROVER}>`));
  assert.ok(!JSON.stringify(update.body.blocks).includes('bridgegap_allow'), 'buttons removed');
});

test('T-5 (D-010): a click from someone who is not an approver is rejected and audited', async () => {
  const { broker, store, slack, channel } = setupRelay();
  const req = request();
  broker.submit(req);
  await channel.handleInteraction(click(req.requestId, 'U0INTRUDER'));
  assert.equal(store.getRequest(req.requestId)?.status, 'pending');
  assert.equal(slack.responses.length, 1);
  assert.match(String(slack.responses[0]!.body.text), /not an approver/);
  assert.ok(store.auditTrail(req.requestId).some((e) => e.event === 'verdict_rejected'));
});

test('slack: preview text cannot inject Slack markup', async () => {
  const { broker, slack } = setupRelay();
  broker.submit(request({ preview: 'Bash: echo <!channel> <@U999> ```x```' }));
  await until(() => slack.calls.length === 1, 'postMessage');
  const text = JSON.stringify(slack.calls[0]!.body.blocks);
  assert.ok(!text.includes('<!channel>') && !text.includes('<@U999>'));
});

test('relay API: the daemon token is required and cannot be used to create verdicts', async () => {
  const { broker } = setupRelay();
  const base = await listen(createRelayServer({ broker, daemonToken: DAEMON_TOKEN }));
  const noToken = await fetch(`${base}/v1/verdicts?after=-1`);
  assert.equal(noToken.status, 401);
  const forge = await fetch(`${base}/v1/verdicts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${DAEMON_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'x', decision: 'allow' }),
  });
  assert.equal(forge.status, 404, 'there is no endpoint for daemons to submit verdicts');
});

async function fullChain(daemonTrustsKeyPem?: string) {
  const relay = setupRelay();
  const relayUrl = await listen(createRelayServer({ broker: relay.broker, daemonToken: DAEMON_TOKEN }));
  const store = new Store(':memory:');
  cleanups.push(() => store.close());
  const logs: string[] = [];
  const client = new RelayClient(
    { relayUrl, daemonToken: DAEMON_TOKEN, relayPublicKey: daemonTrustsKeyPem ?? relay.publicKeyPem },
    (line) => logs.push(line),
  );
  const { server, acceptRelayVerdict } = createDaemon({ store, hookToken: 'h', adminToken: 'a', holdMs: 1_500, relay: client });
  const daemonUrl = await listen(server);
  const stop = new AbortController();
  cleanups.push(() => stop.abort());
  void client.run(acceptRelayVerdict, stop.signal);
  await until(() => logs.some((l) => l.includes('connected')), 'relay connection');

  const hook = fetch(`${daemonUrl}/hooks/permission-request`, {
    method: 'POST',
    headers: { authorization: 'Bearer h', 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 'sess-e2e', cwd: '/repo', tool_name: 'Bash', tool_input: { command: 'npm test' } }),
  });
  await until(() => relay.slack.calls.some((c) => c.method === 'chat.postMessage'), 'slack DM');
  const requestId = relay.slack.calls[0]!.body.blocks.at(-1).elements[0].value as string;
  await relay.channel.handleInteraction(click(requestId, APPROVER));
  return { hook, logs, store, requestId, relay };
}

test('T-1 (Stage 2): hook -> relay -> Slack Allow -> signed verdict -> daemon -> allow', async () => {
  const { hook, store, requestId, relay } = await fullChain();
  const body = (await (await hook).json()) as any;
  assert.deepEqual(body, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  assert.equal(store.getRequest(requestId)?.status, 'resolved');
  assert.match(store.auditTrail(requestId).at(-1)!.detail!, /slack:U0APPROVER \(atharva\) via slack/);
  assert.equal(relay.store.getRequest(requestId)?.status, 'resolved');
});

test('D-016: a daemon pinned to a different relay key rejects the verdict and falls back to the local prompt', async () => {
  const { hook, logs, store, requestId } = await fullChain(keys().publicKeyPem);
  assert.deepEqual(await (await hook).json(), {}, 'hold expired; no decision; Claude shows its own prompt');
  assert.ok(logs.some((l) => l.includes('REJECTED') && l.includes('bad signature')));
  assert.equal(store.getRequest(requestId)?.status, 'expired');
});

test('D-018: a terminal Yes (seen as PostToolUse) rewrites Slack to "Answered in the terminal" and refuses later clicks', async () => {
  const relay = setupRelay();
  const relayUrl = await listen(createRelayServer({ broker: relay.broker, daemonToken: DAEMON_TOKEN }));
  const store = new Store(':memory:');
  cleanups.push(() => store.close());
  const client = new RelayClient({ relayUrl, daemonToken: DAEMON_TOKEN, relayPublicKey: relay.publicKeyPem });
  const { server } = createDaemon({ store, hookToken: 'h', adminToken: 'a', holdMs: 5_000, relay: client });
  const daemonUrl = await listen(server);
  const call = { session_id: 's', cwd: '/r', tool_name: 'Bash', tool_input: { command: 'echo second > f.txt' } };
  const post = (path: string, body: unknown) =>
    fetch(`${daemonUrl}${path}`, { method: 'POST', headers: { authorization: 'Bearer h', 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const hook = post('/hooks/permission-request', call);
  await until(() => relay.slack.calls.length === 1, 'slack DM');
  await post('/hooks/tool-finished', { ...call, hook_event_name: 'PostToolUse', tool_use_id: 'toolu_1' });
  await hook;
  await until(() => relay.slack.calls.some((c) => c.method === 'chat.update'), 'slack update');
  assert.match(JSON.stringify(relay.slack.calls.at(-1)!.body.blocks), /Answered in the terminal/);

  const requestId = relay.slack.calls[0]!.body.blocks.at(-1).elements[0].value as string;
  await relay.channel.handleInteraction(click(requestId, APPROVER));
  assert.match(String(relay.slack.responses.at(-1)!.body.text), /no longer waiting/);
  assert.equal(relay.store.verdictsAfter(0).length, 0, 'no misleading Slack verdict is recorded (A-013)');
});

test('D-017: answering locally updates the Slack message and later clicks are refused', async () => {
  const relay = setupRelay();
  const relayUrl = await listen(createRelayServer({ broker: relay.broker, daemonToken: DAEMON_TOKEN }));
  const store = new Store(':memory:');
  cleanups.push(() => store.close());
  const client = new RelayClient({ relayUrl, daemonToken: DAEMON_TOKEN, relayPublicKey: relay.publicKeyPem });
  const { server } = createDaemon({ store, hookToken: 'h', adminToken: 'a', holdMs: 5_000, relay: client });
  const daemonUrl = await listen(server);
  const hook = fetch(`${daemonUrl}/hooks/permission-request`, {
    method: 'POST',
    headers: { authorization: 'Bearer h', 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 's', cwd: '/r', tool_name: 'Bash', tool_input: { command: 'ls' } }),
  });
  await until(() => relay.slack.calls.length === 1, 'slack DM');
  const [pending] = store.listPending();
  await fetch(`${daemonUrl}/verdicts`, {
    method: 'POST',
    headers: { authorization: 'Bearer a', 'content-type': 'application/json' },
    body: JSON.stringify({ code: pending!.replyCode, decision: 'deny', approver: 'athar' }),
  });
  await hook;
  await until(() => relay.slack.calls.some((c) => c.method === 'chat.update'), 'slack update');
  assert.match(JSON.stringify(relay.slack.calls.at(-1)!.body.blocks), /Denied locally by athar/);
  await relay.channel.handleInteraction(click(pending!.requestId, APPROVER));
  assert.match(String(relay.slack.responses.at(-1)!.body.text), /no longer waiting/);
});
