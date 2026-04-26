#!/usr/bin/env bash
# Print the last 3 /feature-parallel runs at session start (informational).
LOG="$CLAUDE_PROJECT_DIR/.claude/logs/feature-parallel-runs.jsonl"
[ -f "$LOG" ] || exit 0
echo "── Last /feature-parallel runs ──"
tail -3 "$LOG" | jq -r '"\(.timestamp) [\(.mode // "unknown")] \(.outcome // "in-progress") — \(.feature)"'
