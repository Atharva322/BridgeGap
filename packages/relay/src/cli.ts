// bridgegap-relay <command>: run the relay (broker + channels), or print a pairing code for a daemon.
import { encodePairing } from '@bridgegap/protocol';
import { Broker } from './broker.ts';
import { loadRelayConfig } from './config.ts';
import { createRelayServer } from './server.ts';
import { runSocketMode, SlackChannel, slackWebApi } from './slack.ts';
import { RelayStore } from './store.ts';

const USAGE = `usage: bridgegap-relay <command>
  run     start the relay (reads SLACK_* and BRIDGEGAP_* from the environment / .env)
  pair    print the pairing code to give a daemon: npm run bridgegap -- pair <code>`;

const EXPIRY_SWEEP_MS = 5_000;

function main(argv: string[]): number | Promise<number> {
  const [command] = argv;
  const config = loadRelayConfig();
  const log = (line: string) => console.log(`[relay] ${line}`);

  switch (command) {
    case 'pair':
      console.log(encodePairing({ relayUrl: config.publicUrl, daemonToken: config.daemonToken, relayPublicKey: config.publicKeyPem }));
      return 0;
    case 'run': {
      const store = new RelayStore(config.dbPath);
      const broker = new Broker(store, config.signingKey);
      const stop = new AbortController();
      if (config.slack) {
        const slack = new SlackChannel({ broker, store, api: slackWebApi(config.slack.botToken), approvers: config.slack.approvers, log });
        void runSocketMode(config.slack.appToken, (payload) => slack.handleInteraction(payload), log, stop.signal);
        log(`slack channel on; approvers: ${config.slack.approvers.join(', ')}`);
      } else {
        log('slack channel OFF: set SLACK_BOT_TOKEN, SLACK_APP_TOKEN and BRIDGEGAP_SLACK_APPROVERS (see docs/SLACK-SETUP.md)');
      }
      const sweeper = setInterval(() => broker.expireDue(), EXPIRY_SWEEP_MS);
      const server = createRelayServer({ broker, daemonToken: config.daemonToken, log });
      server.on('error', (err: NodeJS.ErrnoException) => {
        console.error(err.code === 'EADDRINUSE' ? `port ${config.port} is already in use; is another relay running?` : err.message);
        process.exit(1);
      });
      server.listen(config.port, config.host, () => log(`listening on ${config.host}:${config.port}  (db ${config.dbPath})`));
      const shutdown = () => {
        stop.abort();
        clearInterval(sweeper);
        server.close();
        server.closeAllConnections();
        store.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return new Promise<number>(() => {}); // run until signalled
    }
    default:
      console.error(USAGE);
      return command ? 2 : 0;
  }
}

Promise.resolve()
  .then(() => main(process.argv.slice(2)))
  .then(
    (code) => process.exit(code),
    (err: Error) => {
      console.error(err.message);
      process.exit(1);
    },
  );
