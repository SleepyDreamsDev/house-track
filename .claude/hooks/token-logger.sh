#!/usr/bin/env bash
# token-logger.sh — Stop hook that parses the session JSONL transcript and
# appends a structured usage entry to .claude/logs/token-usage.jsonl.
#
# Hook payload (stdin): { session_id, transcript_path, cwd, ... }
# Zero tokens consumed — runs entirely outside Claude's context window.

set -euo pipefail

PAYLOAD=$(cat)
TRANSCRIPT=$(echo "$PAYLOAD" | jq -r '.transcript_path // empty')
SESSION_ID=$(echo "$PAYLOAD" | jq -r '.session_id // "unknown"')

# Nothing to log if transcript is missing
[ -z "$TRANSCRIPT" ] && exit 0
[ ! -f "$TRANSCRIPT" ]  && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

# Last phase checkpoint written by /feature skill
CHECKPOINT="$PROJECT_DIR/.claude/plans/.checkpoint"
PHASE=$([ -f "$CHECKPOINT" ] && cat "$CHECKPOINT" || echo "unknown")

LOG_DIR="$PROJECT_DIR/.claude/logs"
mkdir -p "$LOG_DIR"

# Cache breakpoint minimum (Opus is the strict superset; below this no cache
# entry is written and any "cache hit %" reading is meaningless).
CACHE_BREAKPOINT=2048

# ── Parse transcript ──────────────────────────────────────────────────────────
STATS=$(jq -sc '
  ( [.[] | select(.type == "assistant" and .message.usage != null)] ) as $turns |
  {
    total_input:      ( $turns | map(.message.usage.input_tokens               // 0) | add // 0 ),
    total_output:     ( $turns | map(.message.usage.output_tokens              // 0) | add // 0 ),
    cache_read:       ( $turns | map(.message.usage.cache_read_input_tokens    // 0) | add // 0 ),
    cache_creation:   ( $turns | map(.message.usage.cache_creation_input_tokens // 0) | add // 0 ),
    turns:            ( $turns | length ),

    by_model: (
      $turns | group_by(.message.model) | map({
        model:      ( .[0].message.model // "unknown" ),
        input:      ( map(.message.usage.input_tokens               // 0) | add // 0 ),
        output:     ( map(.message.usage.output_tokens              // 0) | add // 0 ),
        cache_read: ( map(.message.usage.cache_read_input_tokens    // 0) | add // 0 ),
        turns:      length
      })
    ),

    agent_dispatches: (
      [ .[] | select(.type == "assistant") |
        ( .message.content? // [] ) | .[] |
        select( type == "object" and .type == "tool_use" and .name == "Agent" )
      ] | length
    ),

    # Real cache "breaks" (prefix invalidations) typically create 10k+ new
    # tokens in a single turn — edits to CLAUDE.md/progress.md, tool-set
    # churn, or model switches. Below 10k is mostly natural prefix extension
    # from tool results + system reminders, which Claude Code re-snapshots
    # every turn by design. Threshold tuned from the 2026-05-02 session.
    # Also dedupe consecutive identical creations: when the same tool result
    # gets re-snapshotted on the next turn, the same `cache_creation` value
    # repeats — only the first turn in a run is a distinct event.
    cache_breaks: (
      ($turns | to_entries
        | map({
            turn:    (.key + 1),
            idx:     .key,
            created: (.value.message.usage.cache_creation_input_tokens // 0)
          })
        | map(select(.idx >= 3 and .created >= 10000))
        | . as $hits
        | [ range(0; $hits | length) as $i |
            $hits[$i] | . + { keep: ($i == 0
              or $hits[$i].created != $hits[$i - 1].created
              or $hits[$i].turn   != $hits[$i - 1].turn + 1) }
          ]
        | map(select(.keep) | { turn, created })
      )
    )
  }
' "$TRANSCRIPT") || {
  # jq parse failure (e.g. partial write mid-session) — exit cleanly
  exit 0
}

# ── Append log entry ──────────────────────────────────────────────────────────
jq -nc \
  --arg  ts      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg  session "$SESSION_ID" \
  --arg  phase   "$PHASE" \
  --argjson stats "$STATS" \
  '{ timestamp: $ts, session_id: $session, final_phase: $phase } + $stats' \
  >> "$LOG_DIR/token-usage.jsonl"

# ── Human-readable status line ────────────────────────────────────────────────
IN=$(echo       "$STATS" | jq '.total_input')
OUT=$(echo      "$STATS" | jq '.total_output')
CACHE_R=$(echo  "$STATS" | jq '.cache_read')
CACHE_C=$(echo  "$STATS" | jq '.cache_creation')
AGENTS=$(echo   "$STATS" | jq '.agent_dispatches')
TOTAL_CACHE=$((CACHE_R + CACHE_C))

CACHE_PCT=$(echo "$STATS" | jq '
  if (.cache_read + .cache_creation) > 0
    then (.cache_read / (.cache_read + .cache_creation) * 100 | round)
    else 0
  end')

echo "Tokens → in: ${IN}  out: ${OUT}  cache_read: ${CACHE_R}  cache_creation: ${CACHE_C}  cache_hit: ${CACHE_PCT}%  agents: ${AGENTS}  phase: ${PHASE}"

# ── Warnings (only when above the cache breakpoint minimum) ───────────────────
if [ "$TOTAL_CACHE" -gt "$CACHE_BREAKPOINT" ]; then
  if [ "$CACHE_PCT" -lt 70 ]; then
    echo "⚠ cache hit ratio ${CACHE_PCT}% < 70% — likely cause: edited static context (CLAUDE.md/progress.md), tool-set churn, or model switch."
  fi

  # Per-turn cache-break detector
  BREAKS=$(echo "$STATS" | jq -r '.cache_breaks | length')
  if [ "$BREAKS" -gt 0 ]; then
    echo "$STATS" | jq -r '.cache_breaks[] |
      "⚠ cache break at turn \(.turn) (created \(.created) new cache tokens). Likely cause: edited CLAUDE.md/progress.md, switched model, or tool set changed."'
  fi
fi
