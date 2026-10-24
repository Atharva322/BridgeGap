# ROLLBACK

Status: template. Fill in once there are deployable components.

- **Last known good commit/tag:** none yet (repo initialized; there is no commit yet).
- **Kill switch:** uninstalling the BridgeGap hook (removing it from `.claude/settings.json`) instantly returns Claude Code to its native local prompts. Keep the uninstall to one command.
- **Feature flags:** put each channel and each adapter behind a flag, so one can be switched off without a deploy.
- **Data changes:** every broker migration needs a down step or a backup taken before it runs.
- **After a rollback, re-check:** T-1 and T-8 from TESTING.md.
