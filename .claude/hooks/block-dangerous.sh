#!/bin/bash
# .claude/hooks/block-dangerous.sh
# Block dangerous bash commands before they execute
# Exit code 2 = BLOCK the command

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# --- Destructive filesystem operations ---
if echo "$COMMAND" | grep -qE 'rm\s+-rf\s+(/|~|\$HOME|\.\.|/Users)'; then
  echo "BLOCKED: Destructive rm -rf on system/parent path" >&2
  exit 2
fi

# --- Git safety ---
if echo "$COMMAND" | grep -qE 'git\s+push.*--force.*\b(main|master)\b'; then
  echo "BLOCKED: Force push to main/master" >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE 'git\s.*--upload-pack'; then
  echo "BLOCKED: git --upload-pack can execute arbitrary commands" >&2
  exit 2
fi

# --- Database safety ---
if echo "$COMMAND" | grep -qiE 'drop\s+(database|table)'; then
  echo "BLOCKED: DROP command detected" >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE 'prisma\s+migrate\s+reset'; then
  echo "BLOCKED: prisma migrate reset is destructive" >&2
  exit 2
fi

# --- Docker safety ---
if echo "$COMMAND" | grep -qE 'docker(-| )compose\s+down.*-v'; then
  echo "BLOCKED: docker compose down -v destroys volumes" >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE 'docker\s+run.*--privileged'; then
  echo "BLOCKED: Privileged docker containers can access host" >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE 'docker\s+run.*-v\s+/:/'; then
  echo "BLOCKED: Mounting host root into container" >&2
  exit 2
fi

# --- Command injection via dev tools ---
# sed 'e' flag executes pattern space as shell command
if echo "$COMMAND" | grep -qE "sed\s.*['\"].*[/|]e"; then
  echo "BLOCKED: sed with e flag can execute arbitrary commands" >&2
  exit 2
fi
# find -exec / -execdir
if echo "$COMMAND" | grep -qE 'find\s.*-exec'; then
  echo "BLOCKED: find -exec can run arbitrary commands. Use xargs or glob." >&2
  exit 2
fi

# --- Network exfiltration ---
# Block curl/wget writing to files or piping to shell
if echo "$COMMAND" | grep -qE 'curl\s.*(-o|--output|>\s)'; then
  echo "BLOCKED: curl downloading to file" >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE 'curl\s.*\|\s*(bash|sh|zsh)'; then
  echo "BLOCKED: curl piped to shell" >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE '\bwget\b'; then
  echo "BLOCKED: wget not allowed, use WebFetch" >&2
  exit 2
fi

# --- Secrets / env leakage ---
if echo "$COMMAND" | grep -qE '(cat|head|tail|less|more|echo)\s.*\.(env|env\.local|env\.production)(\s|$)'; then
  echo "BLOCKED: Direct reading of .env files. Use process.env in code." >&2
  exit 2
fi

# --- Escape to external shell via node/python ---
if echo "$COMMAND" | grep -qE "node\s.*-e\s.*child_process"; then
  echo "BLOCKED: node child_process can bypass all restrictions" >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE "python3?\s.*-c\s.*subprocess"; then
  echo "BLOCKED: python subprocess can bypass all restrictions" >&2
  exit 2
fi

exit 0
