# Slack setup (Stage 2)

This takes about five minutes. Keep the tokens in `.env`. Never paste them into chats or commit them.

## 1. Create the Slack app
1. Go to https://api.slack.com/apps and choose **Create New App**, then **From a manifest**, then pick your workspace.
2. Paste in [`slack-app-manifest.yml`](../slack-app-manifest.yml) and click **Create**.
3. Under **Basic Information → App-Level Tokens**, click **Generate Token and Scopes**:
   - name it `socket`;
   - add the scope `connections:write`;
   - generate it, and copy the `xapp-…` token into `SLACK_APP_TOKEN`.
4. Under **Install App**, click **Install to Workspace**. Copy the **Bot User OAuth Token** (`xoxb-…`) into `SLACK_BOT_TOKEN`.
5. Get your member ID: in Slack, open your profile → **⋯** → **Copy member ID** (it looks like `U012AB3CD`). Put it in `BRIDGEGAP_SLACK_APPROVERS`. Separate several IDs with commas.

## 2. Run it
```
cp .env.example .env               # then fill in the three values
npm run relay -- run               # should log: slack channel on ... / SLACK connected (Socket Mode)
npm run relay -- pair              # prints a pairing code
npm run bridgegap -- pair <code>   # trust this relay
npm run bridgegap -- daemon        # should log: RELAY connected to http://127.0.0.1:47700
npm run bridgegap -- hook-config   # merge the hook into Claude Code settings; set BRIDGEGAP_HOOK_TOKEN
```
Next, start `claude` and ask it to do something that needs permission. You should get a DM from BridgeGap with **Allow** and **Deny** buttons. After you click, the message is rewritten to show the outcome and Claude continues.

## Notes
- **Who can approve.** Only the user IDs in `BRIDGEGAP_SLACK_APPROVERS` (D-010). If anyone else clicks, they get an "ignored" notice and the click is written to the audit log.
- **Answering locally still works.** `npm run bridgegap -- approve <code>` or Claude's own prompt both count, and the first answer wins (D-017).
- **Denying from Slack.** A Slack deny tells Claude "Denied by … via BridgeGap." To give a reason, use `bridgegap deny <code> <reason>`.
- **Where the relay runs.** It listens on `127.0.0.1` by default. To run it on another machine, put TLS in front of it and set `BRIDGEGAP_RELAY_PUBLIC_URL` before you run `pair`.
