// bridgegap <command>: run the daemon, or act as the Stage 1 stand-in for a channel (D-013).
import { userInfo } from 'node:os';
import type { BlockedRequest } from '@bridgegap/protocol';
import { claudeHookSettings, loadConfig, type DaemonConfig } from './config.ts';
import { createDaemonServer } from './server.ts';
import { Store } from './store.ts';

const USAGE = `usage: bridgegap <command>
  daemon                  run the local daemon (127.0.0.1 only)
  pending                 list requests waiting for a decision
  approve <code>          allow the request with this reply code
  deny <code> [reason]    deny it, optionally telling the agent why
  hook-config             print the Claude Code settings block and token setup`;

async function callDaemon(config: DaemonConfig, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.adminToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`daemon not reachable on 127.0.0.1:${config.port}; start it with: npm run bridgegap -- daemon`);
  }
  return { status: res.status, json: await res.json() };
}

function describe(request: BlockedRequest): string {
  const age = Math.round((Date.now() - request.createdAt) / 1000);
  return `${request.replyCode}  ${request.preview}\n       session ${request.sessionId}  cwd ${request.cwd}  waiting ${age}s`;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const config = loadConfig();

  switch (command) {
    case 'daemon': {
      const store = new Store(config.dbPath);
      const orphans = store.abandonOrphans();
      const server = createDaemonServer({ ...config, store, log: (line) => console.log(`[bridgegap] ${line}`) });
      server.listen(config.port, '127.0.0.1', () => {
        console.log(`[bridgegap] listening on 127.0.0.1:${config.port}  (db ${config.dbPath})`);
        if (orphans) console.log(`[bridgegap] marked ${orphans} request(s) from a previous run as abandoned`);
      });
      const shutdown = () => {
        server.close();
        server.closeAllConnections(); // held hook requests fail, so Claude falls back to its local prompt
        store.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return new Promise<number>(() => {}); // run until signalled
    }
    case 'pending': {
      const { json } = await callDaemon(config, 'GET', '/requests/pending');
      const pending = json.pending as BlockedRequest[];
      console.log(pending.length ? pending.map(describe).join('\n') : 'no pending requests');
      return 0;
    }
    case 'approve':
    case 'deny': {
      const code = args[0];
      if (!code) {
        console.error(USAGE);
        return 2;
      }
      const reason = command === 'deny' ? args.slice(1).join(' ') || undefined : undefined;
      const { status, json } = await callDaemon(config, 'POST', '/verdicts', {
        code,
        decision: command === 'approve' ? 'allow' : 'deny',
        approver: userInfo().username,
        reason,
      });
      if (status !== 200) {
        console.error(json.error === 'no_pending_request' ? `no pending request with code "${code}"` : `error: ${json.error}`);
        return 1;
      }
      console.log(`${command === 'approve' ? 'allowed' : 'denied'} ${code}${json.delivered ? '' : ' (recorded, but the agent was no longer waiting)'}`);
      return 0;
    }
    case 'hook-config': {
      console.log('Merge this into .claude/settings.local.json (project) or ~/.claude/settings.json:\n');
      console.log(JSON.stringify(claudeHookSettings(config), null, 2));
      console.log('\nThen, in the shell you start `claude` from:');
      console.log(`  PowerShell:  $env:BRIDGEGAP_HOOK_TOKEN = "${config.hookToken}"`);
      console.log(`  bash/zsh:    export BRIDGEGAP_HOOK_TOKEN=${config.hookToken}`);
      return 0;
    }
    default:
      console.error(USAGE);
      return command ? 2 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(err.message);
    process.exit(1);
  },
);
