#!/bin/bash
# Stop hook: displays a checklist when Claude Code completes a session.
# Runs alongside notify.sh in the Stop lifecycle event.

# Load project variables from framework.json
VARS="$CLAUDE_PROJECT_DIR/.claude/framework.json"
_var() { jq -r ".$1" "$VARS" 2>/dev/null; }
TEST_CMD=$(_var TEST_CMD)
TYPECHECK_CMD=$(_var TYPECHECK_CMD)

cat << EOF

── STOP CHECKLIST ───────────────────────────────
  [ ] progress.md updated?  (.claude/progress.md)
        → Last updated date, branch, last commit
        → Build table: mark ✅ steps done, add commit hashes
        → Next up: update to actual next step
        → Unpushed items: list any unmerged commits/PRs
  [ ] backlog.md updated? (.claude/plans/backlog.md)
  [ ] architecture-decisions.md updated?
        (if an approach was rejected or a decision made)
  [ ] Memory files updated?
        (if non-obvious project context was learned)
  [ ] All tests passing?  →  ${TEST_CMD:-check CLAUDE.md for test command}
  [ ] Types clean?        →  ${TYPECHECK_CMD:-check CLAUDE.md for typecheck command}
  [ ] Framework improvements to sync to claude-tdd-starter?
        (hooks, skills, agents, rules — see framework-boundary.md)
─────────────────────────────────────────────────

EOF
