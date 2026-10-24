# DATA

Status: draft. Finalize when the protocol spec is written.

| Structure | Shape | Access pattern | Size | Writers | Trade-off |
|---|---|---|---|---|---|
| `requests` | `request_id` (ULID), session_id, agent, machine, cwd, tool, redacted preview, tier, status, created_at, expires_at | Insert once; look up by id; scan pending requests by expiry | One row per blocked event | Daemon (through the broker) | ULIDs sort by time, which gives cheap expiry scans, but they are longer than short codes |
| `verdicts` | request_id (unique), decision, approver_id, channel, signature, decided_at | Unique insert (first wins); read by the daemon on reconnect | ≤ 1 per request | Broker | The unique constraint enforces idempotency |
| `reply_codes` | code, approver_id, request_id, expires_at | Look up by (approver, code) | Short-lived | Broker | Short codes for SMS are scoped per approver to avoid collisions |
| `audit_log` | Append-only events | Write constantly, read rarely | Grows forever; needs a retention policy | Broker only | Append-only makes tampering visible |
| `policies` | YAML rules: matcher → tier, approvers, ladder, default | Read on every request; cached | Small | Admins | YAML is easy to review but needs schema validation |
| `approvers` | user, Slack ID, phone, email, allowed tiers | Look up by channel identity | Small | Admins | Identity mapping is a protected area |
