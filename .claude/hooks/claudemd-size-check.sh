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

# ── Trial-completion guard ────────────────────────────────────────────────────
# If a KPI trial is in progress (kpi-targets.md present) and kpi-results.md has
# fewer non-header data rows than the configured trial budget, warn the user.
# Prevents the cycle-1 failure mode where a trial was archived after row 1.
TARGETS="$PROJECT_DIR/.claude/logs/kpi-targets.md"
RESULTS="$PROJECT_DIR/.claude/logs/kpi-results.md"
if [ -f "$TARGETS" ] && [ -f "$RESULTS" ]; then
  # Trial budget = first integer following "Trial length:" or "trial budget" in
  # kpi-targets.md. Falls back to 5 if not found.
  BUDGET=$(grep -ioE "trial length: *\*\*[0-9]+ *sessions?\*\*|trial budget[^0-9]*[0-9]+" "$TARGETS" 2>/dev/null \
    | grep -oE '[0-9]+' | head -1 || true)
  BUDGET="${BUDGET:-5}"

  # Data rows = lines starting with "| 20" (date column) in kpi-results.md.
  ROWS=$(grep -cE '^\| 20[0-9]{2}-' "$RESULTS" 2>/dev/null || echo 0)

  if [ "$ROWS" -lt "$BUDGET" ]; then
    REMAINING=$((BUDGET - ROWS))
    echo "ℹ KPI trial in progress: ${ROWS}/${BUDGET} rows in .claude/logs/kpi-results.md (${REMAINING} remaining). Run the per-session capture block from kpi-targets.md after this session, or close the trial with the verdict block." >&2
  fi
fi

exit 0
