# FAILURE

How each dependency can fail and what BridgeGap does about it. The design rule is that a failure blocks remote answers but never blocks the agent: it falls back to the local prompt or denies (D-005).

| Dependency | Failure | Behaviour | How we notice |
|---|---|---|---|
| Slack | Outage or slow API | Escalate to the next channel on the ladder (SMS) | Delivery errors, latency alerts |
| Twilio | Delayed or undelivered SMS | Escalate to email; the timeout default applies | Twilio status callbacks |
| Relay or broker | Down | The daemon falls back to the local prompt; pending requests are replayed on reconnect (D-003) | Daemon reports it is offline; health checks |
| Local daemon | Crashes while waiting | The broker keeps the request; an interactive agent sees the hook fail (exact behaviour: ASSUMPTIONS A-001) | Missing heartbeat |
| Agent process | Dies while waiting | The verdict is stored but cannot be applied; only headless Claude (`--resume`) or SDK agents can continue | Session-end hook; heartbeat |
| Claude hook timeout | Default 600 s reached | Falls back to the local prompt or denies | Hook result logged |
| Duplicate verdicts | Two approvers answer | The first valid verdict wins; the rest are acknowledged as "already resolved" | Audit log |
| Clock skew | Verdicts expire early or late | Expiry is decided by the broker's clock, not the client's | Skew metric |

**First limits to expect:**
- the hook timeout window
- Slack and Twilio rate limits
- per-approver short-code collisions at high volume
