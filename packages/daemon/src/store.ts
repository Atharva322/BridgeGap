// Durable record of requests, verdicts and an append-only audit log (D-003).
// node:sqlite is synchronous, so each method below runs to completion without interleaving
// with other requests on the event loop; that is what makes "first verdict wins" race-free here.
import { DatabaseSync } from 'node:sqlite';
import {
  newReplyCode,
  newRequestId,
  type BlockedRequest,
  type Decision,
  type RequestStatus,
  type Verdict,
} from '@bridgegap/protocol';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS requests (
    request_id TEXT PRIMARY KEY,
    reply_code TEXT NOT NULL,
    agent      TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd        TEXT NOT NULL,
    tool_name  TEXT NOT NULL,
    preview    TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('pending','resolved','expired','abandoned')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  -- Reply codes only need to be unique while a request is waiting; finished requests may reuse them.
  CREATE UNIQUE INDEX IF NOT EXISTS requests_pending_code ON requests(reply_code) WHERE status = 'pending';
  CREATE TABLE IF NOT EXISTS verdicts (
    request_id TEXT PRIMARY KEY REFERENCES requests(request_id),
    decision   TEXT NOT NULL CHECK (decision IN ('allow','deny')),
    approver   TEXT NOT NULL,
    channel    TEXT NOT NULL,
    reason     TEXT,
    decided_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    request_id TEXT,
    event      TEXT NOT NULL,
    detail     TEXT
  );
`;

// SQLITE_CONSTRAINT_UNIQUE / SQLITE_CONSTRAINT_PRIMARYKEY extended result codes.
const UNIQUE_VIOLATIONS = new Set([2067, 1555]);

export type NewRequest = Pick<BlockedRequest, 'sessionId' | 'cwd' | 'toolName' | 'preview'> & {
  holdMs: number;
};

export type VerdictResult =
  | { ok: true; verdict: Verdict }
  | { ok: false; reason: 'no_pending_request' };

interface RequestRow {
  request_id: string;
  reply_code: string;
  session_id: string;
  cwd: string;
  tool_name: string;
  preview: string;
  status: RequestStatus;
  created_at: number;
  expires_at: number;
}

function toRequest(row: RequestRow): BlockedRequest {
  return {
    requestId: row.request_id,
    replyCode: row.reply_code,
    agent: 'claude-code',
    sessionId: row.session_id,
    cwd: row.cwd,
    toolName: row.tool_name,
    preview: row.preview,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createRequest(input: NewRequest, now: number = Date.now()): BlockedRequest {
    const insert = this.db.prepare(
      `INSERT INTO requests (request_id, reply_code, agent, session_id, cwd, tool_name, preview, status, created_at, expires_at)
       VALUES (?, ?, 'claude-code', ?, ?, ?, ?, 'pending', ?, ?)`,
    );
    // 25^5 ≈ 9.8M codes, so a collision among the handful of pending requests is rare; retry a few times.
    for (let attempt = 0; attempt < 5; attempt++) {
      const requestId = newRequestId(now);
      const replyCode = newReplyCode();
      try {
        insert.run(requestId, replyCode, input.sessionId, input.cwd, input.toolName, input.preview, now, now + input.holdMs);
      } catch (err) {
        if (UNIQUE_VIOLATIONS.has((err as { errcode?: number }).errcode ?? -1)) continue;
        throw err;
      }
      this.audit(requestId, 'request_created', input.preview, now);
      return this.getRequest(requestId)!;
    }
    throw new Error('could not allocate a unique reply code');
  }

  getRequest(requestId: string): BlockedRequest | undefined {
    const row = this.db.prepare('SELECT * FROM requests WHERE request_id = ?').get(requestId) as RequestRow | undefined;
    return row && toRequest(row);
  }

  findPendingByCode(replyCode: string): BlockedRequest | undefined {
    const row = this.db
      .prepare(`SELECT * FROM requests WHERE reply_code = ? AND status = 'pending'`)
      .get(replyCode) as RequestRow | undefined;
    return row && toRequest(row);
  }

  listPending(): BlockedRequest[] {
    const rows = this.db
      .prepare(`SELECT * FROM requests WHERE status = 'pending' ORDER BY created_at`)
      .all() as unknown as RequestRow[];
    return rows.map(toRequest);
  }

  /** First valid verdict wins; anything after that is rejected as not pending. */
  recordVerdict(
    replyCode: string,
    decision: Decision,
    approver: string,
    reason: string | undefined,
    now: number = Date.now(),
  ): VerdictResult {
    const request = this.findPendingByCode(replyCode);
    if (!request) return { ok: false, reason: 'no_pending_request' };
    const verdict: Verdict = { requestId: request.requestId, decision, approver, channel: 'cli', reason, decidedAt: now };
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO verdicts (request_id, decision, approver, channel, reason, decided_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(verdict.requestId, decision, approver, verdict.channel, reason ?? null, now);
      this.db.prepare(`UPDATE requests SET status = 'resolved' WHERE request_id = ? AND status = 'pending'`).run(verdict.requestId);
      this.audit(verdict.requestId, `verdict_${decision}`, `by ${approver} via cli${reason ? `: ${reason}` : ''}`, now);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { ok: true, verdict };
  }

  /** Moves a still-pending request to a terminal status (expired by timeout, abandoned by the agent). */
  closeRequest(requestId: string, status: 'expired' | 'abandoned', now: number = Date.now()): boolean {
    const result = this.db
      .prepare(`UPDATE requests SET status = ? WHERE request_id = ? AND status = 'pending'`)
      .run(status, requestId);
    if (result.changes === 0) return false;
    this.audit(requestId, `request_${status}`, null, now);
    return true;
  }

  /**
   * On startup, any request still marked pending belonged to a hook connection that died with the
   * previous daemon process, so nothing can deliver a verdict to it anymore.
   */
  abandonOrphans(now: number = Date.now()): number {
    let count = 0;
    for (const request of this.listPending()) if (this.closeRequest(request.requestId, 'abandoned', now)) count++;
    return count;
  }

  auditTrail(requestId: string): { event: string; detail: string | null }[] {
    return this.db
      .prepare('SELECT event, detail FROM audit_log WHERE request_id = ? ORDER BY id')
      .all(requestId) as unknown as { event: string; detail: string | null }[];
  }

  private audit(requestId: string | null, event: string, detail: string | null, now: number = Date.now()): void {
    this.db.prepare('INSERT INTO audit_log (at, request_id, event, detail) VALUES (?, ?, ?, ?)').run(now, requestId, event, detail);
  }
}
