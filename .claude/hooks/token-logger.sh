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

# ── Parse transcript ──────────────────────────────────────────────────────────
# The JSONL has one JSON object per line.  We slurp all lines into an array
# with -s, then extract:
#   • token totals (input / output / cache_read / cache_creation)
#   • per-model breakdown — separates Opus (planning subagent) from Sonnet
#   • agent_dispatches — number of Agent tool calls spawned (each = subagent)
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
IN=$(echo "$STATS"    | jq '.total_input')
OUT=$(echo "$STATS"   | jq '.total_output')
CACHE=$(echo "$STATS" | jq '.cache_read')
AGENTS=$(echo "$STATS" | jq '.agent_dispatches')
CACHE_PCT=$(echo "$STATS" | jq 'if .total_input > 0 then (.cache_read / .total_input * 100 | round) else 0 end')

echo "Tokens → in: ${IN}  out: ${OUT}  cache_hit: ${CACHE_PCT}% (${CACHE} tokens saved)  agents: ${AGENTS}  phase: ${PHASE}"
