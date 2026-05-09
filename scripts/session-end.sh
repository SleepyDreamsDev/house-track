#!/usr/bin/env bash
# Tear down a Claude Code session worktree.
#
# Usage: ./scripts/session-end.sh <slug>
#
# Refuses to remove a worktree with uncommitted changes unless --force is
# passed. Optionally deletes the branch if it's already merged into main.
# See docs/parallel-sessions.md.

set -euo pipefail

FORCE=0
SLUG=""
DELETE_BRANCH=1

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --keep-branch) DELETE_BRANCH=0 ;;
    -*) echo "Unknown flag: $arg" >&2; exit 1 ;;
    *) SLUG="$arg" ;;
  esac
done

if [ -z "$SLUG" ]; then
  echo "Usage: $0 [--force] [--keep-branch] <slug>"
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
PARENT_DIR="$(dirname "$REPO_ROOT")"
WORKTREE_DIR="$PARENT_DIR/$(basename "$REPO_ROOT").session-$SLUG"

if [ ! -d "$WORKTREE_DIR" ]; then
  echo "✗ Worktree not found: $WORKTREE_DIR" >&2
  exit 2
fi

# Check for uncommitted changes
DIRTY=$(git -C "$WORKTREE_DIR" status --porcelain)
if [ -n "$DIRTY" ] && [ "$FORCE" -eq 0 ]; then
  echo "✗ Worktree $WORKTREE_DIR has uncommitted changes:" >&2
  echo "$DIRTY" | sed 's/^/    /' >&2
  echo "  Refusing to remove. Commit/stash, or pass --force." >&2
  exit 3
fi

# Find the branch this worktree is on
BRANCH=$(git -C "$WORKTREE_DIR" symbolic-ref --short HEAD 2>/dev/null || echo "")

if [ "$FORCE" -eq 1 ]; then
  git worktree remove --force "$WORKTREE_DIR"
else
  git worktree remove "$WORKTREE_DIR"
fi

echo "✓ Worktree removed: $WORKTREE_DIR"

# Optionally delete the branch if it's merged
if [ -n "$BRANCH" ] && [ "$DELETE_BRANCH" -eq 1 ]; then
  if git branch --merged main 2>/dev/null | grep -qE "^\s+${BRANCH}$"; then
    git branch -d "$BRANCH"
    echo "✓ Branch $BRANCH deleted (was merged into main)."
  else
    echo "ℹ Branch $BRANCH retained (not merged into main yet). Delete with: git branch -D $BRANCH"
  fi
fi
