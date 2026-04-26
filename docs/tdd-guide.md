# Claude Code: Autonomous Feature Delivery

One command. Claude drives RED → GREEN → REFACTOR → SHIP. You intervene once.

---

## The Idea

You type:

```
/feature password reset — create tokens, validate expiry, prevent email enumeration
```

Claude does everything else:
1. Reads the codebase to understand patterns
2. Writes failing tests (RED)
3. **Pauses for you to approve the test list** ← only mandatory stop
4. Implements until all tests pass (GREEN)
5. Refactors (REFACTOR)
6. Commits, creates PR, outputs checkpoint (SHIP)

Hooks handle formatting, type checking, and blocking dangerous commands on every file edit — silently, without Claude needing to think about them.

---

## File Structure

```
your-project/
├── CLAUDE.md                              ← always-loaded rules
├── .claude/
│   ├── settings.json                      ← hooks config
│   ├── hooks/
│   │   ├── format-on-write.sh
│   │   ├── typecheck-on-edit.sh
│   │   ├── block-dangerous.sh
│   │   └── notify.sh
│   └── skills/
│       └── feature/
│           └── SKILL.md                   ← the single /feature command
```

---

## 1. The Skill: /feature

Create `.claude/skills/feature/SKILL.md`:

````markdown
---
name: feature
description: >
  End-to-end TDD feature delivery. Writes tests, implements, refactors,
  commits, and creates a PR. Use when the user describes a feature to build,
  says "implement", "build", "add feature", or "feature".
command: /feature
argument-hint: "<feature description>"
allowed-tools: Read, Glob, Grep, Write, Edit, MultiEdit, Bash
---

# Feature Delivery: Autonomous TDD Cycle

You will deliver a complete feature using strict TDD. Follow every phase in
order. Do not skip phases. Do not ask for permission between phases except
where marked PAUSE.

The feature to build: $ARGUMENTS

---

## PHASE 1 — DISCOVER (silent, no output needed)

1. Read CLAUDE.md for project conventions.
2. Run `find src -name "*.test.ts" | head -5` and read one test file to learn
   the testing style, imports, utilities, and assertion patterns.
3. Identify where the new feature's source and test files should live based
   on the existing directory structure.

---

## PHASE 2 — RED: Write Failing Tests

1. Create a `.test.ts` file in the appropriate location.
2. Write 5-8 test cases covering:
   - Happy path (main behavior works)
   - Input validation (bad inputs rejected)
   - Edge cases (empty, null, boundary values)
   - Error conditions (what should fail and how)
3. Each test uses `describe`/`it` blocks, AAA pattern (Arrange, Act, Assert).
4. Import from where the implementation WILL exist. Do NOT create the
   implementation file yet.
5. Run `pnpm test <test-file>` to confirm ALL tests fail.

### PAUSE — Show the test list

Output the complete list of `it()` blocks and ask:

> "Here are the behaviors I'll implement. Review the test list.
> Reply **go** to proceed, or tell me what to add/change."

**Wait for the user to respond before continuing.**

---

## PHASE 3 — GREEN: Implement Until All Pass

1. Create the implementation file.
2. Write the SIMPLEST code that makes each test pass.
3. Run `pnpm test <test-file>`.
4. If any test fails:
   - Read the failure output
   - Fix the IMPLEMENTATION (never the tests)
   - Run tests again
5. **Keep going until ALL tests pass.** Do not stop after the first attempt.
   Do not ask for help unless stuck on the same error 3+ times.
6. When all green, continue immediately to Phase 4.

---

## PHASE 4 — REFACTOR: Improve Without Breaking

1. Run tests first to confirm baseline is green.
2. Apply these improvements one at a time:
   - Extract magic numbers/strings into named constants
   - Add input validation with Zod where appropriate
   - Improve error handling (custom error types if needed)
   - Clean up variable names and remove duplication
3. After EACH change, run `pnpm test <test-file>`.
4. If any test fails, revert that change and try differently.
5. When refactoring is complete, continue to Phase 5.

---

## PHASE 5 — SHIP: Commit, PR, Checkpoint

1. Run `pnpm test` (full suite, not just the feature).
2. Run `pnpm typecheck`.
3. If either fails, fix and re-run before proceeding.
4. Stage all changed files: `git add -A`
5. Commit with message: `feat(<scope>): <description>`
   - Derive scope from the feature area (e.g., auth, billing, notifications)
6. Push and create a PR: `gh pr create --fill`
   - If `gh` is not available, show the manual git commands instead.
7. Output a checkpoint summary:

```
## Checkpoint

### What was built
- [1-2 sentence summary]

### Files created/modified
- [list]

### Tests
- [count] tests, all passing
- Coverage: [if available]

### Assumptions (unvalidated)
- [list anything assumed but not proven]

### Next session
- [what to work on next]
```
````

---

## 2. CLAUDE.md Rules

Add this block to your CLAUDE.md:

```markdown
## TDD Workflow Rules

- NEVER write implementation and tests in the same step.
- RED: tests only. GREEN: implementation only. REFACTOR: improve only.
- If a test fails during REFACTOR, revert immediately, then try differently.
- After GREEN, always refactor before shipping. Never ship first-pass code.
- Conventional commits: feat(scope): description
- Never modify files in */generated/* or */__generated__/*

## Available Skills

- `/feature <description>` — Full TDD cycle: tests → implement → refactor → ship.
  One mandatory pause after test list. Everything else is autonomous.

## Commands

- pnpm test — run full test suite
- pnpm test <path> — run specific test file
- pnpm test:coverage — run with coverage
- pnpm typecheck — tsc --noEmit
- pnpm lint — ESLint
- pnpm build — production build
```

---

## 3. Hooks

### .claude/settings.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/block-dangerous.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/format-on-write.sh",
            "timeout": 30
          },
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/typecheck-on-edit.sh",
            "timeout": 60
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/notify.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### .claude/hooks/format-on-write.sh

```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0
case "$FILE_PATH" in */api/generated/*|*/generated/*|*/__generated__/*) exit 0 ;; esac
case "$FILE_PATH" in *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.md|*.html|*.yaml|*.yml) npx prettier --write "$FILE_PATH" 2>/dev/null ;; esac
exit 0
```

### .claude/hooks/typecheck-on-edit.sh

```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
case "$FILE_PATH" in *.ts|*.tsx) npx tsc --noEmit --pretty 2>&1; exit 0 ;; esac
exit 0
```

### .claude/hooks/block-dangerous.sh

```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
echo "$COMMAND" | grep -qE 'rm\s+-rf\s+(/|~|\$HOME|\.\.)' && echo "BLOCKED: rm -rf" >&2 && exit 2
echo "$COMMAND" | grep -qE 'git\s+push.*--force.*\b(main|master)\b' && echo "BLOCKED: force push to main" >&2 && exit 2
echo "$COMMAND" | grep -qiE 'drop\s+(database|table)' && echo "BLOCKED: DROP" >&2 && exit 2
echo "$COMMAND" | grep -qE 'prisma\s+migrate\s+reset' && echo "BLOCKED: prisma migrate reset" >&2 && exit 2
echo "$COMMAND" | grep -qE 'docker[\s-]compose\s+down\s+.*-v' && echo "BLOCKED: docker compose down -v" >&2 && exit 2
exit 0
```

### .claude/hooks/notify.sh

```bash
#!/bin/bash
INPUT=$(cat)
MSG=$(echo "$INPUT" | jq -r '.message // "Claude needs attention"')
command -v osascript &>/dev/null && osascript -e "display notification \"$MSG\" with title \"Claude Code\""
command -v notify-send &>/dev/null && notify-send "Claude Code" "$MSG"
exit 0
```

Make all executable: `chmod +x .claude/hooks/*.sh`

---

## 4. Runtime Flow

```
YOU: /feature password reset — create tokens, validate expiry, prevent enumeration
│
│   PHASE 1: Claude reads codebase silently                          [automatic]
│
│   PHASE 2: Claude writes 7 tests in password-reset.test.ts
│     → HOOK: Prettier formats                                       [automatic]
│     → HOOK: tsc checks types                                       [automatic]
│     Claude runs tests → all 7 fail ✓
│     Claude shows test list and PAUSES
│
YOU: go
│
│   PHASE 3: Claude creates password-reset.ts
│     → HOOK: Prettier + tsc on every edit                           [automatic]
│     → Claude self-corrects type errors via hook loop               [automatic]
│     Claude runs tests → 5/7 → fixes → 7/7 green ✓
│     Continues immediately...
│
│   PHASE 4: Claude refactors (constants, Zod, error types)
│     → HOOK: Prettier + tsc on every edit                           [automatic]
│     → runs tests after each change                                 [automatic]
│     → reverts if red, retries                                      [automatic]
│     All green after refactoring ✓
│     Continues immediately...
│
│   PHASE 5: Claude runs full test suite + typecheck
│     Claude commits: feat(auth): implement password reset
│     Claude creates PR via gh pr create
│     Claude outputs checkpoint summary
│     → GitHub Actions CI                                            [automatic]
│     → Claude Code PR review                                        [automatic]
│
YOU: review PR, squash-merge
```

**Your input: feature description + "go" + merge.**

---

## 5. When to Step In

| Signal | Action |
|--------|--------|
| Claude asks for help (same error 3x) | Give context: "The issue is X. Try Y." |
| Claude modifies tests during GREEN | "Do not change tests. Fix the implementation." |
| Session >30 min | "Checkpoint." Start fresh, smaller scope. |
| Tests cover wrong behavior | "Test 3 should test X instead. Fix it, then continue." |
| Claude skips REFACTOR | "Go back. Refactor before shipping." |

---

## 6. One-Time Setup

Paste into Claude Code:

```
Read this plan and execute every step:

1. mkdir -p .claude/hooks .claude/skills/feature
2. Create .claude/skills/feature/SKILL.md — the /feature skill that runs
   full TDD (RED → pause → GREEN → REFACTOR → SHIP). Use 5 phases:
   DISCOVER, RED with PAUSE for test review, GREEN with iterate-until-green,
   REFACTOR with revert-on-red, SHIP with commit + PR + checkpoint.
3. Create .claude/hooks/format-on-write.sh — Prettier on edit, skip */generated/*
4. Create .claude/hooks/typecheck-on-edit.sh — full monorepo tsc --noEmit on .ts/.tsx
5. Create .claude/hooks/block-dangerous.sh — block rm -rf, force push, DROP,
   prisma migrate reset, docker compose down -v (exit 2)
6. Create .claude/hooks/notify.sh — desktop notification (osascript or notify-send)
7. chmod +x .claude/hooks/*.sh
8. Create .claude/settings.json — PreToolUse/Bash → block-dangerous,
   PostToolUse/Edit|MultiEdit|Write → format + typecheck, Notification → notify.
   NO Stop hooks.
9. Add TDD workflow rules and /feature docs to CLAUDE.md
10. Validate JSON, show /hooks, confirm skill registered
11. git add .claude/ CLAUDE.md && git commit -m "chore(dev): add /feature skill and quality hooks"
```

---

## 7. Multiple Features Per Sprint

One feature per session. Keep sessions under 40 min.

```
Session 1: /feature password reset tokens
Session 2: /feature password reset validation
Session 3: /feature password reset email delivery
```

If a feature is too big for one session, split by bounded context.

---

## 8. Escape Hatches

| Situation | Command |
|-----------|---------|
| Full autonomous feature | `/feature <description>` |
| Just need tests written | Describe feature + "write tests only, no implementation" |
| Tests exist, need implementation | "Make all tests in <file> pass. Keep going until green." |
| Code works, needs cleanup | "Refactor <file>. Tests must stay green." |
| Ready to commit | "Commit, create PR, checkpoint summary." |
| Quick bug fix | Just describe the bug — no skill needed |
