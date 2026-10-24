# FLOW

## Stage 1 as built (local only, the CLI stands in for a channel)
1. Claude Code's PermissionRequest `http` hook sends `POST 127.0.0.1:47600/hooks/permission-request`, handled in `packages/daemon/src/server.ts`:
   - `tokenMatches()` checks the hook token.
   - `readJson()` reads the body; non-JSON is rejected with 415.
2. `Store.createRequest()` (`packages/daemon/src/store.ts`) creates the ULID and a 5-letter reply code. The preview comes from `buildPreview()` (`packages/protocol/src/index.ts`), which also redacts secrets. An audit row is written.
3. The handler holds the HTTP response open in `waiters`, keyed by `requestId`.
4. `bridgegap approve <code>` (`packages/daemon/src/cli.ts`) sends `POST /verdicts` with the admin token. `Store.recordVerdict()` lets the first verdict win and writes it to the audit log, then the waiter delivers the verdict.
5. The handler replies with `hookSpecificOutput.decision`, and Claude Code continues the same session.

The other endings:
- **Hold expired:** the request is marked `expired` and the reply is `{}`, so Claude shows its own dialog (D-005).
- **Claude hangs up:** `res.on('close')` marks the request `abandoned`.
- **Daemon restart:** `abandonOrphans()` closes requests left over from the previous run.

## Target path (Stage 2+)

Status: the intended path. Update this once code exists, naming the real files and functions for each step.

## Claude Code permission request (Phase 1 path)
1. Claude Code wants to run a tool that needs approval, so the PermissionRequest hook fires. Claude Code sends an HTTP POST to the local daemon with `session_id`, `tool_name`, `tool_input` and `cwd`.
2. The daemon checks the local policy cache. If the request is safe-tier, it is allowed immediately.
3. Otherwise the daemon creates a ULID `request_id`, saves the request locally, and sends it to the broker over the outbound WebSocket.
4. The broker saves the request, and the policy engine picks the tier, the approvers and the escalation ladder.
5. The request goes to its first channel, for example a Slack DM with Allow and Deny buttons and a redacted preview.
6. The approver clicks a button. Slack calls back; the relay checks Slack's signature and maps the Slack user to a BridgeGap approver.
7. The broker records the verdict. The first valid verdict wins, and it is written to the audit log and signed.
8. The broker sends the verdict to the daemon. If the daemon is disconnected, it pulls the verdict on reconnect.
9. The daemon checks the signature and that the request is still pending, then answers the held hook request with `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`.
10. Claude Code continues in the same session.

**Timeout path:** no verdict by the deadline means the next channel on the ladder, then the policy default. With no policy, the request is denied or handed back to the local prompt (D-005).
