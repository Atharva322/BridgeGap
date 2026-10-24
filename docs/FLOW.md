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

## Stage 2 as built (relay + Slack)
1. The hook arrives at the daemon exactly as in Stage 1, steps 1–3. Before forwarding, the daemon registers the waiter, so an instant verdict still has somewhere to land.
2. `RelayClient.submit()` (`packages/daemon/src/relay-client.ts`) sends `POST /v1/requests` to the relay with the daemon token. The request is already redacted.
3. The relay server (`packages/relay/src/server.ts`) calls `Broker.submit()` (`packages/relay/src/broker.ts`), which stores the request idempotently (`RelayStore.insertRequest`) and emits `created`.
4. `SlackChannel.notify()` (`packages/relay/src/slack.ts`) sends `chat.postMessage` to each approver's user ID and saves the message references (`messages` table).
5. A click reaches `runSocketMode()` as an `interactive` envelope. It is acknowledged immediately, then `SlackChannel.handleInteraction()` checks that `user.id` is in the approver list (D-010) and calls `Broker.decide()`.
6. `Broker.decide()` builds the verdict and signs it with Ed25519. `insertVerdict` stores it (first wins, gets the next `seq`). Long-pollers are woken and `finished` is emitted, which rewrites the Slack messages.
7. The daemon's `RelayClient.run()` long-poll (`GET /v1/verdicts?after=<seq>`) receives the verdict and verifies its signature against the pinned key (D-016). `acceptRelayVerdict()` then calls `Store.applyVerdict()` (first wins locally too) and wakes the waiter.
8. The hook replies with the decision, as in Stage 1.

**Terminal Yes (D-018):** Claude keeps the hook open after a terminal Yes.
1. When the tool finishes, the `PostToolUse` (or `PostToolUseFailure`) hook sends `POST /hooks/tool-finished`.
2. `handleToolFinished()` computes `toolCallKey(session, tool, input)` and finds the oldest held waiter with that key.
3. That waiter is finished with `answered_locally`: the local status becomes `resolved` (audit `answered_locally`), the held hook gets `{}`, and the relay gets `resolved: Answered in the terminal.`

**Local endings:** a CLI answer, an expiry or an abandoned request makes the daemon call `RelayClient.close()`, which sends `POST /v1/requests/close`. The relay then runs `Broker.close()` and rewrites the Slack message, so later clicks get "no longer waiting". The relay's own `expireDue()` sweep, every 5 s, covers daemons that disappeared.

## Target path (Stage 3+)

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
