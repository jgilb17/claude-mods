# Claude Code mods for cloud sessions. Paste these lines into each cloud environment's setup
# script, after the claude-guard lines. Each new container clones the latest mods and installs
# every mod listed in the marketplace. What happened is written to ~/claude-mods-setup.log
# (download) and ~/claude-mods-sync.log (install), so a session can explain missing mods.
{ date; if [ -d "$HOME/claude-mods/.git" ]; then git -C "$HOME/claude-mods" pull -q --ff-only; else git clone -q --depth 1 https://github.com/jgilb17/claude-mods.git "$HOME/claude-mods"; fi && echo "download ok"; } >> "$HOME/claude-mods-setup.log" 2>&1 || echo "claude-mods: download failed, see ~/claude-mods-setup.log"
node "$HOME/claude-mods/sync-mods.js" "$HOME/claude-mods" >> "$HOME/claude-mods-setup.log" 2>&1 || echo "claude-mods: sync failed, see ~/claude-mods-setup.log"
