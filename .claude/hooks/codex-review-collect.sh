#!/bin/bash
# Stop hook: queue a non-blocking Codex review of the previous Claude turn.
#
# Pairs with `stopReviewGate: false` in the codex workspace state — the codex
# plugin's blocking Stop gate short-circuits, and this hook enqueues a
# background review job instead. Inspect outcomes via /codex:status.
#
# Always exits 0. Never blocks the Stop event.

set -uo pipefail

INPUT="$(cat)"

CODEX_DIR=$(ls -d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts 2>/dev/null | sort -V | tail -1)
if [ -z "${CODEX_DIR:-}" ] || [ ! -f "$CODEX_DIR/codex-companion.mjs" ]; then
  exit 0
fi

LAST=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // ""')
if [ -z "$LAST" ]; then
  exit 0
fi

SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // ""')

PROMPT_FILE=$(mktemp -t codex-review-XXXXXX.md)
trap 'rm -f "$PROMPT_FILE"' EXIT

{
  cat <<'HEADER'
<task>
Run a stop-gate review of the previous Claude turn.
Only review the work from the previous Claude turn.
Only review it if Claude actually did code changes in that turn.
Pure status, setup, or reporting output does not count as reviewable work.
If the previous turn was only status/setup/reporting, return ALLOW immediately.
Challenge whether that specific work and its design choices should ship.

Previous Claude response:
HEADER
  printf '%s\n' "$LAST"
  cat <<'FOOTER'
</task>

<compact_output_contract>
Return a compact final answer.
Your first line must be exactly one of:
- ALLOW: <short reason>
- BLOCK: <short reason>
</compact_output_contract>
FOOTER
} >"$PROMPT_FILE"

CLAUDE_PLUGIN_DATA="$HOME/.claude/plugins/data/codex-openai-codex" \
CODEX_SESSION_ID="$SESSION_ID" \
  node "$CODEX_DIR/codex-companion.mjs" task --background --prompt-file "$PROMPT_FILE" \
  >/dev/null 2>&1 || true

exit 0
