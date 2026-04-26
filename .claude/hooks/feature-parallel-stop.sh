#!/usr/bin/env bash
# Finalize the in-progress JSONL entry when /feature-parallel exits.
# Detects partial entries (missing "outcome" field) and patches them
# with outcome="partial" + final duration so telemetry survives crashes.
set -e
LOG="$CLAUDE_PROJECT_DIR/.claude/logs/feature-parallel-runs.jsonl"
[ -f "$LOG" ] || exit 0
# Find last line, check if outcome is set, patch if not
tail -1 "$LOG" | jq -e '.outcome' > /dev/null 2>&1 || {
  # Patch last line with partial outcome
  LAST=$(tail -1 "$LOG" | jq '. + {outcome: "partial", finalized_at: (now | todate)}')
  sed -i '' -e '$d' "$LOG"
  echo "$LAST" >> "$LOG"
}
