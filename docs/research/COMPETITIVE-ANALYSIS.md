# BridgeGap competitive analysis

Research date: 2026-10-23 (model: claude-opus-5-5). Sources include GitHub repos and issues, vendor docs, and HN, read via subagents. Items marked unverified are tracked in ../ASSUMPTIONS.md.

## 1. Verdict
Yes, but only with a narrower positioning than "remote control for Claude Code".

Three things are now crowded or commoditized:
- **Claude Code on a phone:** Anthropic's Remote Control and the Channels permission relay do this natively. Channels works with request IDs, allow/deny and first-answer-wins.
- **Codex:** Codex has a mobile approval feature, reported May 2026.
- **Remote control apps:** Happy has 24k stars.

BridgeGap's defensible value is the part that no first-party feature or open-source project offers:
1. **Approvals across vendors.** One inbox and one policy for Claude Code, Codex, Cursor, Gemini, OpenCode and custom agents built on the SDK, LangGraph or MCP.
2. **Reaching the human by escalation.** Slack DM, then SMS, then email, then a default action, with timeouts. Every competitor has exactly one channel, and none escalates.
3. **Durable approvals that survive disconnects.** A server-side queue with idempotent request IDs. Happy loses approvals when the WebSocket drops (#1035, #1208), and Code Light drops messages when the process dies.
4. **Team and policy routing.** Route requests by risk tier, repo or code owner, on-call engineer, or a two-person approval rule, and keep an audit log. All competitors are single-user.
5. **A minimal attack surface.** BridgeGap relays decisions only, never a shell. Pocket Agent exposes a public tunnel to a full shell. Code Light has an unrestricted `bash` remote call, and its relay parses content despite claiming end-to-end encryption.

Lessons from the companies that left this space:
- **Omnara:** it pivoted away because wrapping the Claude Code CLI became impossible to maintain. BridgeGap must use official integration points (hooks, SDK, app-server, ACP), never PTY scraping as the primary path.
- **HumanLayer:** it built exactly this abstraction (`require_approval` with contact channels for Slack, email and SMS) and then removed it. That suggests standalone approval routing was hard to sell to individuals, so target teams and enterprises.
- **Anthropic:** its features exclude API-key, Bedrock/Vertex, LLM-gateway, zero-data-retention and HIPAA setups (Remote Control), and Bedrock/Vertex/Foundry (Channels). Those are enterprise segments BridgeGap can serve.

---

## 2. Competitor teardown (code level)

### Happy: slopus/happy
24k stars, MIT, TypeScript monorepo, active. The `happy-cli` and `happy-server` repos were archived on 14 Feb 2026 and merged into the monorepo.

**Agent integration**
- Claude in remote mode: Agent SDK `query()` with `canUseTool` (`packages/happy-cli/src/claude/sdk/query.ts`, `claudeRemote.ts`).
- Claude in local mode: a plain `claude` child process plus a SessionStart hook (`claudeLocal.ts`, `generateHookSettings.ts`). Permission prompts raised in local mode are not forwarded to the phone.
- Codex: `codex app-server` over JSON-RPC (`codexAppServerClient.ts`).
- Gemini and OpenCode: ACP (`agent/acp/acpAgentConfig.ts`).
- No Cursor support.

**Permissions** (`claude/utils/permissionHandler.ts`)
- Pending requests are Promises held in memory, keyed by `toolUseID`.
- Notification is a push, and the answer comes back through the `permission` remote call.
- Supports AskUserQuestion and plan approval.
- No timeout, default action or escalation. If the CLI dies, pending approvals are lost.

**Routing**
- Socket.IO rooms named `userId:method`, with method names prefixed by session ID (`happy-server/sources/app/api/socket/rpcHandler.ts`).
- A remote call waits about 15 seconds for its socket. Answers sent while the agent is disconnected are not queued.

**Channels**
- Expo push only (`app/push/pushDispatch.ts`), with no channel abstraction.
- Notifications are plain tap-to-open, with no Allow/Deny buttons (#1908).

**Security**
- NaCl and AES-256-GCM encryption on the client, with key exchange by QR pairing (`docs/encryption.md`). This part is solid.
- Push payloads are plaintext: session title, folder, tool name and request ID.
- No organizational key management.

**Shortcomings**
- Hosted relay outages (#1866, #1682), lost approvals, broken self-hosting (#246).
- Single-user, no audit log, no policy.
- The project is pivoting to a desktop harness (`happy-agent`).

### PocketAgent: yayasoumah/pocket-server
838 stars, Apache-2.0. Abandoned: last commit 21 Oct 2025. The iOS app is closed source.

**Agent integration**
- Its own agent, built on the Anthropic and OpenAI SDKs (`src/agent/*`), has binary approve/deny.
- Claude Code, Codex and Gemini run only as raw node-pty shells (`src/terminal/terminal-manager.ts`, "without parsing").
- No hooks, no detection that an agent is blocked, no structured answers.

**Channels**
- The iOS app with Expo push only, and only for plan progress or cloud-agent completion. It never sends a push for an approval request.

**Security**
- A `--remote` flag downloads an unpinned `cloudflared` and exposes localhost:3000 (a full shell plus file read/write) on a public `trycloudflare.com` URL.
- Authentication uses JWTs passed in the WebSocket query string. Encryption is TLS only, with no end-to-end encryption.

**Shortcomings:** none of the core capabilities are present. It is a remote terminal, not human-in-the-loop routing.

### CodeLight
The name is ambiguous, so both candidates are covered.

**Code Light (iOS) + MioIsland (Mac, 539 stars) + MioServer relay**
- Licence CC BY-NC (code not reusable commercially). The production app is paid and closed source.
- **Detection:** solid. It registers ten Claude Code and Codex hooks with `timeout: 86400` (`HookInstaller.swift`, socket `/tmp/codeisland.sock`).
- **Answers:** sent as keystrokes into cmux, with AppleScript as a fallback (`TerminalWriter.swift`). This is fragile:
  - #96: messages over about 128 bytes get stranded.
  - #95: the cmux access list breaks injection.
- **Routing:** session UUID → PID → cmux surface. It is the best session routing seen, but works only on macOS with cmux. No SSH or Linux support (#77).
- **Security:** it claims end-to-end encryption, but `MioServer/sources/socket/chatContent.ts` parses message content to build push text. `RPCExecutor.swift` exposes `bash` with no allowlist. Pairing codes are permanent.

**henrikekblad/codelight**
- 71 stars, MIT, Python, closest in design to BridgeGap.
- Uses blocking PermissionRequest and PreToolUse(AskUserQuestion) hooks (`agents/claude.py`).
- `PendingRequests` is keyed by `request_id`, the first answer wins, and the default 60-second timeout falls back to the local prompt (`remote_control.py`).
- Supports Claude Code, Codex, Copilot, Cursor (deny-only) and OpenCode.
- **Limitations:** LAN-only plaintext WebSocket (mDNS), no relay, no push, and no Slack, email or SMS.

### Others
- **Omnara:** pivoted away from remote control.
- **HumanLayer:** SDK removed; now CodeLayer.
- **JessyTsui/Claude-Code-Remote:** stale since Aug 2025. Uses email, Telegram and LINE, with answers injected through tmux or PTY paste using 8-character tokens.
- **Smaller tools:** ntfy-based hooks (public topics, no callback authentication) and Telegram bots.

### Gap matrix

| Capability | Happy | Pocket | Code Light | codelight-B | Anthropic native | **BridgeGap target** |
|---|---|---|---|---|---|---|
| Structured answers through hooks or SDK | SDK (remote mode only) | own agent only | detection only; answers as keystrokes | yes | yes (Claude only) | **yes, all agents** |
| Agents covered | Claude, Codex, ACP | via PTY | Claude, Codex | 5 | Claude | **Claude, Codex, Cursor, ACP, SDK** |
| Slack, email, SMS | none | none | none | none | Telegram, Discord, iMessage | **all, with escalation** |
| Timeout and escalation | none | none | none (24 h wait) | 60 s, then local prompt | first answer wins | **ladder + default policy** |
| Queue that survives disconnects | none | none | none | none | none | **yes** |
| Team routing and audit | none | none | none | none | none | **yes** |
| Minimal remote surface | relay only | full shell | bash remote call | LAN only | yes | **decisions only** |

---

## 3. Recommended architecture

```
agent adapters ──► local daemon (bridged) ──► relay/broker ──► policy/router ──► channels
   ▲   (hooks/SDK/app-server/ACP)  outbound-only WS   durable queue      rules, escalation   Slack/SMS/Email/Push
   └──────────── verdict (request_id, signed) ◄──────────────────────────────────────────────┘
```

### Agent adapters, by reliability

| Agent | Primary path | Notes |
|---|---|---|
| Claude Code (interactive) | Channel plugin with `claude/channel/permission` relay | The terminal dialog stays live and the first answer wins. In preview it needs an org allowlist or a dev flag. |
| Claude Code (fallback) | Blocking `PermissionRequest` HTTP hook (default 600 s, configurable) | Returns `{behavior, updatedInput}`. |
| Claude Code (headless) | Answer AskUserQuestion via `updatedInput.answers`; for long waits use PreToolUse `defer` + `claude -p --resume` | |
| Codex | `codex app-server` (JSON-RPC) | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`. |
| Cursor | `beforeShellExecution` / `beforeMCPExecution` hooks for allow/deny | `stop` → `followup_message` to inject the next instruction. Questions are not supported (deny-only for cursor-agent). |
| Gemini, OpenCode, Copilot CLI | ACP client proxy that intercepts `session/request_permission` | Copilot's `--acp` auto-approve bug (#845) is a caveat. |
| Custom agents | Python/TS SDK: `await bridge.ask(...)` / `require_approval` | Plus a LangGraph `interrupt` adapter and an MCP server using elicitation. |
| Any agent | tmux/PTY injection | Last resort only, flagged as unreliable. |

### Core design
1. **Correlation.** Every request gets a ULID `request_id` plus `session_id`, `agent`, `machine` and `cwd`. An outbound reply token is derived from it, for example a 5-character code for SMS, as Claude Channels does.
2. **Durable broker.** Requests and verdicts are stored in Postgres or SQLite. The daemon reconnects and pulls verdicts it hasn't seen. Verdicts are idempotent: the first valid one wins, and later ones are acknowledged as "already resolved". This fixes the Happy and Code Light loss bugs.
3. **Policy and router.** YAML rules over agent, repo, tool and risk tier decide auto-allow or auto-deny, the recipients, an escalation ladder (e.g. Slack at 0 min, SMS at 5 min, email at 15 min, then a default verdict at 30 min) and quorum.
4. **Channels.**
   - Slack: Block Kit buttons in Socket Mode, signature verified.
   - SMS: Twilio two-way with reply codes, `X-Twilio-Signature` validated.
   - Email: Gmail threading with signed one-time approve links rather than parsing a bare "yes", because email senders are easy to spoof.
   - Push: APNs/FCM actionable notifications. A mobile app comes later.
5. **Security.**
   - Relay decisions only, never a shell.
   - Each approver is authenticated by their own identity, not by membership of a room or channel (Anthropic's guidance).
   - Payloads are encrypted from daemon to approver client where possible.
   - Push text is redacted.
   - The daemon connects outbound only.
   - Every verdict carries a signature and goes to an audit log.
6. **Fail safe.** On timeout with no policy, deny, or fall back to the local prompt, and never auto-allow.

### MVP wedge
Phase 1 covers:
- the Claude Code hook adapter and the Codex app-server adapter;
- Slack and SMS channels;
- the durable broker, escalation ladder and audit log.

Phase 2 adds the ACP proxy, Cursor hooks, the email channel and the custom-agent SDK. Phase 3 adds the mobile app with push, team policy and SSO.

---

## 3b. Which shortcomings can be fixed

**Fully fixable.** These are design choices the competitors made, so BridgeGap can choose differently.

| Shortcoming (source) | Fix |
|---|---|
| Approvals held in memory and lost on WebSocket drop (Happy #1035, #1208); messages dropped when the process dies (Code Light) | Durable broker. The daemon pulls missed verdicts on reconnect, and each verdict is applied once (idempotent `request_id`). |
| Mobile push is the only channel; notifications can't be answered (Happy #1908) | Slack buttons, SMS reply codes, signed email links, actionable APNs/FCM pushes. |
| No timeout or escalation (all competitors) | Escalation ladder plus a default verdict that fails safe. |
| Single user, no policy, no audit trail | Policy router, quorum approvals, signed audit log. |
| Remote access far broader than answering a decision (Pocket public tunnel, Code Light bash remote call) | Relay decisions only, outbound-only daemon. |
| False end-to-end claim; plaintext push metadata | End-to-end encryption on app and push, redacted previews. |
| Keystroke injection fails (Code Light #95, #96; Claude-Code-Remote) | Use structured APIs (hooks, SDK, app-server, ACP) for every agent that has one. |
| Local-mode prompts not forwarded (Happy) | Hooks or Channels fire in interactive mode too, and the terminal dialog stays live alongside the remote one. |
| Broken self-hosting (Happy #246) | One binary with SQLite, Postgres optional. |

**Only partly fixable.** Each has a hard floor.

| Shortcoming | What stays |
|---|---|
| Relay outages (Happy #1866) | The hosted service can still go down. Mitigation: self-hosting, and falling back to the local prompt, so an outage blocks remote answers but never the agent. |
| Content privacy on Slack, SMS and email | Slack, Twilio and Google can read anything sent through them, so end-to-end encryption is impossible on those channels. Send a minimal preview plus a link to an authenticated page that shows the full request. |
| Spoofed approvals over email or SMS | Signed one-time codes and links reduce the risk, but SIM swaps and compromised mailboxes remain. High-risk tiers should require Slack or app approval. |
| Agent process dies while waiting | The broker keeps the request and verdict. An interactive Claude, Codex or Cursor session that has died cannot be resumed. Only headless Claude (`defer` + `--resume`) or SDK-hosted agents can continue. |
| Vendor API churn (the lesson from Omnara's pivot) | Official hooks and ACP churn less than PTY wrapping, but schemas still change. Needs a versioned adapter per agent and CI against new releases. |

**Not fixable by BridgeGap.** These limits come from the agents themselves.
- **Cursor:** no question hook, and `cursor-agent` is deny-only. Remote allow/deny works for shell and MCP calls, but remote answers to Cursor's questions do not. Cloud agents expose only a subset of hooks.
- **Claude Code:**
  - Trust and MCP-consent dialogs never relay.
  - `defer` works only with `-p` and a single tool call per turn.
  - Channels are ignored under `-p` and the SDK, and in preview they need an org allowlist or a dev flag.
- **Codex:** structured approvals require BridgeGap to own the `app-server` session. An already-running Codex TUI can't be attached to unless Codex hooks support it, which is unverified.
- **Agents with no API** (e.g. Aider): only keystroke injection is possible, so they get best-effort support labelled as such.
- **Market risk:** Anthropic or OpenAI adding Slack or SMS themselves is a business risk, not something engineering can remove.

**Net.** Every shortcoming caused by a competitor's design is fixable. What remains is set by each agent's API: Claude Code and SDK agents get near-full coverage, Codex gets full coverage only for sessions BridgeGap launches, and Cursor gets allow/deny only.

## 4. Risks and open questions
- **Anthropic Channels:** Anthropic could add Slack or SMS to Channels and cover the Claude-only case. Mitigation: lead with multi-vendor support and team policy.
- **Custom channel friction:** custom Claude channels need `--dangerously-load-development-channels` or an org allowlist. Keep the hook path as the default.
- **Unverified items:**
  - Slack, Twilio and Gmail reply mechanics (latency, spoofing details).
  - Cline, Aider and Amp integration points.
  - The full Codex hooks schema.
  - Which agents implement ACP permission requests correctly.
- **Low reliability:** OpenAI's mobile approvals and the Copilot Slack claims come from secondary sources.

