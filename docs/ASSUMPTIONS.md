# ASSUMPTIONS & OPEN QUESTIONS

Status values: **unverified** / verified / wrong. Clear or explicitly accept every unverified item before shipping to anyone else.

| ID | Assumption / question | Status | How to verify |
|---|---|---|---|
| A-001 | Whether Claude Code's terminal dialog stays live while a PermissionRequest hook is blocking, so the first answer wins | unverified | Headless `-p` was proven (T-1). The interactive TUI needs a manual test: run `claude` with the hook, trigger a Bash prompt, and check whether the terminal dialog appears while the hook waits |
| A-002 | The full Codex hooks event list and output schema, and whether a running Codex TUI can be attached to | unverified | Codex docs and a local test |
| A-003 | Which agents implement ACP `session/request_permission` correctly (Copilot `--acp` auto-approves, per #845) | unverified | Test each agent |
| A-004 | Slack, Twilio and Gmail round-trip latency, rate limits and signature details | unverified | Channel spike |
| A-005 | OpenAI's mobile Codex approvals (secondary source only) | unverified | Official OpenAI docs |
| A-006 | Whether a third-party Claude channel plugin can join Anthropic's allowlist | unverified | Anthropic docs or contact |
| A-007 | Teams and enterprises will pay for cross-vendor approvals with policy, given that HumanLayer abandoned standalone approval routing | unverified | Customer interviews |
| A-009 | Whether a SQLite driver works on Windows, macOS and Linux without a native build (`node:sqlite` built-in vs `better-sqlite3` prebuilt binaries) | **verified (Windows)** 2026-10-23 | `node:sqlite` works on Windows with Node 22.20 with no native build; it prints an ExperimentalWarning, which we suppress. macOS and Linux still to check |
| A-010 | Node 22's global `WebSocket` client works with Slack Socket Mode: `apps.connections.open`, `hello`, envelope acknowledgements, `disconnect` and reconnect | **verified** 2026-10-23 | Live: `apps.connections.open` and the `hello` handshake worked through Node 22.20's global WebSocket, and the interactive envelope was acknowledged and handled. The connection-rotation `disconnect`/reconnect path has not been seen live yet |
| A-011 | `chat.postMessage` with `channel=<user ID>` and only `chat:write`/`im:write` delivers a DM from the app, and `chat.update` works on it | **verified** 2026-10-23 | Live: `chat.postMessage` to a user ID delivered the DM, and `chat.update` ran without error after the verdict |
| A-012 | Slack interaction payloads carry `user.id` for the clicker, and over Socket Mode that ID can't be spoofed by other workspace members (D-010 relies on this) | **verified (live)** 2026-10-23 | Live: the click payload carried `user.id` U0CBN9Y0RA9 plus a username over Socket Mode. Non-approver rejection is covered by T-5 against a fake Slack, not yet tried with a second real user |
| A-008 | The PermissionRequest hook timeout can be raised far enough for SMS and email escalation (tens of minutes) | partly verified | The HTTP hook with `timeout: 300` held and was answered in Claude Code 2.1.300 `-p`. A wait of more than 10 minutes (`timeout: 1800`) has not been tested yet |
