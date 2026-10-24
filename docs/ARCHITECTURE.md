# ARCHITECTURE

Status: a proposed design. Nothing is built yet.

```
 Developer machine                         |  BridgeGap relay (hosted or self-hosted)         | Outside
                                           |                                                  |
 agent ──► adapter ──► local daemon ──outbound WS──► broker (durable queue) ──► policy/router ──► channels ──► human
 (Claude  (hooks/SDK/  (bridged)           |         requests, verdicts,         rules, tiers,    Slack, SMS,
  Code,   app-server/                      |         audit log                   escalation,      email, push
  Codex,  ACP)                             |                                     quorum
  ...)                                     |                                                  |
   ▲                                       |                                                  |
   └──── verdict (request_id, signed) ◄────┴──────────────────────────────────── signed callback ◄─┘
```

## Modules and what they own

| Module | Owns | Must not |
|---|---|---|
| **Adapters** (one per agent) | Turning an agent's blocked event into a BridgeGap request, and a verdict back into the agent's native response | Run commands; contact channels directly |
| **Local daemon** | The outbound connection; requests still pending on this machine; checking verdict signatures; falling back to the local prompt | Accept inbound connections; expose a shell or files (D-008, D-009) |
| **Broker** | Durable storage of requests and verdicts; first-valid-verdict-wins; delivering verdicts again after reconnects (D-003) | Decide policy |
| **Policy/router** | Risk tier, recipients, escalation ladder, timeout default (D-005), quorum | Talk to agents |
| **Channels** | Rendering a request, checking provider signatures, mapping the sender to an approver identity (D-010) | Trust room membership; put secrets in previews |
| **Audit log** | Who decided what, when, through which channel, and the signature | Be editable |

## Trust boundaries (where outside input enters)
1. **Agent → adapter.** Tool input may be shaped by prompt injection, so treat it as untrusted content.
2. **Channel providers → relay.** Slack, Twilio and email callbacks need signature checks and identity checks.
3. **Relay → daemon.** The daemon checks each verdict's signature and that its `request_id` matches a request still pending on this machine.
4. **Approver.** May be tired or spoofed. Show context and a risk tier, and require quorum for the "never" tier.

## Agent adapters

| Agent | Primary path | Fallback |
|---|---|---|
| Claude Code | Blocking `PermissionRequest` HTTP hook | Channels permission relay; `defer` + `--resume` for headless runs |
| Codex | `codex app-server` (JSON-RPC) | (Codex hooks, unverified) |
| Cursor (Phase 2) | `beforeShellExecution` / `beforeMCPExecution` hooks | `stop` → `followup_message` |
| Gemini, OpenCode, Copilot (Phase 2) | ACP proxy on `session/request_permission` | none |
| Custom agents (Phase 2) | BridgeGap SDK `ask()` / `require_approval` | MCP elicitation |

Deeper detail: [DECISIONS.md](DECISIONS.md), [FLOW.md](FLOW.md), [THREAT.md](THREAT.md).
