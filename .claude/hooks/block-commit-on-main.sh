#!/usr/bin/env bash
# PreToolUse: Bash — blocks git commit directly on main/master branch.
# Escape hatch: set CLAUDE_ALLOW_MAIN_COMMIT=1 in environment.

set -euo pipefail

# Only intercept git commit commands
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
if ! echo "$TOOL_INPUT" | grep -q '"git commit'; then
  exit 0
fi

# Allow escape hatch
if [ "${CLAUDE_ALLOW_MAIN_COMMIT:-0}" = "1" ]; then
  exit 0
fi

# Check current branch
CURRENT_BRANCH=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo '{"decision":"block","reason":"Commits directly on main are not allowed. Create a feature branch first: git checkout -b feature/<slug>. To override (emergency only): set CLAUDE_ALLOW_MAIN_COMMIT=1."}'
  exit 0
fi

exit 0
