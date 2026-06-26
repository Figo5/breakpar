#!/usr/bin/env bash
#
# Watch the repo and auto commit + push every change to origin/main.
#
#   ./scripts/autopush.sh
#
# Debounces rapid saves (waits for a quiet period) so you get one tidy
# commit per burst of edits instead of dozens. Respects .gitignore.
#
# Requires fswatch:  brew install fswatch
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH="$(git branch --show-current)"
DEBOUNCE=3   # seconds of quiet before committing

if ! command -v fswatch >/dev/null 2>&1; then
  echo "fswatch not found. Install it with: brew install fswatch" >&2
  exit 1
fi

echo "Auto-push watching $(pwd) -> origin/$BRANCH (Ctrl-C to stop)"

sync() {
  # Nothing staged/unstaged? skip.
  if [ -z "$(git status --porcelain)" ]; then return; fi
  git add -A
  git commit -m "chore: auto-sync $(date -u '+%Y-%m-%d %H:%M:%S UTC')" >/dev/null
  git push origin "$BRANCH" >/dev/null 2>&1 && echo "pushed @ $(date -u '+%H:%M:%S UTC')"
}

# Coalesce events: each fswatch hit resets a timer; commit once it's quiet.
fswatch -o \
  --exclude '\.git/' \
  --exclude 'node_modules/' \
  --exclude '\.next/' \
  --exclude 'out/' \
  --exclude '\.vercel/' \
  . | while read -r _; do
    # drain any queued events for DEBOUNCE seconds of quiet
    while read -t "$DEBOUNCE" -r _; do :; done
    sync
  done
