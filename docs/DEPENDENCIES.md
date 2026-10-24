# DEPENDENCIES & SECRETS

Record every dependency and every secret.

## Dependencies
| Package | Version (pinned) | Why needed | Maintainer | Added |
|---|---|---|---|---|
| none yet | | | | |

## Secrets
Store these only in gitignored env files. Never paste them into chat or commit them.

| Secret | Used by | Stored in |
|---|---|---|
| Slack signing secret, bot token | Slack channel | relay env |
| Twilio auth token | SMS channel | relay env |
| Verdict signing key | broker (signs), daemon (verifies) | relay KMS/env; the daemon holds the public key only |
