# HANDOVER

## Latest session: 2026-10-23 (model: claude-opus-5-5): Stage 2 (relay + Slack)

**Done:**
- Decisions recorded:
  - D-014: HTTP long-poll between daemon and relay.
  - D-015: Slack Socket Mode with no SDK.
  - D-016: Ed25519-signed verdicts, with the relay key pinned at pairing.
  - D-017: the local CLI stays valid, and the first answer wins.
- New package `packages/relay`:
  - `RelayStore` for durable state, with verdicts numbered by `seq`;
  - `Broker` (first answer wins, signing, expiry, long-poll wakeups);
  - the daemon-facing HTTP API;
  - `SlackChannel` with DMs, Allow/Deny, approver checks and message rewrites;
  - `runSocketMode` on Node's global `WebSocket`.
- Daemon:
  - `RelayClient` (submit, close, long-poll with signature checks);
  - `bridgegap pair <code>` / `unpair`;
  - `createDaemon()` now returns `{ server, acceptRelayVerdict }`.
- Protocol: `signVerdict` / `verifyVerdict`, pairing codes, and shared HTTP helpers (`@bridgegap/protocol/http`).
- Slack app manifest, `.env.example`, and `docs/SLACK-SETUP.md`.
- Still zero runtime dependencies.
- `npm test` passes 26/26 (run twice) and the type-check is clean. A smoke test of the real relay and daemon processes passed (TESTING.md).

**In progress:**
- None.

**Broken or risky:**
- Nothing has run against a live Slack workspace yet (A-010, A-011, A-012). The Socket Mode code is written from the protocol and has only been tested against a fake Slack API.
- A-001 is still open: whether the interactive TUI shows its dialog while the hook waits.
- A relay on a plain `http://` URL off localhost sends the daemon token and previews in clear. TLS is required in that setup (THREAT.md).
- Nothing limits how many requests can be sent to approvers.

**Next:**
1. The user creates the Slack app (SLACK-SETUP.md) and fills in `.env`. Then run the live test: real `claude`, a Slack DM, a click, and the session continues. Record the results against A-010–A-012.
2. Manual TUI test for A-001.
3. Stage 3 candidates:
   - the escalation ladder (Slack, then SMS via Twilio);
   - a Slack deny-reason modal;
   - a Codex app-server adapter (D-011);
   - a rate limit on submitted requests.

**Do not touch:**
- The order of the patterns in `SECRET_PATTERNS`.
- `server.requestTimeout = 0` in both servers.
- The daemon registers the waiter *before* `relay.submit()`.
- In Socket Mode, envelopes are acknowledged before they are handled.

Read first: ARCHITECTURE.md, CONSTRAINTS.md
