// Shared request/verdict shapes between the daemon and (from Stage 2) the relay.
// See docs/DATA.md for the reasoning behind each field.
import { randomBytes, randomInt } from 'node:crypto';

export type Decision = 'allow' | 'deny';

export type RequestStatus = 'pending' | 'resolved' | 'expired' | 'abandoned';

/** One moment where an agent is blocked waiting for a human. */
export interface BlockedRequest {
  requestId: string; // ULID: globally unique, sorts by creation time (D-004)
  replyCode: string; // short human-typeable code, unique among *pending* requests only
  agent: 'claude-code';
  sessionId: string; // the agent's own session id, so the answer resumes the same session
  cwd: string;
  toolName: string;
  preview: string; // redacted, length-capped summary safe to show on any channel
  status: RequestStatus;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms; after this the daemon hands control back to the local prompt
}

export interface Verdict {
  requestId: string;
  decision: Decision;
  approver: string;
  channel: 'cli'; // Stage 2 adds 'slack' | 'sms' | ...
  reason?: string;
  decidedAt: number;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 10 chars of millisecond timestamp + 16 chars of randomness, Crockford base32. */
export function newRequestId(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 256 is a multiple of 32, so `byte % 32` stays uniform.
  const bytes = randomBytes(16);
  let rand = '';
  for (const b of bytes) rand += CROCKFORD[b % 32];
  return time + rand;
}

// Lowercase letters without 'l' (confusable with '1'/'I'), mirroring Claude Channels' request ids.
const REPLY_ALPHABET = 'abcdefghijkmnopqrstuvwxyz';

export function newReplyCode(length = 5): string {
  let code = '';
  for (let i = 0; i < length; i++) code += REPLY_ALPHABET[randomInt(REPLY_ALPHABET.length)];
  return code;
}

// Order matters: the Bearer rule must run before the generic `authorization: <value>` rule,
// which would otherwise consume only the word "Bearer" and leave the token itself visible.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\b(?:api[_-]?key|token|secret|passw(?:or)?d|authorization)\b\s*[=:]\s*["']?[^\s"']+/gi,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
];

export const PREVIEW_MAX = 300;

/**
 * Builds the text a human sees for a request. Channels may be third parties (Slack, Twilio),
 * so this is the single choke point for redaction (CONSTRAINTS: never send secrets in previews).
 */
export function buildPreview(toolName: string, toolInput: unknown): string {
  const input = (toolInput ?? {}) as Record<string, unknown>;
  let text: string;
  if (typeof input.command === 'string') text = input.command;
  else if (typeof input.file_path === 'string') text = input.file_path;
  else text = JSON.stringify(toolInput) ?? '';
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > PREVIEW_MAX) text = text.slice(0, PREVIEW_MAX - 1) + '…';
  return `${toolName}: ${text}`;
}
