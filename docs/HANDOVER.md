# HANDOVER

## Latest session: 2026-10-23 (model: claude-opus-5-5): Stage 1 spike

**Done:**
- D-012: TypeScript on Node 22 with SQLite. D-013: the shape of the Stage 1 spike.
- Built `packages/protocol` (ULID request IDs, reply codes, preview redaction) and `packages/daemon`:
  - a loopback HTTP hook endpoint
  - a store on `node:sqlite` with an audit log
  - a CLI: `daemon`, `pending`, `approve`, `deny`, `hook-config`
- Zero runtime dependencies.
- `npm test` passes 13/13 and `npm run typecheck` is clean.
- End-to-end tests against real Claude Code 2.1.300 in headless `-p` mode (see TESTING.md):
  - approve: the same session continued;
  - deny: Claude received the reason;
  - daemon down: Claude failed closed.
- Bug caught by a test: the redaction step leaked Bearer tokens because of the order of its patterns. Fixed.

**In progress:**
- None.

**Broken or risky:**
- A-001 is unverified. In the interactive TUI, does the terminal permission dialog show while the hook waits? If it doesn't, a user at the keyboard can't answer locally until the daemon's hold expires. This needs a manual test by a human.
- Stage 1 approval is protected only by an admin token in `~/.bridgegap/config.json`. Any process running as the same OS user can approve. This is accepted for the spike (THREAT.md).
- `node:sqlite` is still experimental in Node 22.

**Next:**
1. Manual test of A-001 in the interactive `claude` TUI (steps in TESTING.md, "Trying Stage 1 yourself").
2. Test a hold longer than 10 minutes (A-008, `BRIDGEGAP_HOOK_TIMEOUT=1800`).
3. Stage 2:
   - add `packages/relay` and an outbound WebSocket from the daemon;
   - add the Slack channel (Block Kit buttons, signature check, approver identity mapping);
   - the user creates a Slack app and puts its tokens in a gitignored `.env`.
   - Draft the D-014+ entries first.

**Do not touch:**
- The order of the patterns in `SECRET_PATTERNS`. The Bearer rule must come before the generic `authorization:` rule.
- `server.requestTimeout = 0`. Without it, Node cuts off held hooks after 5 minutes.

Read first: ARCHITECTURE.md, CONSTRAINTS.md
