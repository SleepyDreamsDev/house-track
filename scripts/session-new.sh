#!/usr/bin/env bash
# Create a new Claude Code session in an isolated git worktree.
#
# Usage: ./scripts/session-new.sh <slug>
#
# Creates ../house-track.session-<slug> with a new branch
# `feature/<slug>` (or `fix/<slug>` if slug starts with "fix-").
# See docs/parallel-sessions.md for rationale.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <slug>"
  echo "Example: $0 worktree-cleanup"
  echo "         $0 fix-cron-jitter"
  exit 1
fi

SLUG="$1"
REPO_ROOT="$(git rev-parse --show-toplevel)"
PARENT_DIR="$(dirname "$REPO_ROOT")"
WORKTREE_DIR="$PARENT_DIR/$(basename "$REPO_ROOT").session-$SLUG"

# Branch prefix follows existing convention (CLAUDE.md):
#   "Branches: feature/<slug> or fix/<slug>"
if [[ "$SLUG" == fix-* ]]; then
  BRANCH="fix/${SLUG#fix-}"
else
  BRANCH="feature/$SLUG"
fi

if [ -d "$WORKTREE_DIR" ]; then
  echo "✗ $WORKTREE_DIR already exists. Pick a different slug or remove the existing worktree first." >&2
  exit 2
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "✗ Branch $BRANCH already exists locally. Use a different slug or check it out manually." >&2
  exit 3
fi

# Always branch off origin/main, not local main, to avoid inheriting any
# unpushed local commits the parent checkout might have.
git fetch origin main
git worktree add "$WORKTREE_DIR" -b "$BRANCH" origin/main

echo
echo "✓ Worktree ready: $WORKTREE_DIR"
echo "✓ Branch:         $BRANCH (off origin/main)"
echo
echo "Next steps:"
echo "  cd \"$WORKTREE_DIR\""
echo "  pnpm install   # node_modules is per-worktree"
echo "  claude         # start the new session here"
