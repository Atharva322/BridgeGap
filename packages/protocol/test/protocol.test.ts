import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPreview, newReplyCode, newRequestId, PREVIEW_MAX } from '@bridgegap/protocol';

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
