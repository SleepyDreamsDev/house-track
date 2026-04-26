#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Load project variables from framework.json
VARS="$CLAUDE_PROJECT_DIR/.claude/framework.json"
_var() { jq -r ".$1" "$VARS" 2>/dev/null; }

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Skip auto-generated directories
case "$FILE_PATH" in
  */api/generated/*|*/generated/*|*/__generated__/*|**/build/**)
    exit 0
    ;;
esac

# Only format files that the formatter can handle
# Extensions and command come from framework.json (set at project init).
case "$FILE_PATH" in
  $(_var FORMAT_EXTENSIONS_CASE))
    $(_var FORMAT_CMD) "$FILE_PATH" 2>/dev/null
    ;;
esac

exit 0
