# THREAT

BridgeGap decides whether an agent may run actions on a developer's machine. If an attacker can forge or steal an approval, that becomes remote code execution by approval.

| Actor / entry point | Worst realistic abuse | Mitigation | Known gap |
|---|---|---|---|
| Forged Slack, Twilio or email callback | Approve a dangerous tool call | Signature checks (Slack signing secret, `X-Twilio-Signature`); signed one-time email links (D-007) | None if checks are enforced |
| Malicious member of a Slack channel | Approve someone else's request | Per-user approver identity, not room membership (D-010) | Needs correct identity mapping at onboarding |
| SIM swap or compromised mailbox | Answer SMS or email approvals | SMS and email are not allowed for high-risk tiers; those require Slack, the app, or quorum | Low tiers remain exposed |
| Compromised or breached relay | Inject verdicts; read request content | The daemon checks verdict signatures; requests are decisions only (D-008); app and push payloads are end-to-end encrypted | Content on Slack, SMS and email is visible to those providers |
| Prompt injection into the agent | Get the agent to request something harmful that a tired approver allows | Risk tiers from the policy; quorum and no default allow for the "never" tier; show the full command, cwd and diff | Approver judgment |
| Replayed verdict | Approve a later request | `request_id` is single-use; verdicts expire; the daemon checks the request is still pending | None |
| Approver fatigue (blind allows) | Rubber-stamping | Auto-handle the "safe" tier so humans see fewer prompts; show context; rate-limit prompts | Human factor |
| Malicious or compromised dependency | Supply-chain compromise | Pinned versions, DEPENDENCIES.md, few libraries | Ongoing |
| Local process on the developer's machine | Approve through the daemon's loopback endpoint | Stage 1: bind to `127.0.0.1`; separate hook and admin bearer tokens compared in constant time; config file is mode 0600 (no effect on Windows). Stage 2: the daemon accepts only signed verdicts from the relay | Stage 1: any process running as the same OS user can read the admin token |
| Website in the developer's browser | Send cross-site requests to `127.0.0.1` | Bearer token required on every endpoint; JSON-only bodies; no CORS headers | None known |
