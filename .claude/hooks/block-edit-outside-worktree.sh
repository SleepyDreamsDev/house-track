#!/usr/bin/env bash
# PreToolUse: Edit|Write|MultiEdit — blocks writes outside the current worktree.
#
# Rule (option a): if the target file_path is inside .claude/worktrees/<id>/,
# the current working directory must also be inside that same worktree root.
# Symmetric: if cwd is inside a worktree, file_path must also be inside it.

set -euo pipefail

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
WORKTREES_ROOT="$PROJECT_DIR/.claude/worktrees"

# Extract file_path from tool input JSON
FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('file_path', data.get('path', '')))
except Exception:
    print('')
" 2>/dev/null || true)

[ -z "$FILE_PATH" ] && exit 0

# Resolve to absolute path
ABS_FILE=$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd)/$(basename "$FILE_PATH") 2>/dev/null || true
[ -z "$ABS_FILE" ] && exit 0

CWD=$(pwd)

# Check if file_path is inside a worktree
FILE_IN_WORKTREE=""
if [[ "$ABS_FILE" == "$WORKTREES_ROOT"/* ]]; then
  # Extract the worktree ID (first component after WORKTREES_ROOT)
  RELATIVE="${ABS_FILE#$WORKTREES_ROOT/}"
  FILE_WORKTREE_ID="${RELATIVE%%/*}"
  FILE_IN_WORKTREE="$WORKTREES_ROOT/$FILE_WORKTREE_ID"
fi

# Check if cwd is inside a worktree
CWD_IN_WORKTREE=""
if [[ "$CWD" == "$WORKTREES_ROOT"/* ]]; then
  RELATIVE="${CWD#$WORKTREES_ROOT/}"
  CWD_WORKTREE_ID="${RELATIVE%%/*}"
  CWD_IN_WORKTREE="$WORKTREES_ROOT/$CWD_WORKTREE_ID"
fi

# Case 1: file targets a worktree, but cwd is NOT inside that same worktree
if [ -n "$FILE_IN_WORKTREE" ] && [ "$FILE_IN_WORKTREE" != "$CWD_IN_WORKTREE" ]; then
  echo "{\"decision\":\"block\",\"reason\":\"Worktree scope violation: file '$FILE_PATH' is inside worktree '$FILE_IN_WORKTREE' but cwd is '$CWD'. Agents must only write inside their assigned worktree.\"}"
  exit 0
fi

# Case 2: cwd is inside a worktree, but file targets outside it
if [ -n "$CWD_IN_WORKTREE" ] && [ -z "$FILE_IN_WORKTREE" ]; then
  echo "{\"decision\":\"block\",\"reason\":\"Worktree scope violation: agent cwd is '$CWD_IN_WORKTREE' but file '$FILE_PATH' is outside the worktree. Record needed changes as NOTEs for the orchestrator.\"}"
  exit 0
fi

exit 0
