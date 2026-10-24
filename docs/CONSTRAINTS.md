# CONSTRAINTS

These are hard rules. Stop and ask before breaking any of them.

## Never
- Never add a remote shell, file read/write, or arbitrary command execution path (D-008).
- Never open an inbound port on the developer's machine (D-009).
- Never auto-allow on timeout unless a policy explicitly opts in, and never for the "never" tier (D-005).
- Never accept a verdict without checking the provider's signature and the individual approver's identity (D-010).
- Never accept a parsed email reply as an approval; email approvals must use signed one-time links (D-007).
- Never put secrets, tokens or full file contents in channel previews; redact them.
- Never use terminal or keystroke injection for an agent that has a structured API (D-001).
- Never commit secrets or `.env` files. Secrets go in gitignored env files.

## Always
- Always correlate by `request_id`, and resolve each request at most once (D-003, D-004).
- Always write every verdict to the audit log.
- Always pin dependency versions and log them in DEPENDENCIES.md.

## Protected areas
These need a reviewed DECISIONS.md entry before they change:
- verdict signing and verification
- approver identity mapping
- policy defaults
- channel signature checks
