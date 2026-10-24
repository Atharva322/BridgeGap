// Shared request/verdict shapes between the daemon and the relay.
// See docs/DATA.md for the reasoning behind each field.
import { randomBytes, randomInt, sign, verify, type KeyLike } from 'node:crypto';

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

export type Channel = 'cli' | 'slack';

export interface Verdict {
  requestId: string;
  decision: Decision;
  approver: string; // e.g. "athar" (cli) or "slack:U012AB3CD (atharva)"
  channel: Channel;
  reason?: string;
  decidedAt: number;
}

/** What the daemon sends the relay: the request as created locally, minus its local status. */
export type RelayRequest = Omit<BlockedRequest, 'status'>;

/** A verdict as delivered by the relay. `seq` is the relay's cursor for long-polling (D-014). */
export interface SignedVerdict {
  seq: number;
  verdict: Verdict;
  signature: string; // base64 Ed25519 over canonicalVerdict(verdict) (D-016)
}

// A fixed field order so signer and verifier hash identical bytes regardless of object key order.
function canonicalVerdict(v: Verdict): Buffer {
  return Buffer.from(JSON.stringify([v.requestId, v.decision, v.approver, v.channel, v.reason ?? null, v.decidedAt]));
}

export function signVerdict(verdict: Verdict, privateKey: KeyLike): string {
  return sign(null, canonicalVerdict(verdict), privateKey).toString('base64');
}

export function verifyVerdict(verdict: Verdict, signature: string, publicKey: KeyLike): boolean {
  try {
    return verify(null, canonicalVerdict(verdict), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false; // malformed key or signature counts as a failed check, never as a pass
  }
}

/** Everything a daemon needs to trust one relay, exchanged once as an opaque code (D-016). */
export interface Pairing {
  relayUrl: string;
  daemonToken: string;
  relayPublicKey: string; // PEM
}

export function encodePairing(pairing: Pairing): string {
  return Buffer.from(JSON.stringify(pairing)).toString('base64url');
}

export function decodePairing(code: string): Pairing {
  let value: Partial<Pairing>;
  try {
    value = JSON.parse(Buffer.from(code.trim(), 'base64url').toString('utf8'));
  } catch {
    throw new Error('not a valid pairing code');
  }
  if (typeof value.relayUrl !== 'string' || typeof value.daemonToken !== 'string' || typeof value.relayPublicKey !== 'string') {
    throw new Error('pairing code is missing relayUrl, daemonToken or relayPublicKey');
  }
  return { relayUrl: value.relayUrl.replace(/\/+$/, ''), daemonToken: value.daemonToken, relayPublicKey: value.relayPublicKey };
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
