# Joshua's Claude Code mods

Mods that load in every Claude Code session: the terminal, the desktop app's Code tab, and cloud sessions.

| Mod | What it shows |
| --- | --- |
| repo-sentry | Business, repo, branch, behind or ahead of origin, dirty count. Warns on work sitting on main, a stale repo, or a staged secret. |
| progress-pulse | A live gradient progress band for the session's task list, a cheer on every finished task, `/progress` for the full view, `/progress demo` to see it run. |
| usage-meter | The 5-hour and weekly plan limits with reset times, context fill and session cost, right above the message box. `/usage-meter` hides or shows it. |

## How they load

- Mac: `setup-mac.js` (run once) installs every mod as a Claude Code plugin read straight from this folder, and adds a session-start hook that runs `sync-mods.js --quiet`. A mod added to the marketplace installs itself at the next session start; an edit to a mod takes effect at the next session start or `/reload-plugins`.
- Cloud: `cloud-setup.sh` goes into each cloud environment's setup script. Every new container clones this repo and runs `sync-mods.js`.

## Adding a mod

Put it in its own folder with `.claude-plugin/plugin.json`, add it to `.claude-plugin/marketplace.json`, check it with `claude plugin validate <folder>` and `claude plugin test <folder>`, commit and push.

## Other tools here

`mcp-diagnose.js`, `mcp-where.js`, `move-mcp-to-repo.js`, `mcp-set-secret.js`, `mcp-env-from-dotenv.js`: MCP server helpers that never print secret values. `servicetrade-mcp/`: the read-only ServiceTrade MCP server.
