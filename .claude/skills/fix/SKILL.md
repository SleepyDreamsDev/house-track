---
name: fix
description: >
  Lightweight bug fix path. Locate → scope check → fix → verify → commit.
  No Gherkin spec, no RED phase, no PR by default. Escalates to /feature
  if 4+ files or interface changes are needed. Use when the user says
  "fix", "bug", "broken", "wrong", or runs /fix.
command: /fix
argument-hint: "[--pr] <bug description>"
allowed-tools: Read, Glob, Grep, Write, Edit, MultiEdit, Bash, TodoWrite
---

# Lightweight Bug Fix

You will fix a bug using the minimum necessary process.
Do not run the full /feature TDD cycle. Follow every phase in order.

The bug to fix: $ARGUMENTS

---

## PHASE 0 — PREPARE

### Step 0: Parse flags

- If `$ARGUMENTS` contains `--pr` → set `CREATE_PR = true`, remove from description
- Default: `CREATE_PR = false`

### Step 1: Read lessons

Read `.claude/lessons.md` if it exists.
Apply any lessons relevant to the affected domain before touching code.

---

## PHASE 1 — LOCATE

1. Identify the most likely file(s) from the bug description.
2. Grep for the relevant symbol, string, or function name.
3. Read the affected file(s) — understand the existing code before changing anything.
4. Identify the root cause (not just the symptom).

Output one line:

> ── FIX LOCATE ✓ ── root cause: \<one sentence>

---

## PHASE 2 — SCOPE CHECK

Count the files that need changing and check for interface impact.

**Escalate to `/feature` if ANY of these are true:**

- 4 or more files need changes across different domains
- A shared type in the types file needs changing
- The fix requires new user-visible behavior (not restoring broken behavior)
- A new component or page is needed

If escalating, output:

> ── ESCALATING TO /feature ── reason: \<why>
> Then stop and invoke `/feature` with the full description.

**Otherwise proceed.** Output:

> ── FIX SCOPE ✓ ── \<N> file(s), no interface changes

---

## PHASE 3 — FIX

1. Make the minimal change that corrects the root cause.
2. Do not refactor surrounding code, rename variables, or improve formatting
   on lines unrelated to the fix.
3. If the bug has no existing test coverage for this specific case,
   write **one** targeted test in the nearest `__tests__/` directory.
   - Use the same `describe`/`it`/AAA pattern as existing tests.
   - One `it()` block only — not a full spec.
4. If a test already covers this case and was passing incorrectly,
   fix the implementation — never weaken a correct test.

Output:

> ── FIX APPLIED ✓ ── \<N> line(s) changed in \<file(s)>

---

## PHASE 4 — VERIFY

Run these checks. Both must pass before committing.

```bash
# Type check — use TYPECHECK_CMD from .claude/framework.json
<TYPECHECK_CMD>

# Scoped test run — use TEST_CMD from .claude/framework.json
<TEST_CMD> <test-file-path>
```

If type-check fails: fix the type error — do not suppress with `any` or `@ts-ignore`.
If tests fail: re-read the root cause analysis. Fix the implementation, not the test.
If stuck after 3 attempts on the same failure: escalate to `/feature`.

Output:

> ── FIX VERIFY ✓ ── types clean, tests passing

---

## PHASE 5 — COMMIT

Stage only the files changed by this fix:

```bash
git add <specific files only>
```

Commit message format (conventional commits):

```
fix(<scope>): <description of what was broken and is now correct>
```

Keep the description factual: what was wrong, what is now correct.
Do not describe the change mechanically ("changed X to Y") — describe the
behavior ("button label now matches translation key").

```bash
git commit -m "fix(<scope>): <message>"
```

If `CREATE_PR = true`, also run:

```bash
git push -u origin HEAD
gh pr create --title "fix(<scope>): <message>" --body "$(cat <<'EOF'
## What was broken
<one sentence>

## Root cause
<one sentence>

## Fix
<one sentence>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Output:

> ── FIX COMMITTED ✓ ── \<short hash> fix(\<scope>): \<message>

---

## PHASE 6 — LESSONS (conditional)

If you encountered something non-obvious during this fix — a gotcha,
an incorrect assumption, a surprising interaction — append it to
`.claude/lessons.md` using the standard format:

```markdown
### [YYYY-MM-DD] Scope: Short title

**Context**: What was happening
**Wrong**: What was done incorrectly
**Correct**: What should be done instead
**Why**: The reasoning
```

If nothing surprising happened, skip this phase silently.

---

## Completion summary

```
── FIX COMPLETE ──────────────────────────────────
  Bug: <one-line description>
  Root cause: <one sentence>
  Files: <list>
  Commit: <hash> <message>
  Test added: yes / no
  Lessons appended: yes / no
──────────────────────────────────────────────────
```
