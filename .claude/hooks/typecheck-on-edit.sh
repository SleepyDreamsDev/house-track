#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Load project variables from framework.json
VARS="$CLAUDE_PROJECT_DIR/.claude/framework.json"
_var() { jq -r ".$1" "$VARS" 2>/dev/null; }

# Only trigger on TypeScript files
case "$FILE_PATH" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

# Skip test files — during RED phase they intentionally import non-existent
# implementations, so tsc always errors. Vitest handles test type checking.
case "$FILE_PATH" in
  */__tests__/* | *.test.ts | *.test.tsx) exit 0 ;;
esac

# Run type check — command comes from framework.json
$(_var TYPECHECK_CMD_RAW) 2>&1
# Don't block on type errors — let Claude see them and fix

exit 0
