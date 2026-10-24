# DEPENDENCIES & SECRETS

Record every dependency and every secret.

## Dependencies
| Package | Version (pinned) | Why needed | Maintainer | Added |
|---|---|---|---|---|
| typescript (dev only) | 5.9.3 | Type-checking only. Node runs the `.ts` files directly through built-in type stripping. 7.x was skipped because the new native compiler is too fresh for a spike. | Microsoft | 2026-10-23 |
| @types/node (dev only) | 22.20.5 | Node API types matching the Node 22 runtime | DefinitelyTyped | 2026-10-23 |

**Runtime dependencies: none.** Stage 1 uses only Node built-ins (`node:http`, `node:sqlite`, `node:crypto`).

## Secrets
Store these only in gitignored env files. Never paste them into chat or commit them.

| Secret | Used by | Stored in |
|---|---|---|
| Slack signing secret, bot token | Slack channel | relay env |
| Twilio auth token | SMS channel | relay env |
| Verdict signing key | broker (signs), daemon (verifies) | relay KMS/env; the daemon holds the public key only |
