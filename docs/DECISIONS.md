# DECISIONS

One entry per decision: context, options, choice, why, trade-off, and what would make us revisit it. Rejected options are expanded in [ALTERNATIVES.md](ALTERNATIVES.md). Evidence comes from [research/COMPETITIVE-ANALYSIS.md](research/COMPETITIVE-ANALYSIS.md).

---

## D-001: Integrate with agents through official surfaces, not terminal wrapping
Date: 2026-10-23. Model: claude-opus-5-5.

- **Context:** we must detect when an agent is blocked and inject the human's answer into the same session.
- **Options:**
  1. Wrap the PTY or tmux and scrape the screen.
  2. Use official surfaces: hooks, the Agent SDK, the Codex app-server and ACP.
  3. Fork the agents.
- **Chosen:** 2.
- **Why:**
  - Omnara abandoned its Claude Code CLI wrapper because Claude Code changes too often to keep up with.
  - Code Light's keystroke injection fails in practice (MioIsland #95, #96).
  - Official surfaces give structured decisions: allow or deny plus `updatedInput`.
- **Trade-off:** one adapter per agent, and coverage is capped by each vendor's API. For example, Cursor only supports deny.
- **Revisit if:** a vendor removes its hooks, or ACP becomes universal (then go ACP-first).

## D-002: For Claude Code, use a blocking PermissionRequest HTTP hook first and the Channels relay second
Date: 2026-10-23. Model: claude-opus-5-5.

- **Context:** Claude Code offers several ways to intercept a request:
  - PermissionRequest and PreToolUse hooks
  - the `claude/channel/permission` relay in Channels
  - SDK `canUseTool`
  - `--permission-prompt-tool`
  - `defer` + `--resume`
- **Options:**
  1. Channels first.
  2. Hook first.
  3. Agent SDK only.
- **Chosen:** 2. Channels is an optional enhancement; `defer` + `--resume` covers headless long waits.
- **Why:** Channels is a research preview. It needs an org allowlist or `--dangerously-load-development-channels`, and it is ignored under `-p` and the SDK. The hook works in every mode.
- **Trade-off:**
  - The hook's wait is bounded by its timeout: 600 s by default, configurable.
  - Channels keeps the terminal dialog live, with "first answer wins"; the hook path may not (see ASSUMPTIONS A-001).
- **Revisit if:** Channels becomes generally available and allows third-party distribution.

## D-003: Store requests and verdicts durably instead of relaying them in memory
Date: 2026-10-23. Model: claude-opus-5-5.

- **Context:** the most common bug among competitors is losing approvals:
  - Happy #1035 and #1208: an approval sent while the WebSocket is down is lost.
  - Code Light: messages are dropped when the process is gone.
- **Options:**
  1. In-memory socket relay (Happy).
  2. A database-backed queue: SQLite when self-hosted, Postgres when hosted.
  3. Temporal or Inngest.
- **Chosen:** 2.
- **Why:** requests and verdicts must survive the daemon reconnecting and the relay restarting. Temporal is too heavy to operate for an MVP.
- **Trade-off:** we own the state, the migrations and the retention policy.
- **Revisit if:** approvals become multi-step workflows (move to Temporal).

## D-004: Correlate each request with a ULID `request_id` plus a short reply code
Date: 2026-10-23. Model: claude-opus-5-5.

- **Context:** a reply must resolve exactly one pending request.
- **Options:**
  1. A session token (Claude-Code-Remote's 8-character token).
  2. The chat or room ID.
  3. A per-request ID.
- **Chosen:** 3. Each request gets a ULID, and SMS and email get a short code derived from it, like Claude Channels' 5-letter IDs.
- **Why:** coarse tokens route answers to the wrong prompt, or to a prompt that has since changed.
- **Trade-off:** short codes can collide, so we scope them per approver and expire them when the request times out.
- **Revisit if:** no channel needs a short code.

## D-005: On timeout with no policy, deny or hand back to the local prompt, never auto-allow
Date: 2026-10-23. Model: claude-opus-5-5.

- **Options:**
  1. Auto-allow.
  2. Wait forever (Happy, Pocket Agent).
  3. Deny, or fall back to the local prompt.
- **Chosen:** 3.
- **Why:** the system must fail safe. Waiting forever leaves sessions frozen with no signal.
- **Trade-off:** an unanswered agent stalls work.
- **Revisit if:** users want auto-allow for the "safe" tier. That would be allowed only as an explicit opt-in per policy.

## D-006: MVP channels are Slack and SMS; the mobile app comes later
Date: 2026-10-23. Model: claude-opus-5-5.

- **Options:**
  1. A native app first.
  2. Slack plus SMS.
  3. Telegram or Discord.
  4. Email first.
- **Chosen:** 2.
- **Why:**
  - Slack offers signed interactive buttons and team identity.
  - SMS reaches anyone, anywhere.
  - Happy already owns the mobile-app niche, and a native app is costly to build.
- **Trade-off:** Slack and Twilio can read message content, so there is no end-to-end encryption on those channels. We send redacted previews instead.
- **Revisit if:** users require end-to-end encryption or lock-screen approvals.

## D-007: Email approvals use signed one-time links, not parsed replies
Date: 2026-10-23. Model: claude-opus-5-5.

- **Options:**
  1. Parse a "yes" reply.
  2. Signed one-time links.
- **Chosen:** 2.
- **Why:** email senders are easy to spoof.
- **Trade-off:** needs a hosted web endpoint and an extra click.
- **Revisit if:** never for high-risk tiers.

## D-008: BridgeGap relays decisions only, with no remote shell or file access
Date: 2026-10-23. Model: claude-opus-5-5.

- **Options:**
  1. Full remote control: Pocket Agent's public tunnel to a shell, or Code Light's `bash` remote call.
  2. Decisions only.
- **Chosen:** 2.
- **Why:** a small attack surface is a selling point. A compromised relay can at most answer pending requests, and policy limits even that.
- **Trade-off:** no "code from your phone" feature.
- **Revisit if:** never in the core product; it could become a separate opt-in product.

## D-009: The local daemon connects outbound only
Date: 2026-10-23. Model: claude-opus-5-5.

- **Options:**
  1. An inbound tunnel (Pocket Agent's trycloudflare).
  2. LAN only (henrikekblad/codelight).
  3. An outbound WebSocket to a relay.
- **Chosen:** 3.
- **Why:** no ports are exposed, and it works behind NAT and corporate firewalls.
- **Trade-off:** someone has to operate a relay.
- **Revisit if:** a team needs an air-gapped setup (offer a self-hosted relay).

## D-010: Approvers are authenticated individually, not by room membership
Date: 2026-10-23. Model: claude-opus-5-5.

- **Options:**
  1. Anyone in the Slack channel or chat can approve.
  2. Each verdict is checked against the specific authorized approver's identity.
- **Chosen:** 2.
- **Why:** Anthropic's Channels docs warn that gating on the room lets anyone in it approve tool use.
- **Trade-off:** needs a mapping from Slack user ID or phone number to a BridgeGap user, and onboarding to set it up.

## D-011: MVP agents are Claude Code and Codex; Cursor and ACP come in Phase 2
Date: 2026-10-23. Model: claude-opus-5-5.

- **Why:** these two have the most complete approval APIs:
  - Claude Code: PermissionRequest, AskUserQuestion and plan approval.
  - Codex: app-server `requestApproval` and `requestUserInput`.
- Cursor hooks support allow and deny only. ACP implementations vary in quality, for example Copilot's `--acp` auto-approve bug.
- **Revisit if:** user demand is mostly Cursor.

## D-012: TypeScript (Node 22) monorepo with SQLite first and Postgres later
Date: 2026-10-23. Model: claude-opus-5-5. Decided by: Atharva.

- **Context:** we need a stack for the local daemon, the relay (broker, policy, channels) and the shared protocol.
- **Options:**
  1. TypeScript everywhere with SQLite.
  2. A Go daemon with a TypeScript relay.
  3. Go everywhere.
  4. Python.
- **Chosen:** 1. An npm-workspaces monorepo with three packages:
  - `packages/protocol`: request and verdict schemas.
  - `packages/daemon`: hook endpoint and outbound WebSocket.
  - `packages/relay`: broker, policy and channels.
- **Why:**
  - The integrations we need are all TypeScript-first: Slack Bolt, Twilio, the MCP SDK (required for a Claude Channels plugin), the Claude Agent SDK and the ACP libraries.
  - Claude Code users already have Node, so the daemon installs through npm.
  - Using one language lets the daemon and relay share the protocol types with no code generation.
- **Trade-off:**
  - The Node runtime is heavier than a single static Go binary.
  - Native SQLite bindings can fail to build on some platforms (see A-009).
- **Revisit if:** daemon distribution or memory becomes a complaint (move the daemon to Go and keep the relay in TypeScript), or the hosted relay needs Postgres (same schema, swap the driver).

## D-013: Stage 1 spike has a daemon with an embedded store, a loopback HTTP hook, a CLI approver and zero runtime dependencies
Date: 2026-10-23. Model: claude-opus-5-5. Lane A (spike).

- **Context:** we need to prove that a blocked Claude Code request can be answered from outside the terminal and that the same session continues. Slack comes later.
- **Options:**
  1. Build the relay and Slack integration now.
  2. A daemon with an embedded SQLite store, with `bridgegap approve <code>` / `deny <code>` standing in for a channel.
  3. A `command` hook that runs `curl`.
- **Chosen:** 2.
- **Details:**
  - The hook is Claude Code's `http` hook type posting to `127.0.0.1` only. It is authenticated with a bearer token passed through `allowedEnvVars`.
  - The verdict endpoint needs a separate admin token.
  - Storage is Node's built-in `node:sqlite`; TypeScript runs through Node's built-in type stripping.
  - The only dependencies are dev dependencies: `typescript` and `@types/node`.
- **Why:**
  - It tests the riskiest part first: does Claude wait on the hook and accept the verdict (A-001, A-008)?
  - An HTTP hook avoids spawning a process for every request and avoids quoting problems in Windows shells.
  - Zero runtime dependencies keeps the supply-chain surface at zero (A-009 resolved on Windows).
- **Clarification of the CONSTRAINTS rule against inbound ports:** that rule means network-reachable ports. A port bound to the loopback address (`127.0.0.1`) is required by the HTTP hook design and is allowed.
- **Failure mode:** the hook keeps Claude Code's default `onFailure: continue`. If the daemon is down, Claude shows its normal local prompt; it never auto-allows (D-005).
- **Trade-off:**
  - `node:sqlite` is still marked experimental in Node 22, so its API may change.
  - Any local process that can read `~/.bridgegap/config.json` can approve requests (see THREAT).
- **Revisit if:** Stage 2 adds the relay. At that point the daemon stops being the place verdicts come from, and only signed verdicts from the relay are accepted.

## D-014: The daemon talks to the relay over HTTP long-polling, not WebSocket
Date: 2026-10-23. Model: claude-opus-5-5.

- **Context:** the daemon must send requests to the relay and receive verdicts, connecting outbound only (D-009).
- **Options:**
  1. A WebSocket.
  2. Server-sent events.
  3. HTTP long-polling: `POST /v1/requests`, and `GET /v1/verdicts?after=<cursor>` held open for up to 25 s.
- **Chosen:** 3.
- **Why:**
  - Node has no built-in WebSocket *server*, so long-polling keeps zero runtime dependencies.
  - A pull with a cursor redelivers anything missed during a disconnect for free (D-003, T-2).
  - Plain HTTPS gets through corporate proxies.
- **Trade-off:** one extra request roughly every 25 s per idle daemon; this is not built for thousands of daemons.
- **Revisit if:** the hosted relay serves many daemons (move to SSE or WebSocket).

## D-015: Slack uses Socket Mode with Node's built-in WebSocket client and raw Web API calls
Date: 2026-10-23. Model: claude-opus-5-5.

- **Options:**
  1. Bolt with HTTP events and request signing.
  2. Bolt with Socket Mode.
  3. Socket Mode built by hand on the global `WebSocket` and `fetch`.
- **Chosen:** 3.
- **Why:**
  - Socket Mode needs no public URL, so a self-hosted relay works behind NAT.
  - Slack authenticates the socket with the app-level token, so interaction payloads (and the `user.id` used for D-010) arrive over an authenticated channel, with no request signatures to check.
  - The protocol is small: open a connection, acknowledge each envelope, reconnect on disconnect. Bolt would be our first runtime dependency.
- **Trade-off:**
  - We own the reconnect and acknowledgement logic.
  - Socket Mode apps can't be listed in the Slack Marketplace.
- **Revisit if:** we build the hosted multi-tenant relay. It moves to HTTP events plus signing-secret verification (the original plan's design).

## D-016: The relay signs verdicts with Ed25519, and the daemon pins the relay's public key at pairing
Date: 2026-10-23. Model: claude-opus-5-5.

- **Context:** a verdict lets code run on the developer's machine, so the daemon must not accept one from anyone except its relay.
- **Options:**
  1. Trust the TLS connection only.
  2. HMAC with a shared secret.
  3. Ed25519 signatures with a pinned public key.
- **Chosen:** 3.
- **Details:**
  - `bridgegap-relay pair` prints a single pairing code containing the relay URL, the daemon token and the public key.
  - `bridgegap pair <code>` stores it.
  - The daemon drops any verdict whose signature fails or whose request is not pending locally.
- **Why:**
  - It protects against a man-in-the-middle on a plain-HTTP or misconfigured relay URL, and against a stolen daemon token: that token can submit requests but cannot produce verdicts.
  - With HMAC, every daemon would hold the signing secret.
- **Trade-off:** no key rotation or revocation yet. A fully compromised relay can still sign verdicts; policy tiers and quorum are the planned mitigation.
- **Revisit if:** there are multiple relays, or key rotation is needed.

## D-017: The local CLI approver stays valid alongside Slack, and the first answer wins
Date: 2026-10-23. Model: claude-opus-5-5.

- **Options:**
  1. Disable the CLI once a relay is paired.
  2. Keep it.
- **Chosen:** 2.
- **Why:** the person at the keyboard already has the same power through Claude's own prompt, and the CLI is the fallback when Slack or the relay is down.
- **Details:**
  - A CLI answer is reported to the relay, so the Slack message is updated and its buttons are disabled.
  - Deny reasons are CLI-only for now; a Slack deny sends a generic message (a modal is later).
- **Trade-off:** in Stage 1 a local process that can read `~/.bridgegap/config.json` can approve, and that is still true (THREAT.md).
- **Revisit if:** organizational policy requires every approval to be attributed to a remote approver.

## D-018: Detect terminal approvals through PostToolUse / PostToolUseFailure hooks, matched on session, tool and input
Date: 2026-10-23. Model: claude-opus-5-5.

- **Context:** A-001 testing found an asymmetry in the interactive TUI.
  - A terminal **No** drops the hook connection, so we see it.
  - A terminal **Yes** runs the tool but leaves our hook request open, so BridgeGap still treats the request as pending and the Slack buttons stay live for the whole hold. A late click is ignored by Claude but was logged as a Slack ALLOW, which makes the audit misleading (A-013).
- **Captured payloads:** real payloads from Claude Code 2.1.300.
  - `PermissionRequest` has `session_id`, `tool_name` and `tool_input`, but **no `tool_use_id`**.
  - `PostToolUse` (on success) and `PostToolUseFailure` (on error) carry the same `session_id` and `tool_name` and an identical `tool_input`, plus a `tool_use_id`.
- **Options:**
  1. Wait for the hold to expire.
  2. Watch the transcript file.
  3. Add `PostToolUse` and `PostToolUseFailure` HTTP hooks that report "tool finished" to the daemon.
- **Chosen:** 3.
  - The daemon matches a finished tool to its held request using `session_id`, `tool_name` and the SHA-256 of the canonical (key-sorted) JSON of `tool_input`. If several requests match, the oldest wins.
  - A match closes the request as answered in the terminal: the local status becomes `resolved` with no verdict row and an `answered_locally` audit event.
  - The held hook gets `{}`; Claude has already moved on and ignores it.
  - The relay is told `resolved: Answered in the terminal.`, so the Slack message is rewritten and later clicks are refused.
- **Why:**
  - It uses official hook events (D-001) with fields we observed, not guessed.
  - The match key comes from data both events share.
  - The match state only needs to live in memory, because it only matters while a hook connection is held.
- **Trade-off:**
  - The request closes only when the tool *finishes*, so a long-running command (e.g. a 5-minute test run) keeps the Slack buttons live until it ends. A click in that window is ignored by Claude (A-013), but it is still recorded as a Slack verdict. Accepted for now.
  - Two identical tool calls in one session can't be told apart; the oldest is closed first, which is harmless because both had the same input.
  - Users must re-run `hook-config`, because older settings lack the new hooks.
- **Revisit if:** Claude Code adds a `PermissionResolved`-style event or puts `tool_use_id` in PermissionRequest (then match by ID).
