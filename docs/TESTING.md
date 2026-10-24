# TESTING

Status: the Phase 1 acceptance checklist. Add the exact commands once the code exists. Paste the real test output here; don't just write "tests pass".

| # | Scenario | Pass looks like |
|---|---|---|
| T-1 | Happy path: `claude` with the BridgeGap hook triggers a Bash approval; approve it in Slack | The same `session_id` continues, and the audit row exists |
| T-2 | Disconnect: kill the daemon mid-wait, approve, restart the daemon | The verdict is delivered exactly once |
| T-3 | Escalation: ignore Slack | SMS arrives at T+5 min; the default deny applies at T+30 |
| T-4 | Forged Slack or Twilio signature | Rejected (401); no verdict recorded |
| T-5 | Someone in the same Slack channel who is not an authorized approver clicks Allow | Rejected; the request stays pending |
| T-6 | Replay an old verdict | Rejected as already resolved or expired |
| T-7 | Codex through app-server | Same result as T-1 |
| T-8 | Relay down | Falls back to the local prompt; the agent is not blocked |

## Commands
- `npm test`: unit and HTTP tests (node:test).
  - Pass looks like `# tests 13`, `# pass 13`, `# fail 0`.
- `npm run typecheck`: pass looks like no output and exit code 0.

## Stage 1 results (2026-10-23, Claude Code 2.1.300, Node 22.20.0, Windows 11)
- `npm test`: 13/13 pass; `npm run typecheck`: clean.
- **T-1 (local, headless):** `claude -p` with the hook settings was asked to run `echo bridgegap-ok > proof.txt`.
  - The daemon logged `PENDING zgkzq Bash: echo bridgegap-ok > proof.txt (session da0d930d)`.
  - `bridgegap approve zgkzq` gave `ALLOW zgkzq by athar`.
  - `proof.txt` = `bridgegap-ok`; the Claude result was `DONE`, `session_id` was unchanged (`da0d930d-…`), and there were 0 permission denials.
- **Deny path:** `bridgegap deny huykm use the staging bucket instead`.
  - Claude received "Denied by athar via BridgeGap: use the staging bucket instead".
  - The file was not created.
- **Daemon-down path (T-8 local equivalent):** the hook connection failed, which is non-blocking.
  - Claude's own permission check denied the command, and the file was not created.
  - It failed closed with no auto-allow (D-005).
- **Not yet tested:** the interactive TUI (A-001), and holds longer than 10 minutes (A-008).

## Stage 2 results (2026-10-23)
`npm test`: 26/26 pass, run twice; `npm run typecheck`: clean.

New tests in `packages/relay/test/relay.test.ts`:
- **T-1 (Stage 2):** the full chain over real HTTP. A daemon hook goes to the relay; a Slack Allow click (fake Slack API) produces a signed verdict; the daemon long-poll receives it and the hook returns `allow`. The audit log shows `slack:U0APPROVER (atharva) via slack`.
- **T-2:** a verdict issued while no daemon is polling is delivered from the cursor exactly once.
- **T-5:** a click from a non-approver is rejected, the clicker gets an ephemeral notice, and it is audited as `verdict_rejected`.
- **D-016:** a daemon pinned to the wrong relay key logs `REJECTED … bad signature`, the hold expires, and the hook returns `{}` (local prompt).
- **D-017:** a local CLI deny rewrites the Slack message to "Denied locally by athar", and later clicks get "no longer waiting".
- Slack markup injection through the preview (`<!channel>`, `<@U…>`) is escaped.
- The relay API has no route that lets a daemon token create a verdict.

**Process smoke test:** real `relay run` and `daemon` processes on a scratch home.
- Pairing works, and the daemon logs `RELAY connected`.
- A hook request reached the relay already redacted (`Bash: rm -rf build [redacted]`).
- The CLI deny returned the reason to the hook, and the relay recorded `resolved: Denied locally by athar.`

**Live Slack test (2026-10-23), with real Claude Code 2.1.300 `-p` and a real Slack workspace:**
- The relay logged `SLACK connected (Socket Mode)`; the daemon logged `RELAY connected`.
- Claude was asked to run `echo approved-from-slack > slack-proof.txt`:
  - the daemon logged `PENDING smrtu … (session 59b76847)`;
  - the relay logged `SLACK sent smrtu to 1 approver(s)`.
- The approver clicked **Allow** in the Slack DM. The daemon logged `ALLOW smrtu by slack:U0CBN9Y0RA9 (atharvarane.bui) via slack`, after the signature was verified.
- Claude finished in the same session `59b76847-c5c2-4d8c-8575-f42690e11591` with `DONE` and 0 denials, and `slack-proof.txt` = `approved-from-slack`.
- The relay database shows `smrtu resolved / allow / slack:U0CBN9Y0RA9`, with 1 Slack message recorded and no `chat.update` errors.

**Interactive TUI test (A-001), 2026-10-23.** Real `claude --permission-mode default` in PowerShell, with the hook in the project's `.claude/settings.local.json`:

| Request | Answered via | Daemon log | Result |
|---|---|---|---|
| `oaepv` `rm tui-test.txt` | Slack Allow | `ALLOW … via slack` | File deleted; the terminal prompt closed by itself |
| `xzrcp` `echo second > tui-test2.txt` | Terminal Yes | stayed `PENDING`; hook connection kept open | File created; Slack buttons stayed live. A late Slack Allow was ignored by Claude (mtime unchanged) but logged as `ALLOW` (**gap, D-018**) |
| `gvaix` `echo third > tui-test3.txt` | Terminal No | `GONE` (abandoned) | File **not** created; relay `abandoned`; Slack message updated; later clicks refused |

**D-018 test (terminal Yes closes the request), 2026-10-23, Claude Code 2.1.310:**
- `npm test`: 29/29 pass, run twice; `npm run typecheck`: clean.
- Real hook payloads were captured first: PermissionRequest has no `tool_use_id`, while PostToolUse and PostToolUseFailure repeat the same `session_id`, `tool_name` and `tool_input`.
- **Live daemon probe:** a simulated PermissionRequest then PostToolUse produced `PENDING stiey`, then `LOCAL stiey answered in the terminal`. The relay recorded `resolved: Answered in the terminal.`
- **Live interactive TUI:** `rmdir d018-check` produced `PENDING xdnvy`, a Slack DM, and a terminal **Yes**. The daemon logged `LOCAL xdnvy answered in the terminal` (audit: `request_created`, `answered_locally`). The relay recorded `resolved: Answered in the terminal.` with **0 Slack verdicts**, and the folder was removed.
- **Finding (A-014):** the first two retries never reached BridgeGap, because the session was in **auto** permission mode (`permissionMode: "auto"` in the transcript). Claude's own check approved `mkdir` and `rm` without a prompt or a hook call. After switching modes with Shift+Tab, the request came through.

**Not tested yet:**
- A second real Slack user clicking (non-approver rejection, live).
- Slack's connection-rotation reconnect.

## Trying Stage 1 yourself
1. `npm install`
2. `npm run bridgegap -- daemon` (leave it running).
3. `npm run bridgegap -- hook-config`. Merge the printed block into your project's `.claude/settings.local.json`, then set `BRIDGEGAP_HOOK_TOKEN` in the shell you start Claude from.
4. Start `claude`, then ask it to do something that needs permission.
5. In another terminal, run `npm run bridgegap -- pending`, then `npm run bridgegap -- approve <code>` (or `deny <code> <reason>`).

**Manual customer path:** install, pair Slack, run a real Claude Code task, and approve one request from a phone away from the desk.
