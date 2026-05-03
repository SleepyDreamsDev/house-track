---
name: feature-parallel
description: >
  Parallel variant of /feature for multi-domain features. Dispatches
  discovery-explorer and domain-implementer agents in parallel, merges
  worktrees, then validates. Use when the feature spans 3+ independent
  layers. For simpler features, prefer /feature.
command: /feature-parallel
argument-hint: "[--careful] <feature description>"
allowed-tools: Read, Glob, Grep, Write, Edit, MultiEdit, Bash, TodoWrite, Agent, Skill
---

# Feature Delivery: Parallel Orchestrated TDD Cycle

You will deliver a complete feature using strict TDD with parallel agent dispatch.
Follow every phase in order. Do not skip phases. Do not ask for permission between
phases except where marked PAUSE.

The feature to build: $ARGUMENTS

---

## Model policy

| Role               | Model               | Why                                                   |
| ------------------ | ------------------- | ----------------------------------------------------- |
| Orchestrator (you) | Opus, max effort    | DOMAIN-SPLIT / GATE CHECK / MERGE are leverage points |
| discovery-explorer | Sonnet              | Read-and-summarize, fixed output template             |
| domain-implementer | Sonnet              | TDD against an explicit brief                         |
| reviewer (Phase 7) | Opus (pre-existing) | Security / logic review                               |

Max effort means: model `opus` + explicit reasoning cues in prompts ("think step-by-step",
"reason carefully before answering").

---

## PHASE 0 — PLAN CONTEXT (silent)

### Step 0: Determine execution mode

The default execution mode is **FAST_MODE = true** (auto-approve Gherkin, combined RED+GREEN dispatch).
Override to `FAST_MODE = false` **only when** `$ARGUMENTS` contains `--careful`.

If `$ARGUMENTS` contains `--careful`, remove it before using as the feature description.

### Step 0.5: Create feature branch

```bash
SLUG=$(echo "$ARGUMENTS" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
git checkout -b "feature/$SLUG" 2>/dev/null || git checkout "feature/$SLUG"
```

All worktree branches will fork from `feature/$SLUG`, not `main`. Never commit directly to `main`.

### Step 0.7: Model guardrail (non-blocking)

`/feature-parallel` makes three judgment calls that cascade into all parallel
work: DOMAIN-SPLIT (Phase 2b), GATE CHECK (Phase 3), and MERGE conflict
resolution (Phase 5). These benefit from Opus. If the current model is not
Opus, output a warning but **do not wait for user input**:

> ── WARNING: Running on \<model>. Opus recommended for /feature-parallel
> orchestration — DOMAIN-SPLIT and MERGE quality scales with reasoning depth. ──

Continue immediately — this is informational, not a gate.

### Step 1: Load plan context

Use the same three-level plan lookup as `/feature` (most reliable first):

```bash
# Level 1 — active pointer (set by any previous /feature run for this feature)
PLAN=$(cat .claude/plans/.active 2>/dev/null)
[ -n "$PLAN" ] && [ ! -f "$PLAN" ] && PLAN=""   # clear if file was deleted

# Level 2 — slug match (works when args are similar)
if [ -z "$PLAN" ]; then
  SLUG=$(echo "$ARGUMENTS" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
  PLAN=$(ls .claude/plans/step-*${SLUG}*.md 2>/dev/null | head -1)
  [ -z "$PLAN" ] && PLAN=$(ls .claude/plans/*${SLUG}*.md 2>/dev/null | head -1)
fi

# Level 3 — mtime fallback (last resort when args differ completely)
[ -z "$PLAN" ] && PLAN=$(ls -t .claude/plans/*.md 2>/dev/null | grep -v '\.active' | head -1)
```

After finding a plan (any level), **write the active pointer**:

```bash
[ -n "$PLAN" ] && echo "$PLAN" > .claude/plans/.active
```

This pointer survives interruptions — the next `/feature-parallel` invocation reads it first,
bypassing slug matching entirely.

1. If a plan file was found, read it. Use it as the detailed specification for this feature.
   The plan is the source of truth for scope, file locations, acceptance criteria, and
   any pre-identified domain split hints. Skip Step 1.5.
2. If no plan file exists, proceed to Step 1.5 to auto-generate one.

### Step 1.5: Auto-generate plan (when no plan exists)

Only execute this step when Step 1 found no existing plan file.

A plan matters more for `/feature-parallel` than `/feature`: the orchestrator's
PHASE 2b DOMAIN-SPLIT decision is the single highest-leverage call in the
entire flow, and a bad split wastes every parallel agent's work. Without a
plan, the split is being derived from `$ARGUMENTS` alone.

```bash
mkdir -p .claude/plans
```

Dispatch an Opus planning subagent. It reads all project reference material in
isolation — its context is discarded after writing the plan file. The main
session only ever sees the compact plan.

```
Agent(model: "opus",
      prompt: "
<feature>$ARGUMENTS</feature>
<task>
You are a planning agent for the /feature-parallel TDD pipeline. Read available
project documentation and produce a compact implementation plan. The main
session will ONLY see your plan file — all reference material must be
distilled, not pasted.

Follow these steps IN ORDER:

1. Read CLAUDE.md — understand project conventions, commands, and architecture.
2. Read .claude/progress.md if it exists — get current branch and last commit.
3. Read any spec or backlog files found in Specs/ or .claude/plans/ — extract
   the matching story and its acceptance criteria.
4. Read .claude/dependency-map.md if it exists — note layer ordering. This is
   especially important for /feature-parallel: dependency layers translate
   directly into domain split candidates.

5. Write the plan to .claude/plans/<slug>.md where slug is a kebab-case
   description of the feature.

6. Output EXACTLY this line as the LAST line of your response:
   PLAN_FILE: .claude/plans/<slug>.md

Keep the plan between 1,000-3,000 tokens. Be dense, not verbose.
Reason carefully about the Domain Split section — it drives parallel dispatch.
</task>
<format>
# Plan: <Feature Name>

## Goal
One sentence.

## Acceptance Criteria
- [ ] ...

## Tasks
1. ...

## File Map
| Action | File | Notes |
|--------|------|-------|
| create | ... | ... |

## Domain Split (hint for PHASE 2b)
| Domain | Files | Depends on |
|--------|-------|------------|
| ...    | ...   | ...        |

If the feature is single-domain (purely UI-layer, single layer of the stack,
no independent parallel workstreams, or hard sequential dependency chain),
write SINGLE-DOMAIN as the only entry in the table and add a one-line note:
"SINGLE-DOMAIN — recommend /feature, not /feature-parallel" followed by a
1-2 sentence reason. This lets the orchestrator bail before dispatching
wasted discovery agents.

## Verification
- ...
</format>
")
```

After the subagent completes:

1. Parse the `PLAN_FILE:` line from the agent's return value to get the exact filename.
2. If the `PLAN_FILE:` line is present, read that file directly and write the active pointer:
   ```bash
   echo "$PLAN" > .claude/plans/.active
   ```
3. If the line is absent, fall back to slug-based search:
   ```bash
   PLAN=$(ls .claude/plans/*${SLUG}*.md 2>/dev/null | head -1)
   [ -z "$PLAN" ] && PLAN=$(ls -t .claude/plans/*.md 2>/dev/null | grep -v '\.active' | head -1)
   [ -n "$PLAN" ] && echo "$PLAN" > .claude/plans/.active
   ```
4. If still no file found, output warning and proceed with `$ARGUMENTS` only:

> ── WARNING: Plan auto-generation failed. Proceeding with $ARGUMENTS only. ──

### Phase status banner

Output one of:

> ── PHASE 0 PLAN ✓ ── loaded \<plan-filename> ← pre-existing plan found in Step 1
> ── PHASE 0 PLAN ✓ ── auto-generated \<plan-filename> ← Opus subagent created in Step 1.5
> ── PHASE 0 PLAN ✗ ── no plan, using $ARGUMENTS ← fallback (subagent failed)

### Step 2: Early single-domain bail

If a plan was loaded (either level), grep its Domain Split section for the
literal string `SINGLE-DOMAIN`:

```bash
grep -q 'SINGLE-DOMAIN' "$PLAN" && SINGLE_DOMAIN=1
```

If `SINGLE_DOMAIN=1`, bail before discovery — the plan author (Opus
subagent or human) already determined parallelization is unwarranted.
Output:

> ── PHASE 0 BAIL ── plan declares SINGLE-DOMAIN. Re-run with `/feature` for sequential flow.

Exit cleanly. Do NOT start any discovery, specification, or implementation.
The plan file remains on disk so the `/feature` invocation picks it up via
the same `.active` pointer.

This preempts PHASE 3 GATE CHECK condition #1 and saves 4 horizontal
discovery agents from being dispatched against a feature that will bail anyway.

---

## PHASE 1 — SPECIFY (Gherkin acceptance criteria)

Before any discovery or implementation, write the Gherkin spec:

1. Create `specs/<feature-slug>.feature` with scenarios covering: happy path, validation, edge cases, error conditions
2. Write one `Scenario:` per distinct behaviour — each will map to one `it()` block

### PAUSE — Review spec (FAST_MODE = false only)

**If FAST_MODE = true:** auto-approve and output:

> ── FAST MODE: auto-approving N scenarios. Proceeding to DISCOVER+RED+GREEN. ──

**Otherwise:** output the Gherkin and ask the user to reply **go** before continuing.

Output phase banner:

> ── PHASE 1.5 SPECIFY ✓ ── N scenarios in specs/\<feature>.feature

---

## PHASE 2a — DISCOVER-HORIZONTAL (parallel)

Dispatch discovery agents **simultaneously**, each scoped to one layer.

Customize the layers for your project. Example layers for a full-stack web app:

```
Agent(subagent_type: "discovery-explorer",
      prompt: "Layer: types\nFeature: $ARGUMENTS\n\nRead {{TYPES_FILE}}. List:\n1. Existing types relevant to this feature (name + purpose, one line each)\n2. New types this feature will likely need\n3. Enums/constants that may need extending\n\nStay under 200 words. Output structured summary only.")

Agent(subagent_type: "discovery-explorer",
      prompt: "Layer: components\nFeature: $ARGUMENTS\n\nSearch {{COMPONENTS_DIR}} for components relevant to this feature. List:\n1. Components to reuse (path + what they provide)\n2. Components to extend or modify\n3. New components likely needed\n\nStay under 200 words. Output structured summary only.")

Agent(subagent_type: "discovery-explorer",
      prompt: "Layer: data\nFeature: $ARGUMENTS\n\nRead {{DATA_FILE}}. List:\n1. Existing functions/data relevant to this feature\n2. New data functions likely needed\n3. Any shape changes required on existing structures\n\nStay under 200 words. Output structured summary only.")

Agent(subagent_type: "discovery-explorer",
      prompt: "Layer: tests\nFeature: $ARGUMENTS\n\nRead one representative test file from {{TEST_DIR}}. List:\n1. Test file structure pattern (imports, describe/it nesting)\n2. Test utilities in use (custom renders, mocks, helpers)\n3. Patterns to follow for new tests\n\nStay under 200 words. Output structured summary only.")
```

Collect and synthesize all summaries into a **horizontal map** — a cross-cutting snapshot of the codebase state relative to this feature.

Output phase banner:

> ── PHASE 2a DISCOVER-HORIZONTAL ✓ ── N agents, horizontal map complete

---

## PHASE 2b — DOMAIN-SPLIT (sequential)

> Reason carefully: think step-by-step through how the Gherkin scenarios partition across files before writing the domain table. A bad split wastes every parallel agent's work.

Using the Gherkin spec + horizontal map, partition the feature into **N independent domains** (vertical slices).

A domain is a self-contained unit of work that:

- Has a clear file scope (e.g., "wishlist page + route")
- Does not depend on another domain's new output to compile

Assign each domain:

- A short name (e.g., `wishlist-page`, `wishlist-store`, `wishlist-api`)
- Its file scope (which files it creates/modifies)
- Its Gherkin scenarios (subset of the spec)

Output a domain table:

```
| Domain | Files | Scenarios |
|--------|-------|-----------|
| ...    | ...   | ...       |
```

---

## PHASE 3 — GATE CHECK (sequential)

> Reason carefully: evaluate each bail condition explicitly against the domain table before deciding.

Evaluate whether parallel execution is beneficial. Bail to sequential if ANY of:

1. **Single-domain feature** — only one domain was identified in Phase 2b
2. **Shared type dependency** — the feature requires a new shared type that ALL domains depend on (write it first, sequentially)
3. **Too few scenarios** — Gherkin has fewer than 3 scenarios
4. **Hard interdependencies** — Domain B cannot compile without Domain A's output

**If bailing:**

> Parallel execution not beneficial for this feature. Re-run with `/feature` for standard sequential flow.

Exit cleanly. Do NOT start any implementation.

**If proceeding:**

> ── PHASE 3 GATE ✓ ── N domains cleared for parallel dispatch

---

## PHASE 2c — DISCOVER-VERTICAL (parallel)

Dispatch N `discovery-explorer` agents simultaneously, one per domain:

```
Agent(subagent_type: "discovery-explorer",
      prompt: "Domain: <domain-name>\nFeature: $ARGUMENTS\nScope: <files this domain owns>\n\nRead the scoped files. Return a brief (under 250 words) implementer brief:\n1. Existing patterns to follow (imports, component structure)\n2. Exact new files to create with their expected exports\n3. Test file location and 2-3 scenario sketches from the Gherkin spec\n\nOutput structured brief only — this goes directly to the implementer agent.")
```

Each agent's output becomes the `context` passed to the matching domain-implementer.

Output phase banner:

> ── PHASE 2c DISCOVER-VERTICAL ✓ ── N vertical briefs ready

---

## PHASE 4 — RED+GREEN-PARALLEL (parallel with worktree isolation)

Dispatch N `domain-implementer` agents simultaneously, each with `isolation: "worktree"`:

```
Agent(subagent_type: "domain-implementer",
      isolation: "worktree",
      prompt: "
Domain: <domain-name>
Feature: $ARGUMENTS
Gherkin scenarios: <relevant scenarios from spec>

## Implementer Brief (from vertical discovery)
<vertical discovery output for this domain>

## Scope Boundary (HARD LIMIT)
You must ONLY read and write files in this list:
<file list for this domain>

You MUST NOT modify any file outside this list. If you need a change outside
your scope, record it as a NOTE at the end of your output for the orchestrator
to handle sequentially.

## TDD Instructions
1. RED: Write failing tests first at the correct test file path. Run them — confirm ALL fail.
2. GREEN: Write minimal implementation. Run tests — confirm ALL pass.
3. Typecheck: Run TYPECHECK_CMD (from .claude/framework.json) — must pass before committing.
4. Commit: git add <your files only> && git commit -m 'feat(<scope>): <description>'

## Technical Rules
{{PROJECT_TECHNICAL_RULES}}

## Test command: <TEST_CMD from .claude/framework.json> <test-file-path>
      ")
```

After all agents complete, collect:

- Each agent's branch name (from worktree isolation)
- Each agent's commit hash
- Any out-of-scope NOTEs

Output phase banner:

> ── PHASE 4 RED+GREEN ✓ ── N domains committed on worktree branches

---

## PHASE 5 — MERGE (sequential)

> Reason carefully: inspect every conflict before choosing a resolution.

Merge domain branches into the current branch in dependency order (shared types first, then everything else):

```bash
# For each domain branch (in dependency order):
git merge --no-ff <branch> -m "chore(merge): integrate <domain> domain into feature branch"
```

**Post-merge validation:**

```bash
# Read TYPECHECK_CMD and TEST_CMD_ALL from .claude/framework.json
<TYPECHECK_CMD>
<TEST_CMD_ALL>
```

If either fails, diagnose and fix before proceeding.

Output phase banner:

> ── PHASE 5 MERGE ✓ ── N branches merged, 0 conflicts (or: X conflicts resolved)

---

## PHASE 6 — REFACTOR (sequential)

Apply improvements to the merged result:

1. Run tests first to confirm green baseline
2. Extract magic numbers/strings into named constants
3. Remove duplication across domain files (common helpers, shared types)
4. Clean up imports — ensure no cross-domain circular references
5. After EACH change, run tests to confirm still green

Output phase banner:

> ── PHASE 6 REFACTOR ✓ ── code improved, all tests green

---

## PHASE 7 — VALIDATE (parallel)

Dispatch validation agents simultaneously. At minimum, always dispatch the reviewer:

```
Agent(subagent_type: "reviewer",
      prompt: "Review all changes from this feature delivery.
        Run typecheck (TYPECHECK_CMD from .claude/framework.json) and tests (TEST_CMD_ALL from .claude/framework.json).
        Check: type safety, input validation, security, injection risks,
        data exposure, error handling, data integrity.
        Report findings with severity ratings (CRITICAL/HIGH/MEDIUM/LOW).")
```

Add project-specific validators (e.g., design-reviewer, i18n-checker) as additional agents if your project has them.

If reviewer reports CRITICAL or HIGH findings, fix before SHIP.

Output phase banner:

> ── PHASE 7 VALIDATE ✓ ── reviewer(s) cleared

---

## PHASE 8 — SHIP (sequential)

### Step 1: Final checks

```bash
# Read TYPECHECK_CMD and TEST_CMD_ALL from .claude/framework.json
<TYPECHECK_CMD>
<TEST_CMD_ALL>
```

### Step 2: Commit and push

```bash
git add <all feature files> specs/<feature>.feature
git commit -m "feat(<scope>): <description>"
git push -u origin HEAD
rm -f .claude/plans/.active .claude/plans/.checkpoint
```

### Step 3: Create PR

```bash
gh pr create --title "feat: <description>" --body "$(cat <<'EOF'
## Summary
- <bullet points>

## Test plan
- [ ] All tests pass
- [ ] No TypeScript errors

🤖 Generated with Claude Code
EOF
)"
```

Print the PR URL.

### Step 4: Update backlog

If `.claude/plans/backlog.md` exists, mark the matching item done and note any scope changes.

### Step 5: Lessons discipline

Append to `.claude/lessons.md` **only** when a run produced a correction-worthy lesson:

- A merge conflict occurred because domain scope was ambiguous
- An agent edited outside its assigned scope
- The gate check bailed incorrectly

Do **not** append for normal successful runs.

### Step 6: Completion summary

```
══════════════════════════════════════════════════════
  FEATURE COMPLETE (parallel): <short description>
══════════════════════════════════════════════════════

  Gherkin spec: specs/<feature>.feature — N scenarios
  Tests: N passing
  Branch: feature/<slug>
  Commit: <short hash> <message>

  Domains: <N domains>
  Agents dispatched: <count> (horizontal discovery + vertical discovery + implementers + validators)

  Files created/modified:
    - <file list>

  Assumptions: <list or "none">
  Next session: <what to work on next>
══════════════════════════════════════════════════════
```

### Step 7: Kaizen retrospective

Follow the same Kaizen format as `/feature`. Additionally evaluate:

- Whether the parallel vs sequential speedup was worth the merge overhead
- Whether the gate check made the right call
- Whether any domain scope boundaries caused friction

```
── KAIZEN ──────────────────────────────────────
  What went well:
    - <1-2 things>
  What could improve:
    - <1-2 actionable suggestions>
  Auto-implemented:
    - <list or "none">
  Workflow delta (not auto-implemented):
    - <debatable changes>
────────────────────────────────────────────────
```
