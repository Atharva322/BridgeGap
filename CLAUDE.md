# BridgeGap

BridgeGap is a remote human-in-the-loop layer for AI coding agents. When an agent is blocked on a permission request, a question or an error, BridgeGap does three things:
1. Sends the request to the right person over Slack, SMS, email or push.
2. Routes the signed answer back to the exact agent session.
3. Lets the task resume.

Status: pre-implementation (design phase). This is a Lane B system: it decides whether agents may run commands on developers' machines, so every decision must be defensible.

## Session rules
1. **Read first:** `docs/HANDOVER.md`, `docs/CONSTRAINTS.md`, `docs/ARCHITECTURE.md`.
2. **Before a non-trivial change:** draft an entry in `docs/DECISIONS.md` and add the rejected options to `docs/ALTERNATIVES.md`. Do this before editing code.
3. **Constraints:** never break a rule in `docs/CONSTRAINTS.md` without asking first.
4. **Assumptions:** add any you make to `docs/ASSUMPTIONS.md`, marked as unverified.
5. **Dependencies:** log every new dependency in `docs/DEPENDENCIES.md`, with a reason, the maintainer and a pinned version.
6. **Scope:** one logical change per request, and one commit per accepted change.
7. **Last step:** update `docs/HANDOVER.md` with Done / In progress / Broken / Next / Do not touch.

## Key references
- Competitive research and gap analysis: `docs/research/COMPETITIVE-ANALYSIS.md`
- Documentation method: "Defend What You Ship", AI field guide v2
