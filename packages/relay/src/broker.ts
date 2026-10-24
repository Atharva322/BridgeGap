// The relay's core: accepts requests from daemons, lets channels decide them (first valid verdict
// wins), signs verdicts (D-016), expires stale requests, and wakes daemons that are long-polling.
// Channels never talk to daemons and daemons never talk to channels; both go through here.
import type { KeyObject } from 'node:crypto';
import { signVerdict, type Channel, type Decision, type RelayRequest, type SignedVerdict, type Verdict } from '@bridgegap/protocol';
import type { RelayStore, StoredRequest } from './store.ts';

export type Outcome =
  | { kind: 'verdict'; verdict: Verdict }
  | { kind: 'closed'; status: 'resolved' | 'expired' | 'abandoned'; detail: string };

export type DecideResult = { ok: true; verdict: Verdict } | { ok: false; reason: 'unknown_request' | 'not_pending' };

export class Broker {
  private readonly store: RelayStore;
  private readonly signingKey: KeyObject;
  private readonly createdListeners: ((request: StoredRequest) => void)[] = [];
  private readonly finishedListeners: ((request: StoredRequest, outcome: Outcome) => void)[] = [];
  private readonly pollers = new Set<() => void>();

  constructor(store: RelayStore, signingKey: KeyObject) {
    this.store = store;
    this.signingKey = signingKey;
  }

  onCreated(listener: (request: StoredRequest) => void): void {
    this.createdListeners.push(listener);
  }

  onFinished(listener: (request: StoredRequest, outcome: Outcome) => void): void {
    this.finishedListeners.push(listener);
  }

  submit(request: RelayRequest): void {
    if (!this.store.insertRequest(request)) return; // duplicate submit from a retrying daemon
    const stored = this.store.getRequest(request.requestId)!;
    for (const listener of this.createdListeners) listener(stored);
  }

  decide(requestId: string, decision: Decision, approver: string, channel: Channel, reason?: string): DecideResult {
    const request = this.store.getRequest(requestId);
    if (!request) return { ok: false, reason: 'unknown_request' };
    const verdict: Verdict = { requestId, decision, approver, channel, decidedAt: Date.now() };
    if (reason) verdict.reason = reason;
    const seq = this.store.insertVerdict(verdict, signVerdict(verdict, this.signingKey));
    if (seq === undefined) return { ok: false, reason: 'not_pending' };
    this.emitFinished(requestId, { kind: 'verdict', verdict });
    for (const wake of this.pollers) wake();
    return { ok: true, verdict };
  }

  /** A daemon reports the request ended on its side (answered locally, expired, agent gone). */
  close(requestId: string, status: 'resolved' | 'expired' | 'abandoned', detail: string): void {
    if (this.store.closeRequest(requestId, status, detail)) this.emitFinished(requestId, { kind: 'closed', status, detail });
  }

  /** Requests past their deadline: the daemon has already handed control back to the local prompt. */
  expireDue(now: number = Date.now()): void {
    for (const request of this.store.dueForExpiry(now)) {
      this.close(request.requestId, 'expired', 'No answer in time; handed back to the local prompt.');
    }
  }

  /**
   * Long-poll: resolves with verdicts after `after` as soon as there are any, or with none after
   * `waitMs`. `after = -1` (or a cursor beyond the end, e.g. after a relay database reset) means "from now".
   */
  async waitForVerdicts(after: number, waitMs: number, signal: AbortSignal): Promise<{ verdicts: SignedVerdict[]; cursor: number }> {
    const latest = this.store.latestSeq();
    if (after < 0 || after > latest) return { verdicts: [], cursor: latest };
    const available = this.store.verdictsAfter(after);
    if (available.length || waitMs <= 0) return this.page(after, available);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.pollers.delete(done);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      this.pollers.add(done);
      signal.addEventListener('abort', done);
    });
    return this.page(after, this.store.verdictsAfter(after));
  }

  private page(after: number, verdicts: SignedVerdict[]): { verdicts: SignedVerdict[]; cursor: number } {
    return { verdicts, cursor: verdicts.length ? verdicts[verdicts.length - 1]!.seq : after };
  }

  private emitFinished(requestId: string, outcome: Outcome): void {
    const request = this.store.getRequest(requestId)!;
    for (const listener of this.finishedListeners) listener(request, outcome);
  }
}
