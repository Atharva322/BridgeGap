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

**Manual customer path:** install, pair Slack, run a real Claude Code task, and approve one request from a phone away from the desk.
