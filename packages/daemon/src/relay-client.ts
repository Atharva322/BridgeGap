// Outbound-only link from the daemon to its paired relay (D-009, D-014).
// Requests go up with POST; verdicts come down through a long-poll loop with a cursor, so verdicts
// issued while the daemon was disconnected are picked up on the next poll.
import { createPublicKey, type KeyObject } from 'node:crypto';
import { verifyVerdict, type BlockedRequest, type Pairing, type RelayRequest, type SignedVerdict, type Verdict } from '@bridgegap/protocol';

const POLL_WAIT_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

export type CloseStatus = 'resolved' | 'expired' | 'abandoned';

export class RelayClient {
  private readonly pairing: Pairing;
  private readonly publicKey: KeyObject;
  private readonly log: (line: string) => void;

  constructor(pairing: Pairing, log: (line: string) => void = () => {}) {
    this.pairing = pairing;
    this.publicKey = createPublicKey(pairing.relayPublicKey);
    this.log = log;
  }

  get url(): string {
    return this.pairing.relayUrl;
  }

  private async call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const res = await fetch(`${this.pairing.relayUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.pairing.daemonToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`relay ${method} ${path} -> ${res.status} ${json.error ?? ''}`.trim());
    return json;
  }

  /** Best effort: if the relay is down the request still works locally (CLI, expiry → local prompt). */
  async submit(request: BlockedRequest): Promise<boolean> {
    const { status: _status, ...wire } = request;
    try {
      await this.call('POST', '/v1/requests', wire satisfies RelayRequest);
      return true;
    } catch (err) {
      this.log(`RELAY    could not forward ${request.replyCode}: ${(err as Error).message}`);
      return false;
    }
  }

  /** Tells the relay a request ended locally so channels can update (e.g. disable Slack buttons). */
  async close(requestId: string, status: CloseStatus, detail: string): Promise<void> {
    try {
      await this.call('POST', '/v1/requests/close', { requestId, status, detail });
    } catch (err) {
      this.log(`RELAY    could not report ${status} for ${requestId}: ${(err as Error).message}`);
    }
  }

  /**
   * Long-polls for verdicts until `signal` aborts. Only verdicts whose signature verifies against the
   * pinned relay key are passed on (D-016); the caller still checks the request is pending locally.
   */
  async run(onVerdict: (verdict: Verdict) => void, signal: AbortSignal): Promise<void> {
    // -1 asks the relay for "now": we only care about verdicts for requests this process created.
    let cursor = -1;
    let backoff = 1_000;
    let connected = false;
    while (!signal.aborted) {
      try {
        const page = (await this.call('GET', `/v1/verdicts?after=${cursor}&wait=${POLL_WAIT_MS}`, undefined, signal)) as {
          verdicts: SignedVerdict[];
          cursor: number;
        };
        if (!connected) this.log(`RELAY    connected to ${this.pairing.relayUrl}`);
        connected = true;
        backoff = 1_000;
        for (const item of page.verdicts) {
          if (verifyVerdict(item.verdict, item.signature, this.publicKey)) onVerdict(item.verdict);
          else this.log(`RELAY    REJECTED verdict for ${item.verdict.requestId}: bad signature`);
        }
        cursor = page.cursor;
      } catch (err) {
        if (signal.aborted) return;
        if (connected) this.log(`RELAY    disconnected: ${(err as Error).message}`);
        connected = false;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }
}
