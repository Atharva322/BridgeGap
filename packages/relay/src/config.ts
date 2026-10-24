// Relay settings. Signing key and daemon token live in ~/.bridgegap-relay (or $BRIDGEGAP_RELAY_HOME);
// Slack credentials come from the environment (.env, never committed).
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RelayConfig {
  home: string;
  dbPath: string;
  host: string;
  port: number;
  publicUrl: string; // what daemons are told to connect to (put TLS in front for anything non-local)
  daemonToken: string;
  signingKey: KeyObject;
  publicKeyPem: string;
  slack?: { botToken: string; appToken: string; approvers: string[] };
}

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const home = env.BRIDGEGAP_RELAY_HOME ?? join(homedir(), '.bridgegap-relay');
  mkdirSync(home, { recursive: true });
  const path = join(home, 'config.json');
  let stored: { daemonToken?: string; signingKeyPem?: string } = {};
  if (existsSync(path)) stored = JSON.parse(readFileSync(path, 'utf8'));
  if (!stored.daemonToken || !stored.signingKeyPem) {
    stored.daemonToken ??= randomBytes(32).toString('hex');
    stored.signingKeyPem ??= generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    // 0600 on macOS/Linux; no effect on Windows (THREAT.md).
    writeFileSync(path, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }
  const signingKey = createPrivateKey(stored.signingKeyPem);
  const host = env.BRIDGEGAP_RELAY_HOST ?? '127.0.0.1';
  const port = Number(env.BRIDGEGAP_RELAY_PORT ?? 47700);

  const botToken = env.SLACK_BOT_TOKEN;
  const appToken = env.SLACK_APP_TOKEN;
  const approvers = (env.BRIDGEGAP_SLACK_APPROVERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    home,
    dbPath: join(home, 'relay.db'),
    host,
    port,
    publicUrl: (env.BRIDGEGAP_RELAY_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/+$/, ''),
    daemonToken: stored.daemonToken,
    signingKey,
    publicKeyPem: createPublicKey(signingKey).export({ type: 'spki', format: 'pem' }).toString(),
    slack: botToken && appToken && approvers.length ? { botToken, appToken, approvers } : undefined,
  };
}
