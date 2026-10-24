# ASSUMPTIONS & OPEN QUESTIONS

Status values: **unverified** / verified / wrong. Clear or explicitly accept every unverified item before shipping to anyone else.

| ID | Assumption / question | Status | How to verify |
|---|---|---|---|
| A-001 | Whether Claude Code's terminal dialog stays live while a PermissionRequest hook is blocking, so the first answer wins | unverified | Spike: blocking hook plus a local keypress |
| A-002 | The full Codex hooks event list and output schema, and whether a running Codex TUI can be attached to | unverified | Codex docs and a local test |
| A-003 | Which agents implement ACP `session/request_permission` correctly (Copilot `--acp` auto-approves, per #845) | unverified | Test each agent |
| A-004 | Slack, Twilio and Gmail round-trip latency, rate limits and signature details | unverified | Channel spike |
| A-005 | OpenAI's mobile Codex approvals (secondary source only) | unverified | Official OpenAI docs |
| A-006 | Whether a third-party Claude channel plugin can join Anthropic's allowlist | unverified | Anthropic docs or contact |
| A-007 | Teams and enterprises will pay for cross-vendor approvals with policy, given that HumanLayer abandoned standalone approval routing | unverified | Customer interviews |
| A-009 | Whether a SQLite driver works on Windows, macOS and Linux without a native build (`node:sqlite` built-in vs `better-sqlite3` prebuilt binaries) | unverified | Install test on Windows (Node 22.20) during the spike |
| A-008 | The PermissionRequest hook timeout can be raised far enough for SMS and email escalation (tens of minutes) | unverified | Spike with `timeout: 1800` |
