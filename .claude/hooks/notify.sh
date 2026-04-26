#!/bin/bash
INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.message // "Claude needs your attention"')

# macOS
if command -v osascript &>/dev/null; then
  osascript -e "display notification \"$MESSAGE\" with title \"Claude Code\""
# Linux
elif command -v notify-send &>/dev/null; then
  notify-send "Claude Code" "$MESSAGE"
# Windows (WSL)
elif command -v powershell.exe &>/dev/null; then
  powershell.exe -Command "[System.Windows.MessageBox]::Show('$MESSAGE', 'Claude Code')" &>/dev/null
fi

exit 0
