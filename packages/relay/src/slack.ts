// Slack channel (D-006, D-015): DMs each approver an Allow/Deny message, turns button clicks into
// verdicts through the Broker, and rewrites the messages when the request ends.
// Identity (D-010): only the clicking user's Slack ID counts, checked against the approver list;
// it arrives over the Socket Mode connection Slack authenticated with our app-level token.
import type { StoredRequest, RelayStore } from './store.ts';
import type { Broker, Outcome } from './broker.ts';

export interface SlackApi {
  /** Calls a Slack Web API method; throws if Slack answers ok:false. */
  call(method: string, body: Record<string, unknown>): Promise<Record<string, any>>;
  /** Posts to an interaction's response_url (used for ephemeral replies to the clicker). */
  respond(responseUrl: string, body: Record<string, unknown>): Promise<void>;
}

export function slackWebApi(botToken: string): SlackApi {
  return {
    async call(method, body) {
      const res = await fetch(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as Record<string, any>;
      if (!json.ok) throw new Error(`slack ${method} failed: ${json.error ?? res.status}`);
      return json;
    },
    async respond(responseUrl, body) {
      await fetch(responseUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    },
  };
}

const ALLOW = 'bridgegap_allow';
const DENY = 'bridgegap_deny';

// Slack mrkdwn control characters; the preview is untrusted (it comes from the agent's tool input).
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/```/g, "'''");
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function summaryBlocks(request: StoredRequest): unknown[] {
  const expires = Math.floor(request.expiresAt / 1000);
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Claude Code is asking for permission*  \`${request.replyCode}\`\n\`\`\`${escapeMrkdwn(request.preview)}\`\`\`` },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${escapeMrkdwn(baseName(request.cwd))} · session ${request.sessionId.slice(0, 8)} · expires <!date^${expires}^{time}|soon>`,
        },
      ],
    },
  ];
}

export function pendingMessage(request: StoredRequest): { text: string; blocks: unknown[] } {
  return {
    text: `Claude Code is asking for permission: ${request.preview}`,
    blocks: [
      ...summaryBlocks(request),
      {
        type: 'actions',
        block_id: 'bridgegap_decision',
        elements: [
          { type: 'button', action_id: ALLOW, style: 'primary', text: { type: 'plain_text', text: 'Allow' }, value: request.requestId },
          { type: 'button', action_id: DENY, style: 'danger', text: { type: 'plain_text', text: 'Deny' }, value: request.requestId },
        ],
      },
    ],
  };
}

export function finishedMessage(request: StoredRequest, outcome: Outcome): { text: string; blocks: unknown[] } {
  let status: string;
  if (outcome.kind === 'verdict') {
    const who = outcome.verdict.approver.match(/^slack:(U[A-Z0-9]+)/)?.[1];
    const by = who ? `<@${who}>` : escapeMrkdwn(outcome.verdict.approver);
    status = outcome.verdict.decision === 'allow' ? `:white_check_mark: Allowed by ${by}` : `:no_entry: Denied by ${by}`;
  } else if (outcome.status === 'expired') status = ':hourglass: Expired; handed back to the local prompt';
  else if (outcome.status === 'abandoned') status = ':heavy_minus_sign: The agent stopped waiting';
  else status = `:computer: ${escapeMrkdwn(outcome.detail)}`;
  return {
    text: `${status}: ${request.preview}`,
    blocks: [...summaryBlocks(request), { type: 'context', elements: [{ type: 'mrkdwn', text: status }] }],
  };
}

export interface SlackChannelOptions {
  broker: Broker;
  store: RelayStore;
  api: SlackApi;
  approvers: string[]; // Slack user IDs allowed to decide (D-010)
  log?: (line: string) => void;
}

export class SlackChannel {
  private readonly broker: Broker;
  private readonly store: RelayStore;
  private readonly api: SlackApi;
  private readonly approvers: Set<string>;
  private readonly log: (line: string) => void;
  /** Pending Slack posts per request, so finishing can wait for the messages it must rewrite. */
  private readonly posting = new Map<string, Promise<void>>();

  constructor(options: SlackChannelOptions) {
    this.broker = options.broker;
    this.store = options.store;
    this.api = options.api;
    this.approvers = new Set(options.approvers);
    this.log = options.log ?? (() => {});
    this.broker.onCreated((request) => {
      const post = this.notify(request).catch((err) => this.log(`SLACK    notify ${request.replyCode} failed: ${(err as Error).message}`));
      this.posting.set(request.requestId, post);
    });
    this.broker.onFinished((request, outcome) => {
      void this.finish(request, outcome).catch((err) => this.log(`SLACK    update ${request.replyCode} failed: ${(err as Error).message}`));
    });
  }

  private async notify(request: StoredRequest): Promise<void> {
    const message = pendingMessage(request);
    for (const user of this.approvers) {
      // Posting to a user ID delivers a DM from the app.
      const res = await this.api.call('chat.postMessage', { channel: user, ...message });
      this.store.addMessage(request.requestId, { channel: 'slack', address: String(res.channel), messageId: String(res.ts) });
    }
    this.log(`SLACK    sent ${request.replyCode} to ${this.approvers.size} approver(s)`);
  }

  private async finish(request: StoredRequest, outcome: Outcome): Promise<void> {
    await this.posting.get(request.requestId);
    this.posting.delete(request.requestId);
    const message = finishedMessage(request, outcome);
    for (const m of this.store.messagesFor(request.requestId, 'slack')) {
      await this.api.call('chat.update', { channel: m.address, ts: m.messageId, ...message });
    }
  }

  /** Handles a Socket Mode `interactive` payload (a button click). */
  async handleInteraction(payload: Record<string, any>): Promise<void> {
    if (payload.type !== 'block_actions') return;
    const action = payload.actions?.[0];
    if (!action || (action.action_id !== ALLOW && action.action_id !== DENY) || typeof action.value !== 'string') return;
    const userId: string | undefined = payload.user?.id;
    const reply = (text: string) =>
      typeof payload.response_url === 'string'
        ? this.api.respond(payload.response_url, { response_type: 'ephemeral', replace_original: false, text })
        : Promise.resolve();

    if (!userId || !this.approvers.has(userId)) {
      this.store.audit(action.value, 'verdict_rejected', `slack user ${userId ?? 'unknown'} is not an approver`);
      this.log(`SLACK    REJECTED click from non-approver ${userId}`);
      await reply('You are not an approver for BridgeGap requests, so your click was ignored.');
      return;
    }
    const name = payload.user?.username ?? payload.user?.name;
    const approver = `slack:${userId}${name ? ` (${name})` : ''}`;
    const result = this.broker.decide(action.value, action.action_id === ALLOW ? 'allow' : 'deny', approver, 'slack');
    if (!result.ok) await reply('This request is no longer waiting for an answer.');
  }
}

/**
 * Socket Mode connection loop (D-015): opens a WebSocket URL with the app-level token, acknowledges
 * every envelope immediately (Slack retries anything not acked within 3 s), and reconnects when Slack
 * asks to or the socket drops. Uses Node's global WebSocket client.
 */
export async function runSocketMode(
  appToken: string,
  onInteractive: (payload: Record<string, any>) => Promise<void>,
  log: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  let backoff = 1_000;
  while (!signal.aborted) {
    try {
      const res = await fetch('https://slack.com/api/apps.connections.open', {
        method: 'POST',
        headers: { authorization: `Bearer ${appToken}`, 'content-type': 'application/x-www-form-urlencoded' },
        signal,
      });
      const json = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!json.ok || !json.url) throw new Error(`apps.connections.open failed: ${json.error ?? res.status}`);

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(json.url!);
        const stop = () => ws.close();
        signal.addEventListener('abort', stop, { once: true });
        ws.addEventListener('message', (event) => {
          const message = JSON.parse(String(event.data)) as Record<string, any>;
          if (message.envelope_id) ws.send(JSON.stringify({ envelope_id: message.envelope_id }));
          if (message.type === 'hello') {
            backoff = 1_000;
            log('SLACK    connected (Socket Mode)');
          } else if (message.type === 'disconnect') {
            ws.close(); // Slack is rotating the connection; reconnect below
          } else if (message.type === 'interactive' && message.payload) {
            onInteractive(message.payload).catch((err) => log(`SLACK    interaction failed: ${(err as Error).message}`));
          }
        });
        ws.addEventListener('close', () => {
          signal.removeEventListener('abort', stop);
          resolve();
        });
        ws.addEventListener('error', () => ws.close());
      });
    } catch (err) {
      if (signal.aborted) return;
      log(`SLACK    connection error: ${(err as Error).message}`);
    }
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 30_000);
  }
}
