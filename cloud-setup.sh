# Claude Code mods for cloud sessions. Paste these lines into each cloud environment's setup
# script, after the claude-guard lines. Each new container clones the latest mods and installs
# every mod listed in the marketplace, so a new mod pushed to GitHub reaches the next container.
if [ -d "$HOME/claude-mods/.git" ]; then git -C "$HOME/claude-mods" pull -q --ff-only; else git clone -q --depth 1 https://github.com/jgilb17/claude-mods.git "$HOME/claude-mods"; fi
node "$HOME/claude-mods/sync-mods.js" "$HOME/claude-mods" || echo "claude-mods: sync failed, sessions start without mods"
