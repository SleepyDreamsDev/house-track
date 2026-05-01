#!/usr/bin/env bash
# claudemd-size-check.sh — SessionStart hook that warns if the project root
# CLAUDE.md has drifted back to bloat. Runs in <50ms; emits one banner line
# only when over budget.
#
# Budget: ≤ 120 lines AND ≤ 4 KB. See .claude/rules/token-discipline.md.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
FILE="$PROJECT_DIR/CLAUDE.md"

[ -f "$FILE" ] || exit 0

LINES=$(wc -l < "$FILE" | tr -d ' ')
BYTES=$(wc -c < "$FILE" | tr -d ' ')

if [ "$LINES" -gt 120 ] || [ "$BYTES" -gt 4096 ]; then
  echo "⚠ CLAUDE.md is ${LINES} lines / ${BYTES} bytes (budget: 120 lines / 4096 bytes). See .claude/rules/token-discipline.md." >&2
fi

exit 0
