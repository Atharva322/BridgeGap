// Relay-side durable state (D-003): requests forwarded by daemons, signed verdicts with a monotonically
// increasing `seq` that daemons use as their long-poll cursor (D-014), channel message references,
// and an append-only audit log. Synchronous node:sqlite, so each method is atomic on the event loop.
import { DatabaseSync } from 'node:sqlite';
import type { RelayRequest, RequestStatus, SignedVerdict, Verdict } from '@bridgegap/protocol';

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
    detail     TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS requests_pending_expiry ON requests(expires_at) WHERE status = 'pending';
  CREATE TABLE IF NOT EXISTS verdicts (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE REFERENCES requests(request_id),
    decision   TEXT NOT NULL CHECK (decision IN ('allow','deny')),
    approver   TEXT NOT NULL,
    channel    TEXT NOT NULL,
    reason     TEXT,
    decided_at INTEGER NOT NULL,
    signature  TEXT NOT NULL
  );
  -- Where each request was shown, so the message can be updated when the request ends.
  CREATE TABLE IF NOT EXISTS messages (
    request_id TEXT NOT NULL REFERENCES requests(request_id),
    channel    TEXT NOT NULL,
    address    TEXT NOT NULL,
    message_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    request_id TEXT,
    event      TEXT NOT NULL,
    detail     TEXT
  );
`;

export interface StoredRequest extends RelayRequest {
  status: RequestStatus;
  detail: string | null;
}

export interface ChannelMessage {
  channel: string;
  address: string;
  messageId: string;
}

interface RequestRow {
  request_id: string;
  reply_code: string;
  session_id: string;
  cwd: string;
  tool_name: string;
  preview: string;
  status: RequestStatus;
  detail: string | null;
  created_at: number;
  expires_at: number;
}

interface VerdictRow {
  seq: number;
  request_id: string;
  decision: 'allow' | 'deny';
  approver: string;
  channel: Verdict['channel'];
  reason: string | null;
  decided_at: number;
  signature: string;
}

function toRequest(row: RequestRow): StoredRequest {
  return {
    requestId: row.request_id,
    replyCode: row.reply_code,
    agent: 'claude-code',
    sessionId: row.session_id,
    cwd: row.cwd,
    toolName: row.tool_name,
    preview: row.preview,
    status: row.status,
    detail: row.detail,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function toSigned(row: VerdictRow): SignedVerdict {
  const verdict: Verdict = {
    requestId: row.request_id,
    decision: row.decision,
    approver: row.approver,
    channel: row.channel,
    decidedAt: row.decided_at,
  };
  if (row.reason !== null) verdict.reason = row.reason;
  return { seq: row.seq, verdict, signature: row.signature };
}

export class RelayStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** Idempotent so a daemon may retry a submit; returns true only the first time. */
  insertRequest(request: RelayRequest, now: number = Date.now()): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO requests (request_id, reply_code, agent, session_id, cwd, tool_name, preview, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(request.requestId, request.replyCode, request.agent, request.sessionId, request.cwd, request.toolName, request.preview, request.createdAt, request.expiresAt);
    if (result.changes === 0) return false;
    this.audit(request.requestId, 'request_received', request.preview, now);
    return true;
  }

  getRequest(requestId: string): StoredRequest | undefined {
    const row = this.db.prepare('SELECT * FROM requests WHERE request_id = ?').get(requestId) as RequestRow | undefined;
    return row && toRequest(row);
  }

  /** Stores a verdict if (and only if) the request is still pending. Returns its seq, or undefined. */
  insertVerdict(verdict: Verdict, signature: string): number | undefined {
    const request = this.getRequest(verdict.requestId);
    if (!request || request.status !== 'pending') return undefined;
    this.db.exec('BEGIN');
    try {
      const result = this.db
        .prepare('INSERT INTO verdicts (request_id, decision, approver, channel, reason, decided_at, signature) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(verdict.requestId, verdict.decision, verdict.approver, verdict.channel, verdict.reason ?? null, verdict.decidedAt, signature);
      this.db.prepare(`UPDATE requests SET status = 'resolved' WHERE request_id = ?`).run(verdict.requestId);
      this.audit(verdict.requestId, `verdict_${verdict.decision}`, `by ${verdict.approver} via ${verdict.channel}`, verdict.decidedAt);
      this.db.exec('COMMIT');
      return Number(result.lastInsertRowid);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  closeRequest(requestId: string, status: 'resolved' | 'expired' | 'abandoned', detail: string, now: number = Date.now()): boolean {
    const result = this.db
      .prepare(`UPDATE requests SET status = ?, detail = ? WHERE request_id = ? AND status = 'pending'`)
      .run(status, detail, requestId);
    if (result.changes === 0) return false;
    this.audit(requestId, `request_${status}`, detail, now);
    return true;
  }

  dueForExpiry(now: number): StoredRequest[] {
    const rows = this.db
      .prepare(`SELECT * FROM requests WHERE status = 'pending' AND expires_at <= ?`)
      .all(now) as unknown as RequestRow[];
    return rows.map(toRequest);
  }

  verdictsAfter(seq: number, limit = 100): SignedVerdict[] {
    const rows = this.db.prepare('SELECT * FROM verdicts WHERE seq > ? ORDER BY seq LIMIT ?').all(seq, limit) as unknown as VerdictRow[];
    return rows.map(toSigned);
  }

  latestSeq(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM verdicts').get() as { seq: number };
    return row.seq;
  }

  addMessage(requestId: string, message: ChannelMessage): void {
    this.db
      .prepare('INSERT INTO messages (request_id, channel, address, message_id) VALUES (?, ?, ?, ?)')
      .run(requestId, message.channel, message.address, message.messageId);
  }

  messagesFor(requestId: string, channel: string): ChannelMessage[] {
    const rows = this.db
      .prepare('SELECT channel, address, message_id FROM messages WHERE request_id = ? AND channel = ?')
      .all(requestId, channel) as unknown as { channel: string; address: string; message_id: string }[];
    return rows.map((r) => ({ channel: r.channel, address: r.address, messageId: r.message_id }));
  }

  audit(requestId: string | null, event: string, detail: string | null, now: number = Date.now()): void {
    this.db.prepare('INSERT INTO audit_log (at, request_id, event, detail) VALUES (?, ?, ?, ?)').run(now, requestId, event, detail);
  }

  auditTrail(requestId: string): { event: string; detail: string | null }[] {
    return this.db
      .prepare('SELECT event, detail FROM audit_log WHERE request_id = ? ORDER BY id')
      .all(requestId) as unknown as { event: string; detail: string | null }[];
  }
}
