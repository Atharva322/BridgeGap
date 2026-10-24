// Local daemon settings and secrets, kept in ~/.bridgegap (or $BRIDGEGAP_HOME).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DaemonConfig {
  home: string;
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
  const secretsPath = join(home, 'config.json');
  let secrets: { hookToken?: string; adminToken?: string } = {};
  if (existsSync(secretsPath)) secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
  if (!secrets.hookToken || !secrets.adminToken) {
    secrets = {
      hookToken: secrets.hookToken ?? randomBytes(32).toString('hex'),
      adminToken: secrets.adminToken ?? randomBytes(32).toString('hex'),
    };
    // 0600 keeps other OS users out on macOS/Linux; it has no effect on Windows (see THREAT.md).
    writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }
  const hookTimeoutSeconds = Number(env.BRIDGEGAP_HOOK_TIMEOUT ?? DEFAULT_HOOK_TIMEOUT_SECONDS);
  return {
    home,
    dbPath: join(home, 'bridgegap.db'),
    port: Number(env.BRIDGEGAP_PORT ?? DEFAULT_PORT),
    hookToken: secrets.hookToken!,
    adminToken: secrets.adminToken!,
    hookTimeoutSeconds,
    holdMs: Math.max(hookTimeoutSeconds - HOLD_MARGIN_SECONDS, 1) * 1000,
  };
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
