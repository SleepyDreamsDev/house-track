#!/bin/bash
# style-audit.sh — Informational hook: catches inline style anti-patterns
# Runs after Edit/MultiEdit/Write on .tsx files
# Always exits 0 — warnings only, never blocks edits

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only audit TSX/JSX files
case "$FILE_PATH" in
  *.tsx|*.jsx) ;;
  *) exit 0 ;;
esac

[ -f "$FILE_PATH" ] || exit 0

WARNINGS=0

# 1. Hardcoded hex colors (double-quoted)
HEX=$(grep -En -e '"#[0-9a-fA-F]{3,8}"' "$FILE_PATH" 2>/dev/null | head -5)
# Also check single-quoted hex
if [ -z "$HEX" ]; then
  HEX=$(grep -En -e "'#[0-9a-fA-F]{3,8}'" "$FILE_PATH" 2>/dev/null | head -5)
fi
if [ -n "$HEX" ]; then
  printf "⚠ style-audit [%s]: hardcoded hex color — use CSS var(--color-*) or Tailwind token\n" "$(basename "$FILE_PATH")" >&2
  printf "%s\n" "$HEX" >&2
  WARNINGS=$((WARNINGS + 1))
fi

# 2. fontFamily in inline styles (should use var(--font-display/body/mono))
FF=$(grep -En -e "fontFamily" "$FILE_PATH" 2>/dev/null | head -3)
if [ -n "$FF" ]; then
  printf "⚠ style-audit [%s]: fontFamily in inline style — use var(--font-display), var(--font-body), or var(--font-mono)\n" "$(basename "$FILE_PATH")" >&2
  printf "%s\n" "$FF" >&2
  WARNINGS=$((WARNINGS + 1))
fi

# 3. Hardcoded px spacing in inline styles (prefer Tailwind p-*/m-* utilities)
SPACING=$(grep -En -e "(padding|margin)(Top|Bottom|Left|Right)?:[[:space:]]*['\"][0-9]+px['\"]" "$FILE_PATH" 2>/dev/null | head -3)
if [ -n "$SPACING" ]; then
  printf "⚠ style-audit [%s]: hardcoded px spacing in inline style — prefer Tailwind utilities (p-*, m-*)\n" "$(basename "$FILE_PATH")" >&2
  printf "%s\n" "$SPACING" >&2
  WARNINGS=$((WARNINGS + 1))
fi

exit 0
