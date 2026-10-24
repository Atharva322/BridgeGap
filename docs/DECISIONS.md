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

## D-012 (open): stack
Options:
- A TypeScript or Go daemon.
- Postgres or SQLite.
- A hosted or self-hosted relay first.

To be decided before the spike.
