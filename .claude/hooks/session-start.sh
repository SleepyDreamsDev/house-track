#!/bin/bash
# SessionStart hook: injects current project progress into Claude's context.
# Fires on session startup, resume, and after /clear.
# Update .claude/progress.md at the end of each session to keep this fresh.

PROGRESS="$CLAUDE_PROJECT_DIR/.claude/progress.md"

# Load project variables from framework.json
VARS="$CLAUDE_PROJECT_DIR/.claude/framework.json"
_var() { jq -r ".$1" "$VARS" 2>/dev/null; }
PROJECT_NAME=$(_var PROJECT_NAME)
# Pad project name to fill the 38-char banner field
PAD=$(printf '%*s' $((38 - ${#PROJECT_NAME})) '')

if [ -f "$PROGRESS" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  SESSION CONTEXT — ${PROJECT_NAME}${PAD}║"
  echo "╚══════════════════════════════════════════════════════╝"
  cat "$PROGRESS"
  echo "══════════════════════════════════════════════════════════"
  echo ""
fi
