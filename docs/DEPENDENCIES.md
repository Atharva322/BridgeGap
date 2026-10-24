# DEPENDENCIES & SECRETS

Record every dependency and every secret.

## Dependencies
| Package | Version (pinned) | Why needed | Maintainer | Added |
|---|---|---|---|---|
| typescript (dev only) | 5.9.3 | Type-checking only. Node runs the `.ts` files directly through built-in type stripping. 7.x was skipped because the new native compiler is too fresh for a spike. | Microsoft | 2026-10-23 |
| @types/node (dev only) | 22.20.5 | Node API types matching the Node 22 runtime | DefinitelyTyped | 2026-10-23 |

**Runtime dependencies: none.**
- Stage 1 uses only Node built-ins: `node:http`, `node:sqlite`, `node:crypto`.
- Stage 2 adds Node's global `fetch` and `WebSocket` (for Slack Socket Mode, D-015) and `node:crypto` Ed25519 (D-016). Still no packages.

## Secrets
Store these only in gitignored env files. Never paste them into chat or commit them.

| Secret | Used by | Stored in |
|---|---|---|
| `SLACK_BOT_TOKEN` (xoxb), `SLACK_APP_TOKEN` (xapp) | Slack channel (Socket Mode, so there is no signing secret) | `.env` (gitignored), read with `--env-file-if-exists` |
| Daemon token | daemon → relay authentication | relay `~/.bridgegap-relay/config.json`; daemon `~/.bridgegap/config.json` (from pairing) |
| Verdict signing key (Ed25519 private key) | relay signs verdicts | relay `~/.bridgegap-relay/config.json` (0600). The daemon holds only the public key |
| Hook and admin tokens | Claude hook → daemon; CLI → daemon | `~/.bridgegap/config.json` (0600) |
| Twilio auth token | SMS channel (later) | relay env |
