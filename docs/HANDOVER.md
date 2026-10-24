# HANDOVER

## Latest session: 2026-10-23 (model: claude-opus-5-5)

**Done:**
- Competitive research covering:
  - Happy, Pocket Agent and Code Light (both candidates), at code level.
  - Omnara, HumanLayer and Claude-Code-Remote.
  - First-party features from Anthropic, OpenAI, Cursor, Copilot and Devin.
  - Agent integration surfaces.
- Verdict: BridgeGap is viable as a cross-vendor, multi-channel, policy- and team-aware approval layer. It is not viable as "Claude Code on your phone", which is already commoditized.
- Created the docs scaffold (Defend What You Ship v2 layout). Drafted decisions D-001 to D-012.

**In progress:**
- Nothing.

**Broken or risky:**
- None. (`git init` done 2026-10-23 on branch `main`, with a `.gitignore` covering `.env*`, `*.db`, `node_modules`; nothing committed yet.)
- Anthropic Channels could absorb the Claude-only case. Lead with multi-vendor support and team policy.

**Next:**
1. (Done: initial commit `cf8974e`.)
2. (Done: D-012 is TypeScript on Node 22 with SQLite. Local environment: Node 22.20.0, npm 10.9.3, Claude Code 2.1.300; pnpm is not installed, so we use npm workspaces.)
3. Write the protocol spec: request and verdict schemas, broker API, channel interface.
4. Spike: Claude Code PermissionRequest HTTP hook → broker → Slack button → verdict → the same session resumes.
5. Verify the unverified items in `ASSUMPTIONS.md`, starting with A-001.

**Do not touch:**
- No code exists yet.

Read first: ARCHITECTURE.md, CONSTRAINTS.md
