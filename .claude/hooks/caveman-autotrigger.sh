#!/usr/bin/env bash
# caveman-autotrigger.sh — UserPromptSubmit hook. Fires once per session when
# the rolling output/input ratio over the last 5 assistant turns exceeds 0.30.
# Suggests switching to /caveman mode for the rest of the session.
#
# Sentinel file (per-session): .claude/logs/.caveman-active-<session_id>
# Removed automatically by SessionStart cleanup (see settings.json).
#
# Hook payload (stdin): { session_id, transcript_path, prompt, ... }
# Output (stdout): JSON with hookSpecificOutput.additionalContext when firing,
# empty otherwise.

set -euo pipefail

PAYLOAD=$(cat)
TRANSCRIPT=$(echo "$PAYLOAD" | jq -r '.transcript_path // empty')
SESSION_ID=$(echo "$PAYLOAD" | jq -r '.session_id // "unknown"')

[ -z "$TRANSCRIPT" ] && exit 0
[ ! -f "$TRANSCRIPT" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
LOG_DIR="$PROJECT_DIR/.claude/logs"
SENTINEL="$LOG_DIR/.caveman-active-${SESSION_ID}"

mkdir -p "$LOG_DIR"

# Lazy cleanup: remove sentinels older than 24h (stale from prior sessions).
find "$LOG_DIR" -maxdepth 1 -name '.caveman-active-*' -mtime +1 -delete 2>/dev/null || true

# Already fired this session — stay silent
[ -f "$SENTINEL" ] && exit 0

# Compute output/input ratio over the last 5 assistant turns. Skip if fewer
# than 5 turns (warm-up noise).
RATIO=$(jq -s '
  ( [.[] | select(.type == "assistant" and .message.usage != null)] ) as $turns |
  if ($turns | length) < 5 then "skip"
  else
    ($turns[-5:]) as $last |
    ($last | map(.message.usage.output_tokens // 0) | add // 0) as $out |
    ($last | map(
       (.message.usage.input_tokens               // 0)
     + (.message.usage.cache_read_input_tokens    // 0)
     + (.message.usage.cache_creation_input_tokens // 0)
     ) | add // 0) as $in |
    if $in == 0 then "skip" else ($out / $in) end
  end
' "$TRANSCRIPT" 2>/dev/null) || exit 0

# "skip" sentinel from jq — too few turns or zero input
[ "$RATIO" = "\"skip\"" ] && exit 0

# Threshold: 0.30. Use awk for floating-point comparison.
TRIPS=$(awk -v r="$RATIO" 'BEGIN { print (r > 0.30) ? 1 : 0 }')
[ "$TRIPS" -ne 1 ] && exit 0

# Fire — write sentinel, emit additionalContext
touch "$SENTINEL"

RATIO_FMT=$(awk -v r="$RATIO" 'BEGIN { printf "%.2f", r }')

jq -nc --arg ratio "$RATIO_FMT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: ("<system-reminder>\nThis session is output-bound (output/input = " + $ratio + " over last 5 turns, threshold 0.30). Switch to caveman mode for the remainder unless the user explicitly asks for full prose. See /caveman skill for format.\n</system-reminder>")
  }
}'
