#!/bin/bash
# Opens one small PR per repo adding the MOD COMMANDS rule to CLAUDE.md. Works from a temporary
# worktree on the default branch, so whatever branch each repo is on, and its uncommitted files,
# are left alone. Branch: claude/mods-slash-command-rule. Merging stays with Joshua.
set -u
RULE="$HOME/claude-mods/claude-md-rule.md"
for repo in "$HOME/apek-hub" "$HOME/df-correspondence" "$HOME/jpg"; do
  echo "== $(basename "$repo")"
  base=$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||'); base=${base:-main}
  git -C "$repo" fetch -q origin "$base" || { echo "fetch failed, skipped"; continue; }
  wt="$(mktemp -d)/wt"
  git -C "$repo" worktree add -q -b claude/mods-slash-command-rule "$wt" "origin/$base" || { echo "branch exists or worktree failed, skipped"; continue; }
  node "$HOME/claude-mods/insert-rule.js" "$wt/CLAUDE.md" "$RULE"
  if git -C "$wt" diff --quiet; then echo "no change needed"; else
    git -C "$wt" commit -qam "CLAUDE.md: an unknown slash command is not a build request; mod commands come from claude-mods" \
      && git -C "$wt" push -q -u origin claude/mods-slash-command-rule \
      && (cd "$wt" && gh pr create --base "$base" --title "CLAUDE.md: unknown slash commands are not build requests" \
           --body "Adds one paragraph. /progress and /usage-meter come from jgilb17/claude-mods; when they are missing, a session says so and stops instead of building something. Prompted by 8 Oct, when a test of /usage-meter in a session without the mods turned into PR #1396." )
  fi
  git -C "$repo" worktree remove --force "$wt" >/dev/null 2>&1
done
