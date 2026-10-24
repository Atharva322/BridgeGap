// Local daemon settings and secrets, kept in ~/.bridgegap (or $BRIDGEGAP_HOME).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Pairing } from '@bridgegap/protocol';

interface StoredConfig {
  hookToken?: string;
  adminToken?: string;
  relay?: Pairing;
}

export interface DaemonConfig {
  home: string;
  configPath: string;
  relay?: Pairing;
  dbPath: string;
  port: number;
  hookToken: string;
  adminToken: string;
  /** Seconds Claude Code waits on the hook. Our hold is shorter so we always answer first. */
  hookTimeoutSeconds: number;
  holdMs: number;
}

const DEFAULT_PORT = 47600;
const DEFAULT_HOOK_TIMEOUT_SECONDS = 1800; // 30 min, long enough for SMS/email escalation (A-008)
const HOLD_MARGIN_SECONDS = 30;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const home = env.BRIDGEGAP_HOME ?? join(homedir(), '.bridgegap');
  mkdirSync(home, { recursive: true });
  const configPath = join(home, 'config.json');
  let secrets: StoredConfig = {};
  if (existsSync(configPath)) secrets = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!secrets.hookToken || !secrets.adminToken) {
    secrets.hookToken ??= randomBytes(32).toString('hex');
    secrets.adminToken ??= randomBytes(32).toString('hex');
    writeStoredConfig(configPath, secrets);
  }
  const hookTimeoutSeconds = Number(env.BRIDGEGAP_HOOK_TIMEOUT ?? DEFAULT_HOOK_TIMEOUT_SECONDS);
  return {
    home,
    configPath,
    relay: secrets.relay,
    dbPath: join(home, 'bridgegap.db'),
    port: Number(env.BRIDGEGAP_PORT ?? DEFAULT_PORT),
    hookToken: secrets.hookToken!,
    adminToken: secrets.adminToken!,
    hookTimeoutSeconds,
    holdMs: Math.max(hookTimeoutSeconds - HOLD_MARGIN_SECONDS, 1) * 1000,
  };
}

function writeStoredConfig(path: string, value: StoredConfig): void {
  // 0600 keeps other OS users out on macOS/Linux; it has no effect on Windows (see THREAT.md).
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

/** Stores (or with `undefined`, removes) the relay this daemon trusts (D-016). */
export function saveRelayPairing(config: DaemonConfig, pairing: Pairing | undefined): void {
  const stored: StoredConfig = JSON.parse(readFileSync(config.configPath, 'utf8'));
  if (pairing) stored.relay = pairing;
  else delete stored.relay;
  writeStoredConfig(config.configPath, stored);
}

/** The `hooks` block to merge into a Claude Code settings file. The token stays in an env var, not the file. */
export function claudeHookSettings(config: DaemonConfig): unknown {
  return {
    hooks: {
      PermissionRequest: [
        {
          hooks: [
            {
              type: 'http',
              url: `http://127.0.0.1:${config.port}/hooks/permission-request`,
              timeout: config.hookTimeoutSeconds,
              headers: { Authorization: 'Bearer $BRIDGEGAP_HOOK_TOKEN' },
              allowedEnvVars: ['BRIDGEGAP_HOOK_TOKEN'],
            },
          ],
        },
      ],
    },
  };
}
