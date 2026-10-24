# ALTERNATIVES

The options we rejected for each major decision, what each would have cost us, and when we would reconsider. Each section is linked to its entry in DECISIONS.md.

| Decision | Rejected option | Why rejected / cost | Revisit if |
|---|---|---|---|
| D-001 integration | Wrap a PTY or tmux and scrape the screen | Breaks whenever the agent's interface changes (Omnara's lesson). Answers race with screen redraws and land in the wrong prompt (Code Light #95, #96). | Kept only as a labelled best-effort path for agents with no API, such as Aider |
| D-001 | Fork the agents | Means maintaining forks of closed or fast-moving codebases | Never |
| D-002 Claude Code path | Channels first | Research preview; needs an organization allowlist or a dev flag; ignored under `-p` and the SDK | Channels reaches general availability with third-party distribution |
| D-002 | Agent SDK only | Only works for sessions BridgeGap launches itself; misses interactive terminal users | Custom-agent SDK users |
| D-003 storage | In-memory relay | Loses approvals during disconnects (Happy #1035, #1208) | Never |
| D-003 | Temporal or Inngest | Too heavy to operate, and too much infrastructure for an MVP | Multi-step approval workflows |
| D-004 correlation | Session token or room ID | Too coarse: one reply can match the wrong prompt | Never |
| D-005 timeout | Auto-allow | Fails open; a security risk | Explicit opt-in per policy for the safe tier only |
| D-005 | Wait forever | Sessions freeze silently (Happy, Pocket) | Never |
| D-006 channels | Native mobile app first | Costly to build; Happy already owns this niche | Users need end-to-end encryption or lock-screen approvals (Phase 3) |
| D-006 | Telegram or Discord first | Weaker team identity; already covered by Anthropic Channels | Demand from the community |
| D-007 email | Parse a "yes" reply | Easy to spoof | Never for high-risk tiers |
| D-008 scope | Full remote shell or file access | Huge attack surface (Pocket's public tunnel, Code Light's `bash` remote call) | A separate, opt-in product |
| D-009 connectivity | Inbound tunnel | Exposes the machine; quick-tunnel URLs change on every restart | Never |
| D-009 | LAN only | No reach outside the home network; no push | A self-hosted, air-gapped mode |
| D-012 stack | Go daemon with a TypeScript relay | Two languages; the shared schema needs code generation | Daemon size or distribution becomes a complaint |
| D-012 | Go everywhere | Slack and MCP SDKs for Go are community-maintained; the Channels plugin needs MCP | Never for the relay |
| D-012 | Python | Harder to package and distribute; the Agent SDK's `canUseTool` needs a workaround in Python | A Python SDK for custom agents (Phase 2) |
| D-013 spike | Build the relay and Slack integration now | Delays answering the riskiest question (does the hook round-trip work?); needs Slack credentials first | Stage 2 |
| D-013 | A `command` hook that calls `curl` | Spawns a process per request; quoting problems in Windows shells | The HTTP hook type is unavailable on an older Claude Code |
| D-013 | `better-sqlite3` | Native build step, plus a third-party dependency | `node:sqlite` API changes break us |
| D-010 auth | Anyone in the room can approve | Anyone in the channel can approve tool use | Never |
