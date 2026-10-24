import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import {
  buildPreview,
  decodePairing,
  encodePairing,
  newReplyCode,
  newRequestId,
  PREVIEW_MAX,
  signVerdict,
  verifyVerdict,
  type Verdict,
} from '@bridgegap/protocol';

test('verdict signatures verify, and fail on any tampering or a different key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519').publicKey;
  const verdict: Verdict = { requestId: 'R1', decision: 'deny', approver: 'slack:U1', channel: 'slack', decidedAt: 1 };
  const signature = signVerdict(verdict, privateKey);
  assert.ok(verifyVerdict(verdict, signature, publicKey));
  assert.ok(!verifyVerdict({ ...verdict, decision: 'allow' }, signature, publicKey));
  assert.ok(!verifyVerdict({ ...verdict, requestId: 'R2' }, signature, publicKey));
  assert.ok(!verifyVerdict(verdict, signature, other));
  assert.ok(!verifyVerdict(verdict, 'garbage', publicKey));
});

test('pairing codes round-trip and reject junk', () => {
  const pairing = { relayUrl: 'https://relay.example/', daemonToken: 't', relayPublicKey: 'PEM' };
  assert.deepEqual(decodePairing(encodePairing(pairing)), { ...pairing, relayUrl: 'https://relay.example' });
  assert.throws(() => decodePairing('not-a-code'));
});

test('request ids are 26-char ULIDs that sort by time', () => {
  const a = newRequestId(1_000);
  const b = newRequestId(2_000);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(a < b);
});

test('reply codes are 5 lowercase letters without "l"', () => {
  for (let i = 0; i < 500; i++) assert.match(newReplyCode(), /^[a-km-z]{5}$/);
});

test('preview shows the command for Bash and the path for file tools', () => {
  assert.equal(buildPreview('Bash', { command: 'npm   test' }), 'Bash: npm test');
  assert.equal(buildPreview('Write', { file_path: '/repo/a.ts', content: 'x' }), 'Write: /repo/a.ts');
});

test('preview redacts secrets before they can reach a channel', () => {
  const preview = buildPreview('Bash', {
    command: 'curl -H "Authorization: Bearer abcdefghijklmnop" https://x && API_KEY=s3cr3t ./run && echo ghp_aaaaaaaaaaaaaaaaaaaaaaaa',
  });
  assert.doesNotMatch(preview, /abcdefghijklmnop|s3cr3t|ghp_a/);
  assert.match(preview, /\[redacted\]/);
});

test('preview is capped in length', () => {
  const preview = buildPreview('Bash', { command: 'x'.repeat(5_000) });
  assert.ok(preview.length <= 'Bash: '.length + PREVIEW_MAX);
});
