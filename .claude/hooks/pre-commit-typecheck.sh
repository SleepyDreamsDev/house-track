#!/usr/bin/env bash
# Block git commit if TypeScript has errors. Applies to ALL commits
# (humans + agents). Exits non-zero to abort the Bash tool call.
#
# Self-filters: only runs when the Bash command contains "git commit".
# Claude Code passes the tool input as JSON to stdin.
set -e

# Load project variables from framework.json
VARS="$(git rev-parse --show-toplevel 2>/dev/null || echo "$CLAUDE_PROJECT_DIR")/.claude/framework.json"
_var() { jq -r ".$1" "$VARS" 2>/dev/null; }

INPUT=$(cat /dev/stdin 2>/dev/null || true)
echo "$INPUT" | grep -q '"git commit' || exit 0

cd "$(git rev-parse --show-toplevel)"
$(_var TYPECHECK_CMD)
