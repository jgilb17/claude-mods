#!/bin/bash
# Usage: tarwip.sh <repo> <out.tgz>
# Archives a repo's modified and untracked files that still exist on disk, without
# .env files, keys, build output or node_modules. Read-only on the repo.
cd "$1" || exit 1
git ls-files -m -o --exclude-standard -z \
  | while IFS= read -r -d "" f; do [ -e "$f" ] && printf "%s\0" "$f"; done \
  | grep -zvE "(^|/)(\.env[^/]*|dist|\.netlify|node_modules)(/|$)|\.(pem|key)$" \
  | tar -czf "$2" --null -T -
