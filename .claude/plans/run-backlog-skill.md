# Plan — Overnight Orchestrator Skill (`/run-backlog`) — Extended

> NOTE: per memory, project plans belong in `house-track/.claude/plans/`.
> Move this file to `house-track/.claude/plans/run-backlog-skill.md` after
> approval — the plan-mode runtime forced the `~/.claude/plans/` path.

## Context

You want a separate skill that drives `/feature` (and `/feature-parallel`)
across many backlog items unattended overnight, so a single 6-hour
session can chew through Slices 1–7 of the operator-UI plan without
babysitting. Your stated concern: this is critical infra; any failure
mode that's not pre-mitigated WILL screw things up overnight when no one
is watching.

The chosen integration is **option B** (ralph-loop Stop hook) for crash
recovery and bounded per-iteration cache cost. Most of this plan is the
risk register and the verification gates, not the skill code itself —
that part is small.

---

## How the existing pieces fit

```
/run-backlog (this new skill)
  PHASE 0 — pre-flight + write state files
  PHASE 1 — emit first iteration (handled below as "iteration body")
  ↓
ralph-loop Stop hook (existing plugin)
  blocks session exit, re-feeds the SAME prompt that /run-backlog wrote
  ↓
iteration body (same prompt, ~30 lines, runs every iteration)
  read state.json → run pre-flight → dispatch ONE feature-runner subagent
  → record outcome → run post-flight → exit normally OR output <promise>
```

**Why ralph-loop's hook is the right substrate**

- It already implements: state file with `session_id` isolation, max-iterations gate, completion-promise gate, atomic state-file updates, transcript scraping for the promise tag.
- It runs on `Stop` events — i.e. every time Claude finishes responding without pending tool calls. That maps exactly to "one /feature cycle done, ready for next."
- The hook re-feeds **the same prompt verbatim** each iteration. So the iteration body MUST be self-contained, idempotent, and read all decision input from disk.

**Why a `feature-runner` subagent is mandatory (not optional)**

- /feature is a deep, multi-turn workflow with many Agent dispatches and giant tool outputs. If invoked via the `Skill` tool inline, every iteration's RED/GREEN/REFACTOR transcripts pile into the main conversation. After 3–4 iterations the cached prefix is dead and every subsequent iteration pays full cold-start cost on inflated context. By iteration 7 the session may be too large to continue.
- A subagent's context dies on return. Main thread sees only the completion summary that /feature already prints (≤30 lines). Orchestrator overhead per iteration: ~1–2 KB.
- **`CLAUDE_CODE_FORK_SUBAGENT=0`** (the default, NOT 1). The feature-runner is self-contained — its prompt is `"/feature <description>"` plus the plan path. It does not need the parent conversation. Forking would drag every prior iteration's record into the subagent, defeating the whole point of subagent isolation. The 5-minute cache-TTL cold-start cost the subagent pays at first turn is dwarfed by /feature's total work (~100s of turns).
- Pin Opus (`CLAUDE_CODE_SUBAGENT_MODEL=opus`) for the runner. This is real implementation work, not summarization.

---

## Risk register (read first; the plan is shaped by these)

Each row is a real failure mode I traced through the existing code paths,
not a hypothetical. The "Mitigation" column is what the skill MUST do.

| # | Risk | Likelihood | Damage if hit | Mitigation |
|---|------|------------|---------------|------------|
| R1 | /feature crashes mid-RED, leaves uncommitted changes + dangling worktree | Medium | Next iteration's pre-flight sees dirty tree → cascade fail | Pre-flight aborts iteration if `git status --porcelain` non-empty; clean-slate guard runs `git worktree prune` before each iteration. Crashed iteration → record FAIL, do NOT auto-clean (preserves evidence) |
| R2 | /feature ships a PR but tests are silently broken on the merge target | Low | Subsequent slices fork from a poisoned branch | Post-flight runs full TEST_CMD_ALL on HEAD before ticking the backlog item. If it fails, mark FAIL and stop loop |
| R3 | Subsequent slice forks from `main` and misses prior unmerged slice's changes | High (default behavior) | Slice N fails to build because it depends on Slice N-1 | Use **chained branching mode** (default): each iteration starts from the previous slice's branch tip, not `main`. Configurable via `--base-mode {chain,main}` |
| R4 | Two iterations in sequence touch a shared file (e.g. `prisma/schema.prisma`) and the merge breaks | Medium | Cascading test failures | Same chained-branching strategy + post-flight typecheck. Loop halts at first failure |
| R5 | /feature falsely claims SUCCESS while PR has unresolved conflicts | Low | Backlog ticked despite broken state | Post-flight: `gh pr view <num> --json mergeable,mergeStateStatus` must report `MERGEABLE` AND `CLEAN`. Otherwise FAIL |
| R6 | Backlog file edited by hand mid-run (line numbers shift, items added/removed) | Medium (it's a feature, not a bug — see "Source-of-truth model") | Wrong item ticked / tick lands on wrong line | Each iteration RE-PARSES backlog.md from scratch (no frozen queue). Items identified by `description_sha`. If sha not found at tick time, log a WARN and skip the tick — item stays unticked, morning review |
| R7 | Subagent timeout or returns garbage | Medium | Iteration succeeds visually but no real work happened | Post-flight checks: HEAD commit hash on the expected branch is NEW (different from pre-flight snapshot) AND >0 files changed. If commit hash unchanged → FAIL |
| R8 | Stop hook itself crashes (Claude Code internal issue) | Very low | Session exits, loop dies | State file persists; user can restart `/run-backlog` next morning. Re-entry detects `state.json` and resumes from `current_index` |
| R9 | Token budget exhausted mid-iteration | Low (Opus 1M) | Iteration partial, no completion summary | Post-flight commit-hash check (R7) catches this. Worst case: backlog item not ticked, partial branch exists for human review |
| R10 | Network outage during `git push` or `gh pr create` | Medium | /feature reports SHIP success but PR doesn't exist | Post-flight verifies PR via `gh pr view`. Retries push/PR creation up to 3× with backoff before recording FAIL |
| R11 | Two `/run-backlog` sessions started accidentally | Low | Concurrent writes to backlog/state, double-ticks | `session_id` field in state.json + advisory lockfile `.claude/run-backlog/.lock` containing PID and session id. Iteration body refuses to run if lockfile session_id ≠ own session_id |
| R12 | `--max-iterations` not set, infinite loop on impossible task | Medium | Burn token budget overnight on a stuck slice | **HARD REQUIREMENT**: setup writes `max_iterations: <queue_length + 2>` into the ralph state file. Cannot be 0 (infinite). Plus `--budget` wall-clock check |
| R13 | A slice annotated `/feature-parallel with 3, 5, 6` is misinterpreted | Medium | Misuse of parallel mode → multiple branches at once → merge chaos | Within-slice parallel (`/feature-parallel`) decided by preplanning safety gate. Cross-slice parallel (waves) IS in scope, but capped at `--max-parallel 3`, and each wave's merge step halts the loop on conflict |
| R21 | Wave merge produces silent bad result (clean merge but tests fail post-merge) | Medium | Wave's tip is poisoned; subsequent wave forks from it | Post-merge gate runs full TEST_CMD_ALL + TYPECHECK_CMD on the merged tip. If red, halt loop, leave wave branches intact for human triage |
| R22 | Two parallel feature-runners race on filesystem (same .gitignore, .claude/plans/.active) | Medium | Subtle corruption | Each feature-runner uses `isolation: "worktree"`; .active pointer is set BY each subagent inside its own worktree, not by the orchestrator |
| R23 | Anthropic rate-limits hit during a wide wave | Medium | One or more parallel slices fail with 429 | `--max-parallel 3` ceiling; feature-runner retries 429s with backoff (already in /feature). If still fails → status=fail, retried in a future iteration |
| R24 | Cohort hint in backlog disagrees with computed DAG | Low | Wave assignment differs from human intent | Preplanning surfaces the divergence in the AskUserQuestion approval step ("annotation says cohort 3,5,6 but file scopes overlap → propose: 3 alone, then 5+6"); human can override |
| R25 | Top orchestrator dispatched on non-Opus model (cheaper / faster) | Low | Wave-merge / DAG decisions degrade silently | PHASE 0a aborts if active model is not Opus. Hard gate, not warning |
| R14 | Sentinel file `.claude/.circuit_open` already present at run start | Low | First fetch in /feature trips immediately | Pre-flight checks for sentinel. If present, refuse to start the run |
| R15 | Permissions prompt fires mid-iteration (no human awake) | Medium | Iteration hangs forever | Document: orchestrator MUST be started in `--permission-mode acceptEdits` or `bypassPermissions`. Pre-flight reads `settings.local.json` and warns if not in an auto-approve mode |
| R16 | `.claude/plans/.active` left over from prior session | Low | /feature picks up wrong plan | Pre-flight deletes `.active` before each iteration. Each /feature invocation must rely on the slug match (Level 2) for plan lookup |
| R17 | Backlog item description matches multiple plan files | Low | /feature loads the wrong plan | Pre-flight resolves the expected plan path from the backlog annotation (each slice already has an explicit `[link](./postgres-migration.md)` etc.); writes that path to `.active` BEFORE dispatching |
| R18 | Auto-compaction fires mid-subagent | Low | Subagent loses context, may write incoherent code | Subagents are short-lived; one /feature ≈ 50–200 turns ≈ well under compaction threshold for Opus 1M. Not actually a real concern at this scale; documented for completeness |
| R19 | Wall-clock budget hit mid-iteration | Low | Iteration leaves partial work on a branch | Budget check is at iteration START only (never mid-iteration). Worst case: one extra iteration runs past budget. Acceptable |
| R20 | Sleep-mode/laptop lid close kills the session | Medium | Loop dies | Document: must run on a machine that won't sleep (or use `caffeinate` on macOS). Explicitly call out in setup output |

---

## Context discipline (where context is cleaned, where it must NOT be)

This is the critical-path optimization for an overnight run. The default
behavior of Claude Code wastes context in three predictable ways during
loops; the design below avoids all three.

### What stays in cache (the static prefix — must NOT be invalidated)

- System prompt, tool list, MCP server set
- `CLAUDE.md` (root, 120-line cap enforced by `claudemd-size-check`)
- `.claude/rules/*.md` (loaded via CLAUDE.md references)
- Auto-injected SessionStart context (`progress.md` injection)

The Stop-hook re-feed mechanism does **not** invalidate any of this — it
appends a new user message in the dynamic suffix. The cached prefix
persists across all overnight iterations as long as we don't break the
following invariants:

- **Do not edit `CLAUDE.md` or `progress.md` mid-run.** The orchestrator
  WILL want to update progress.md with results; that update is deferred
  to the morning report (post-loop) instead. State updates go to
  `.claude/run-backlog/state.json` only.
- **Do not edit the orchestrator skill `SKILL.md` mid-run.** Its content
  is loaded into the conversation when /run-backlog first invokes it, and
  the iteration body inside it is referenced (not re-loaded) every time.
  Editing it would force a re-load on the next iteration.
- **Do not switch models mid-run.** Caches are model-scoped.
- **Do not enable/disable MCP servers or plugins mid-run.** Tool list churn
  rebuilds the cache.

### What grows linearly (acceptable, bounded)

- Per-iteration orchestrator output in the dynamic suffix: ~30–60 lines.
  At 7 iterations that's <500 lines of conversation. Trivial vs Opus 1M.
- The Stop hook's re-fed prompt is the SAME bytes each iteration → after
  the first iteration, those bytes hit the cache (read, not creation).

### What is actively isolated (subagent boundary)

- /feature's RED/GREEN/REFACTOR transcripts: stay inside feature-runner,
  discarded on return. Main thread never sees them.
- Plan file content: read by feature-runner via its own Read tool, never
  pasted into orchestrator output. Orchestrator passes the path only.
- Test output, typecheck output, git diffs: same — stay in subagent.

### What lives on disk only (NEVER loaded into context)

- `.claude/run-backlog/state.json` — read by the iteration body each time
  via Read tool, but the read result is small (<5 KB) and bounded.
- `.claude/run-backlog/<ts>/<slug>.md` — written but never read back.
  Morning review only.
- `.claude/run-backlog/<ts>/MORNING_REPORT.md` — same.

### Active context-cleaning steps (per iteration)

1. **Iteration body keeps user-visible output minimal.** After post-flight,
   emit ONLY `iteration N: <slug> -> success` (or `fail: <reason>`). No
   subagent-summary echo. Diagnostics go to disk.
2. **Subagent prompt is a path, not a paste.** `feature-runner` prompt:
   `/feature <description>` + `Plan file: <plan_path>` + `Base branch:
   <base>` — under 200 chars. The subagent reads the plan itself.
3. **Subagent dispatch flags:**
   - `subagent_type: "feature-runner"`
   - `model: "opus"` (or rely on `CLAUDE_CODE_SUBAGENT_MODEL=opus`)
   - `isolation` NOT set (no worktree at this layer — /feature handles
     its own worktrees inside)
   - fork inheritance: **off** (default; do not set
     `CLAUDE_CODE_FORK_SUBAGENT=1` for this run)
4. **No `/compact` in the loop.** /compact is unnecessary at <500 lines
   of dynamic suffix and would actually rewrite the cached prefix
   structure. Skip it.
5. **No `progress.md` update mid-run.** The orchestrator buffers the
   "Next session" line for the final iteration only, then writes it once
   at the end before the completion promise.

### Cold-start budget per iteration

| Cost source | Per iteration | Notes |
|-------------|--------------:|-------|
| Orchestrator (main thread) prefix cache hit | ~0 tokens (read) | Stable across all iterations |
| Orchestrator dynamic suffix (re-fed prompt + prior iter records) | ~500–2000 tokens | Linear growth, bounded |
| feature-runner subagent first-turn prefix | ~5–10 KB cold-start | One per iteration; amortized over 100s of subagent turns |
| feature-runner inner subagents (discovery, implementer, reviewer) | already optimized in /feature | Not our concern |

Net: orchestrator overhead per iteration ≈ <1% of the /feature run cost
it triggers. This is the right shape — the loop is essentially free; the
work is in /feature.

---

## Handover contract (orchestrator ⇄ feature-runner ⇄ /feature)

Three agents, two boundaries. Most overnight failure modes cash out at
these boundaries — sloppy handover is how silent corruption sneaks in.

### Boundary 1 — Orchestrator → feature-runner (handover DOWN)

Passed via the Agent tool prompt. Must be small (<500 chars), structured,
and self-sufficient — feature-runner runs with `fork=0` and inherits no
conversation state.

```
ROLE: feature-runner
SLUG: <slug>
DESCRIPTION: <one-line description from backlog>
PLAN_PATH: .claude/plans/<file>.md
BASE_BRANCH: <branch name, already checked out>
COMMIT_PRE: <sha snapshot from pre-flight>
FORBIDDEN:
  - --careful flag (must run in FAST_MODE)
  - /feature-parallel (R13)
  - AskUserQuestion / EnterPlanMode / any tool that pauses
  - editing CLAUDE.md or progress.md
  - direct push or merge to main
  - the literal string "<promise>" anywhere in your output
RETURN_CONTRACT: emit a single JSON block matching the schema below as
                 the LAST text in your final message; nothing after it.
```

The pre-flight has already ensured: working tree clean, base checked out,
typecheck green, .active pointer written. feature-runner can assume
those invariants hold at start.

### Boundary 2 — feature-runner internal step (invoke /feature)

feature-runner is a thin wrapper. Its only real work:

1. Verify the four invariants above (cheap re-checks; fail fast if violated).
2. Invoke `/feature <DESCRIPTION>` via the Skill tool.
3. Wait for /feature to complete (it manages its own internal subagents
   for discovery/implementation/review — those die inside /feature, never
   reach feature-runner's main thread).
4. Capture /feature's natural-language completion summary.
5. Translate it to the strict JSON contract for return.

Why translate: /feature's completion summary is human-formatted text
(banners, kaizen, etc.). The orchestrator's parser would be brittle.
feature-runner's job is to reduce it to a machine-readable contract.

### Boundary 3 — feature-runner → Orchestrator (handover UP)

Strict JSON contract. The orchestrator parses ONLY this; everything else
is logged to disk for human review.

```json
{
  "status": "success" | "fail" | "skip",
  "fail_phase": "preflight" | "specify" | "discover" | "red" | "green" |
                "refactor" | "validate" | "ship" | null,
  "fail_summary": "<≤200 chars, human readable>" | null,
  "branch": "feature/<slug>",
  "commit": "<sha>" | null,
  "commit_pre": "<sha from input>",
  "files_changed": ["<path>", ...],
  "tests_added": <int>,
  "tests_passing": <int>,
  "pr_number": <int> | null,
  "pr_url": "<url>" | null,
  "duration_seconds": <int>,
  "scope_violations": ["<path outside plan scope>", ...],
  "raw_log_path": ".claude/run-backlog/<ts>/<slug>.subagent.log"
}
```

feature-runner writes the verbose /feature transcript to
`raw_log_path` itself, BEFORE returning, so the path is valid by the
time the orchestrator reads it.

### Defensive parsing on the orchestrator side

Even with a strict contract, the orchestrator MUST handle:

| Failure | Detection | Action |
|---------|-----------|--------|
| Subagent returned no JSON block | Regex extract fails | status=fail, fail_phase="handover", capture raw return to log |
| JSON parses but missing required fields | Schema check | status=fail, fail_phase="handover" |
| Subagent crashed (Agent tool errored) | Tool error response | status=fail, fail_phase="handover" |
| `status="success"` but `commit == commit_pre` | R7 guard | Override to fail; subagent lied or did nothing |
| `status="success"` but `pr_number == null` | Field check | Override to fail; PR creation must have failed silently |
| `scope_violations` non-empty | Field check | Override to fail; halt loop immediately (R-new: prevents poisoning subsequent slices) |
| Subagent emits `<promise>` literal in any text | Pre-emptive: feature-runner agent definition forbids it; orchestrator scans return for the string and aborts if found | Prevents premature loop exit (catastrophic) |

### Subagent transcript isolation

Verified from `stop-hook.sh:81-104`: the Stop hook reads
`HOOK_INPUT.transcript_path` from its stdin, which is the **parent
session's** transcript. Subagent transcripts live in separate files
(`.claude/projects/<slug>/<subagent-uuid>.jsonl`) and are NOT scanned by
the Stop hook. So a `<promise>` string emitted inside feature-runner's
own conversation cannot trigger the parent loop's completion.

Belt-and-braces: the feature-runner agent definition still forbids the
literal string. If a future version of Claude Code ever merges subagent
transcripts into the parent's, this guard catches it.

### Working-tree handover (filesystem state is shared)

Subagents share the working tree with the parent. /feature does its work
on the main checkout (no worktree at this layer). Risks:

- feature-runner crashes mid-edit → working tree dirty → next iteration's
  pre-flight detects via `git status --porcelain`.
- **Evidence-preservation policy:** pre-flight does NOT auto-clean the
  dirty tree. Instead, `git stash push -u -m
  "run-backlog-fail-<slug>-<ts>"` to save evidence, then mark the prior
  iteration's result as fail (override `status="success"` if needed) and
  halt. Morning review: `git stash list` shows what was lost.
- A subagent attempting `git push --force` to main: forbidden via the
  agent definition's `allowed-tools` Bash glob (only `git push` to
  feature/* branches; explicit `*: --force` denylist).

### State.json handover (orchestrator → next iteration)

Each iteration is logically a separate "agent" too — same skill code
re-invoked by the Stop hook. Handover is via `state.json`:

- Iteration N writes `state.json` atomically (write to `.tmp`, `mv` over).
- Iteration N+1 reads at start. Schema_version field guards against
  format drift between runs.
- Schema is stable within v1 — adding fields is OK, removing/renaming
  requires a `schema_version` bump and a migration step.
- Lockfile (`.claude/run-backlog/.lock`) holds `session_id` + iteration's
  PID. If iteration N+1 starts and lockfile.session_id matches but PID
  differs (e.g., session restart inside same Claude Code session), it's
  treated as resumption — proceed normally.

### What the human sees in the morning (the FINAL handover)

`MORNING_REPORT.md` is the orchestrator-to-human handover. Required content:

1. Run summary (start/end time, total iterations, pass/fail counts).
2. Per-slice table: slug, status, branch, PR URL, duration, fail reason
   if any.
3. Action items: every fail has a "next action" line (e.g. "investigate
   `data/run-backlog/.../slice-2.subagent.log` for ship-phase typecheck
   error").
4. Stash list excerpt if any evidence was preserved.
5. Token-cost rollup (cheap to add via `ccusage daily`).
6. The exact `git checkout` and `gh pr list` commands the human can paste
   to resume work.

---

## Architecture (final)

```
/run-backlog --priority N [--budget 6h] [--max-fails 2] [--max-items N]
             [--retries-per-slice 2] [--max-parallel 3]
             [--base-mode chain|main] [--rehearsal] [--permission-mode <m>]
  │
  PHASE 0a — Setup (runs ONCE, only on first invocation)
  ├── Pre-flight (R1, R14, R15, R16):
  │     git status clean? on main? circuit-open absent? auto-approve mode?
  ├── Dry-parse backlog.md → confirm at least 1 candidate exists in
  │   the configured priority section
  ├── Acquire .claude/run-backlog/.lock (session-id keyed)
  │
  PHASE 0b — Preplanning session (HUMAN-PRESENT — only PAUSE in flow)
  ├── For each candidate item in --priority section:
  │     - Read its plan_path (each backlog item links to a plan)
  │     - Classify command: /feature OR /feature-parallel
  │       (start from annotation; downgrade to /feature if safety check
  │        fails — see "Preplanning safety gate" below)
  │     - Detect cross-slice dependencies (e.g. Slice 4 needs Slice 3's
  │       API committed) by scanning the plan for "depends on slice N"
  │       or matching file scopes
  │     - Order: linearize via topological sort
  ├── Present the plan to the user via AskUserQuestion:
  │     "Order: [Slice1: /feature → Slice2: /feature → Slice3: /feature-parallel
  │     → Slice4: /feature (depends on 3) → ...]. Approve?"
  ├── On approval: persist the plan to state.preplanning (advisory metadata
  │   keyed by description_sha; backlog.md remains source of truth)
  ├── Write .claude/run-backlog/state.json
  ├── Write .claude/ralph-loop.local.md with:
  │     completion_promise: "house-track overnight run complete"
  │     max_iterations: <candidate_count * (retries_per_slice+1) + 2>
  │     prompt: <the iteration body, verbatim>
  ├── Output "READY TO LOOP" banner with the approved plan
  └── Exit normally → Stop hook fires → first iteration begins
  ↓
  PHASE 1+ — Iteration body (one wave per iteration; same prompt)
  ├── Re-read state.json + lockfile
  │     ABORT or COMPLETE on: lockfile mismatch / .stop sentinel /
  │     budget / consecutive_fails ≥ max_fails / queue drained
  ├── RE-PARSE backlog.md → list eligible "- [ ]" items in --priority
  │   (skip items with retries-per-slice failures in state.results)
  ├── Compute current wave from state.preplanning DAG:
  │     wave = subset of eligible items with all deps in state.results
  │            as status=success, capped at --max-parallel
  │     If wave empty (deps not satisfied): write completion promise
  │     (means: a prior wave failed and dependents can never run)
  ├── Wave pre-flight (R1, R14, R16, R22):
  │     git worktree prune; rm -f .claude/plans/.active
  │     git status --porcelain empty? — else stash for evidence, FAIL
  │     git checkout <wave_base_branch>; git pull --ff-only
  │     run TYPECHECK_CMD on base — if red, halt loop
  │     snapshot HEAD as commit_pre
  │     set state.in_flight = list of wave members
  ├── Dispatch wave (single Agent block, multiple tool uses in parallel):
  │     for each slice in wave:
  │       Agent(subagent_type: "feature-runner",
  │             isolation: "worktree",
  │             model: "opus",
  │             prompt: <Boundary-1 contract for that slice>)
  │     Wait for ALL to return.
  ├── Wave post-flight:
  │     for each returned slice:
  │       parse JSON contract; verify per "Defensive parsing" table
  │     For each successful slice (lex order by slug):
  │       git checkout <wave_base>; git merge --no-ff <slice_branch>
  │       If conflict: git merge --abort; mark all wave slices as
  │         status=merge_conflict; halt loop (R21)
  │     Run TYPECHECK_CMD + TEST_CMD_ALL on merged tip
  │     If red: halt loop, leave branches intact (R21)
  │     If green: merged tip = next wave's base
  ├── Record per-slice results, clear in_flight, write per-slice logs
  ├── For each success: tick [x] in backlog.md (lookup by description_sha)
  ├── consecutive_fails: reset if any wave member succeeded; else +N
  ├── completed_count += success_count
  └── Exit normally → Stop hook re-fires for next wave
```

---

## Preplanning safety gate (per-slice parallel-vs-sequential decision)

The orchestrator's PHASE 0b examines each candidate slice and decides
which command to dispatch. Rule order (apply top-down; first match wins):

1. **Slice plan explicitly requests sequential.** If the plan_path body
   contains "Run via /feature." or no parallel annotation in backlog,
   pick `/feature`. Done.
2. **Plan body lacks an explicit domain breakdown.** Parallel needs ≥3
   independent domains. Heuristic: scan the plan for a "Domains:" section
   or for ≥3 distinct file-scope bullet groups. If absent → `/feature`.
3. **Plan declares <3 Gherkin scenarios target.** /feature-parallel's
   own GATE CHECK bails when fewer than 3 scenarios exist. If the plan
   says "≤2 scenarios" or describes ≤2 distinct behaviors → `/feature`.
4. **Cross-domain shared types.** If the plan mentions a "shared type" or
   "common types" that all domains depend on — `/feature` (the parallel
   variant would need that type written first sequentially, defeating
   the speedup).
5. **Slice depends on prior unmerged slice.** Chained-base mode means the
   subagent forks from a feature branch, not main. /feature-parallel uses
   nested worktrees per domain — chaining off a feature branch through
   nested worktrees has been tested less. Conservative default: `/feature`.
6. **Otherwise:** trust the backlog annotation. If the human wrote
   `_Run via /feature-parallel._`, dispatch `/feature-parallel`. If
   `_Run via /feature._`, dispatch `/feature`.

Each decision is recorded in `state.preplanning[sha].decision_reason`
("downgraded to /feature: rule 5 — chained base") so the morning report
can explain why a slice ran sequentially when the human expected parallel.

### Cross-slice parallelism (WAVES) — IN SCOPE

The orchestrator groups slices into **waves**. A wave is a set of slices
with no mutual dependencies — they can run as simultaneous feature-runner
subagents, each in its own worktree, each forking from the same wave-base
branch. Waves run sequentially; slices within a wave run in parallel.

Wave assignment is computed in PHASE 0b preplanning by topological sort:

1. Build a DAG: nodes = candidate slices; edge `A → B` if B's plan
   declares dependency on A (file scope overlap, "depends on slice N",
   or backlog annotation `_Run via /feature-parallel with N, M_`
   interpreted as cohort-membership).
2. Compute levels: level 0 = slices with no inbound edges; level k+1 =
   slices whose deps are all at level ≤k.
3. Each level becomes a wave.
4. Cap each wave at `--max-parallel N` (default 3) — too-wide waves
   stress git operations and PR creation rate-limits. Items beyond N
   roll into the next wave.

Wave execution (one wave per Stop-hook iteration):

```
for slice in wave (in parallel via single Agent block, multiple tool uses):
  feature-runner subagent:
    - isolation: "worktree"
    - base: <wave_base_branch>
    - prompt: as per Boundary 1
After all return:
  - For each successful slice (lex order by slug):
      git checkout <wave_base>; git merge --no-ff <slice_branch>
  - If any merge has conflict → git merge --abort; mark all wave
    members as "merge_conflict"; HALT loop (human triage in morning)
  - Run TYPECHECK_CMD + TEST_CMD_ALL on the merged tip
  - If green: tip becomes the next wave's base
  - If red: HALT loop
```

Cap on parallelism:

- `--max-parallel 3` default, configurable via skill arg
- Each parallel feature-runner consumes one Opus seat for its planning
  phase + Sonnet seats for its domain-implementers (per /feature internal
  budget). 3 simultaneous Opus + ~9 Sonnet workers is the practical
  ceiling on a single Anthropic account before rate-limit pushback.

Preplanning STILL captures the cohort hint from backlog annotations
(`_Run via /feature-parallel with 3, 5, 6._`) — used as a tiebreaker
when the dep graph is ambiguous (treat the cohort as a single wave if
no edges contradict it).

---

## Model policy (explicit, per-agent)

User requirement: top orchestrator and feature-planning are Opus; cheaper
models elsewhere when safe.

| Layer | Agent | Model | Rationale |
|-------|-------|-------|-----------|
| L0 | Top orchestrator (main session, /run-backlog) | **Opus** | DAG resolution, merge decisions, conflict triage, evidence-preservation calls. Highest leverage points. |
| L1 | feature-runner subagent | **Opus** | Wraps /feature; makes the per-slice "safe to parallelize?" call and the JSON-contract translation. Small main-thread but high leverage. |
| L2 | /feature internal — planning subagent (PHASE 0 Step 1.5) | **Opus** | Architecture and scope. Already pinned in /feature SKILL.md. Do not weaken. |
| L2 | /feature internal — Gherkin specify | **Opus** | Spec quality drives test correctness. Keep Opus. |
| L2 | /feature-parallel internal — DOMAIN-SPLIT, GATE CHECK, MERGE | **Opus** | Cross-cutting reasoning. Already pinned in /feature-parallel SKILL.md. |
| L3 | discovery-explorer (read-and-summarize) | **Haiku** | Fixed output template; bounded reasoning. Default already Haiku via `CLAUDE_CODE_SUBAGENT_MODEL`. Cheapest meaningful model. |
| L3 | domain-implementer (TDD against explicit brief) | **Sonnet** | Real coding work but well-scoped with a brief. Sonnet is the sweet spot. |
| L3 | reviewer (security/threat modeling) | **Opus** | Cross-cutting reasoning over diffs. Already pinned. |
| L4 | tracking-watchdog, code-simplifier, etc. (Stop-hook-triggered helpers) | **Haiku** | Diff-bounded analysis. Default. |

How this is enforced:

- L0: user starts the session with Opus (model selector / `/model opus`).
  `/run-backlog` aborts if `$CLAUDE_MODEL` ≠ opus.
- L1: feature-runner agent definition pins `model: opus` in frontmatter.
- L2/L3: already pinned by /feature and /feature-parallel SKILL.md
  files. The orchestrator does NOT touch these.
- Env vars: setup script sets `CLAUDE_CODE_SUBAGENT_MODEL=haiku` as the
  default for unpinned subagents (most read-and-summarize work). Pinned
  agents (Sonnet/Opus in their own frontmatter) override this.

Cost rough-cut at 3-wave/7-slice run:

- ~7 feature-runner Opus invocations (~$0.50 each main-thread) ≈ $3.50
- ~7 /feature planning Opus calls (~$1 each) ≈ $7
- ~21 domain-implementer Sonnet calls (~$0.30 each) ≈ $6
- ~7 reviewer Opus calls (~$0.50 each) ≈ $3.50
- ~50 discovery-explorer Haiku calls (~$0.05 each) ≈ $2.50
- Orchestrator main-thread Opus overhead: ~$1
- **Total night: ~$25** (excluding any retry waves; cap with --budget)

---

## Files to create

| Path | Purpose | Notes |
|------|---------|-------|
| `.claude/skills/run-backlog/SKILL.md` | The skill — contains ONLY the iteration body + setup-once branch | Setup branch detects "state.json exists" to skip setup on iterations 2+ |
| `.claude/agents/feature-runner.md` | Subagent definition that wraps one `/feature` call | Forces /feature, never /feature-parallel; forbids destructive ops |
| `.claude/run-backlog/` (gitignored) | Run logs + state | Add to `.gitignore` in setup |
| `.claude/run-backlog/state.json` | Queue + progress + fail counters + budget | Schema below |
| `.claude/run-backlog/.lock` | Session-id-keyed advisory lockfile | Prevents concurrent runs (R11) |
| `.claude/run-backlog/<ts>/<slug>.md` | Per-iteration log: subagent output + post-flight check results | One folder per run, one file per attempted slice |
| `.claude/run-backlog/<ts>/MORNING_REPORT.md` | Index of the run, written incrementally | Human-reviewable summary |

### Source-of-truth model: backlog.md is canonical

**`.claude/plans/backlog.md` is the primary source of both scope AND
progress.** The orchestrator does NOT freeze a queue at setup time. Each
iteration re-parses backlog.md and picks the first unchecked item that
matches the configured priority filter. `state.json` is reduced to
ephemeral bookkeeping only.

Consequences (deliberate, all accepted):

- **You can edit backlog.md mid-run.** Add a slice, remove a slice,
  re-order, manually tick an item — the next iteration picks up the
  current state. No restart needed.
- **A manually-ticked item is skipped on the next iteration**, even if
  state.json shows it as "in-flight" (the human is the higher authority).
- **A failed slice stays unticked**, so the next iteration retries it
  unless the failure caused the loop to halt via `max_fails`. To prevent
  retry-loops on a known-bad slice, edit backlog.md to either tick it or
  remove its `_Run via /feature._` annotation (which makes the parser
  skip it as un-runnable).
- **The chained base-branch (R3) is derived from `state.json.results`**,
  not from any field in backlog.md — backlog stays human-readable.
- Slug → description_sha mapping is recomputed each iteration. If
  description text drifts mid-run, treated as a new item.

### Parser priority filter

Skill arg `--priority N` (default 2 = the operator-UI sprint). Iteration
body parses ONLY `## Priority N` sections. Slices in other priority
sections are ignored — prevents the loop from accidentally chewing into
Priority 4 ("Later") items.

### `state.json` schema (ephemeral bookkeeping only)

No queue, no done-list. Backlog.md owns scope and progress.

```json
{
  "schema_version": 2,
  "session_id": "<from CLAUDE_CODE_SESSION_ID>",
  "started_at": "2026-05-02T22:00:00Z",
  "budget_seconds": 21600,
  "max_fails": 2,
  "consecutive_fails": 0,
  "max_items": null,
  "retries_per_slice": 2,
  "completed_count": 0,
  "base_mode": "chain",
  "priority_filter": 2,
  "rehearsal": false,
  "preplanning": {
    "<description_sha>": {
      "slug": "...",
      "command": "/feature" | "/feature-parallel",
      "decision_reason": "...",
      "depends_on_sha": ["...", ...],
      "cohort_hint": ["3", "5", "6"]
    }
  },
  "in_flight": {
    "slug": "postgres-migration",
    "description_sha": "<sha>",
    "branch": "feature/postgres-migration",
    "base_branch": "main",
    "commit_pre": "abc123",
    "started_at": "..."
  } | null,
  "results": [
    {
      "slug": "postgres-migration",
      "description_sha": "<sha>",
      "status": "success",
      "branch": "feature/postgres-migration",
      "commit_pre": "abc123",
      "commit_post": "def456",
      "pr_number": 42,
      "pr_url": "https://github.com/...",
      "started_at": "...",
      "ended_at": "...",
      "duration_seconds": 1234,
      "fail_phase": null,
      "fail_summary": null,
      "log_path": ".claude/run-backlog/<ts>/postgres-migration.md"
    }
  ]
}
```

Rationale for keeping `results[]` in state.json (and not just per-iter
log files):

- Morning report needs a structured rollup; reading 7 markdown logs to
  build it is fragile.
- Chained-base-branch logic needs to find "the most recent successful
  slice's branch tip" — that's a single read.
- Backlog.md `[x]` shows "done" but not "took 3 retries"; results[] does.

### in_flight handover

`in_flight` is set at iteration START (after pre-flight, before subagent
dispatch) and cleared at iteration END (whether success or fail, after
result is appended).

If a new iteration starts and finds `in_flight != null`, that means the
prior iteration crashed between dispatch and result-recording.
Recovery decision tree:

```
in_flight != null on iteration start?
  ├── git rev-parse <in_flight.branch> exists?
  │     ├── Yes → check if commit advanced past commit_pre
  │     │         ├── Yes → record as fail (incomplete; investigate)
  │     │         │         consecutive_fails++; clear in_flight
  │     │         └── No  → record as fail (no work done)
  │     │                   consecutive_fails++; clear in_flight
  │     └── No  → record as fail (subagent never started)
  │               consecutive_fails++; clear in_flight
  └── (proceed to next iteration)
```

This is fully deterministic and runs without human input. The only
failure mode that requires human triage is "max_fails reached"; before
that, the loop self-recovers through the normal fail-counting path.

### Iteration body — find next item algorithm

```
1. Parse .claude/plans/backlog.md
2. Find the configured priority section (## Priority N)
3. Walk top-down through items in that section
4. For each "- [ ]" item:
   - Extract description, plan_path, command annotation
   - If description_sha is in state.results AND last result for that
     sha was status=success: skip (likely user-edited backlog late)
   - If description_sha is in state.results AND last result was
     status=fail AND consecutive_fails for it >= per-slice retry
     limit (default 1): skip
   - Otherwise: this is the next item; return it
5. If no candidate found: queue drained, write completion promise
```

This makes retry semantics explicit and bounded.

---

## Backlog parser contract (matches current `backlog.md` exactly)

Already-existing markup:

```
- [ ] **Slice 1 — Postgres migration + testcontainers.** Plan: [`postgres-migration.md`](./postgres-migration.md). SQLite → pg, fresh `0_init`, ... _Run via `/feature`._
```

Parser rules:

1. Iterate top-down through `## Priority N` sections in order.
2. Each `- [ ]` line is a candidate. `- [x]` lines are skipped.
3. Extract `command`: regex `_Run via \`(/feature(-parallel)?)\`._` — **v1 forces `/feature` regardless of capture (R13)**, but stores the original annotation in the log for human review.
4. Extract `plan_path`: regex `\[\`([^\`]+\.md)\`\]\(\.\/([^)]+)\)` — first match.
5. Extract `description`: the bold prefix `**...**` from the line, stripped.
6. Compute `description_sha` (sha256 of stripped description).
7. Skip items lacking either annotation or plan link, with a WARN entry in the log.

Hand-test against current `backlog.md` Priority 2 section: should produce
exactly 7 queue entries (Slices 1–7) in order. Slices 3–6 carry
`/feature-parallel` annotations; v1 collapses them all to `/feature`.

---

## Iteration body (the ralph prompt verbatim)

This text goes into `.claude/ralph-loop.local.md` after the frontmatter.
It MUST be self-contained — every iteration receives this exact text and
nothing else from prior context.

```
You are the iteration body of /run-backlog. Read .claude/run-backlog/state.json
and .claude/run-backlog/.lock. If lockfile.session_id != $CLAUDE_CODE_SESSION_ID
abort with no changes. If .claude/run-backlog/.stop exists OR queue drained OR
budget exceeded OR consecutive_fails >= max_fails: clean up state, output
<promise>house-track overnight run complete</promise>, exit. Otherwise pick
queue[current_index] and run ONE iteration:

1. Pre-flight (abort iteration with status=fail if any fails, do NOT dispatch):
   - `git worktree prune`
   - `rm -f .claude/plans/.active`
   - `git status --porcelain` must be empty
   - `[ -f data/.circuit_open ]` must be false
   - `git checkout <base_branch>`
   - run TYPECHECK_CMD; must pass
   - write `.claude/plans/.active = <plan_path>`
   - snapshot `git rev-parse HEAD` as commit_pre

2. Dispatch feature-runner subagent (Opus). Prompt: "/feature <description>".
   Wait for return. Capture last 30 lines as completion summary.

3. Post-flight (any failure → status=fail):
   - parse summary for branch, PR URL
   - `git rev-parse <branch>` ≠ commit_pre
   - `gh pr view <num> --json mergeable,mergeStateStatus` → MERGEABLE+CLEAN
   - run TEST_CMD_ALL on branch tip; all green
   - run TYPECHECK_CMD on branch tip; passes

4. Record:
   - append entry to state.results
   - write .claude/run-backlog/<ts>/<slug>.md
   - if success AND backlog item findable by description_sha: tick [x]
   - update current_index OR consecutive_fails
   - rewrite MORNING_REPORT.md

5. Exit normally — Stop hook will re-fire this same prompt for item N+1.
```

The skill SKILL.md generates this prompt during PHASE 0 setup, embedding
the project's exact TYPECHECK_CMD and TEST_CMD_ALL from
`.claude/framework.json` (per `framework-boundary.md` rule).

---

## Recovery scenarios

**Scenario A — Mid-iteration crash (subagent never returned)**
- state.results has no entry for `current_index`
- Restart `/run-backlog`: detects state.json exists, prompts user with "in-flight item: <slug>. Resume / Skip-as-fail / Abort?" via AskUserQuestion. **No auto-resume** — human must decide.

**Scenario B — Stop hook crashed, session terminated**
- ralph state file may be partially intact. state.json is canonical.
- Restart `/run-backlog`: same flow as Scenario A.

**Scenario C — Slice N succeeded but Slice N+1 fails post-flight check**
- state.results shows N=success, N+1=fail
- consecutive_fails=1; loop continues to N+2 if max_fails>1
- If max_fails=2 and N+2 also fails: loop writes completion promise, halts
- Morning: review .claude/run-backlog/<ts>/N+1/<slug>.md for diagnosis

**Scenario D — All slices succeed**
- Final iteration writes promise, hook detects, loop exits
- MORNING_REPORT.md lists 7 PRs, all open, all mergeable
- Human merges them in order in the morning

---

## Verification gates (NOT optional — perform in this order)

### Gate 1 — Skill code review (before any execution)
- Skill SKILL.md is ≤ 200 lines.
- Iteration body text is byte-identical between SKILL.md (where it's authored) and what gets written to `.claude/ralph-loop.local.md` (where it's executed).
- All 20 risks from the register have a corresponding code path or pre-flight check.

### Gate 2 — Dry-run mode (`--dry-run`)
- Parses current backlog → prints queue with 7 entries (Slices 1–7) in order.
- For each entry, prints: command (must say `/feature` per R13), plan_path, description.
- No subagent dispatch, no file writes outside `.claude/run-backlog/dry-run/`.
- No state.json or ralph state file written.
- Verify: parser handles the literal `_Run via /feature-parallel with 3, 5, 6._` annotation without crashing (it should be coerced to `/feature`).

### Gate 3 — Single-item rehearsal (`--max-items 1 --rehearsal`)
- `--rehearsal` mode: subagent runs through RED+GREEN but does NOT push or open PR. Final commit lives only locally.
- Pick the smallest target: **Slice 7 (Docs)** is safest — doc-only, no schema changes, fast, hard to break anything.
- Run, then manually inspect:
  - state.json reflects success
  - .claude/run-backlog/<ts>/slice-7-docs.md is well-formed
  - backlog item for Slice 7 ticked correctly
  - branch exists locally with the expected docs commits
- Reset: `git checkout main && git branch -D feature/docs && rm -rf .claude/run-backlog/<ts>`

### Gate 4 — Failure-injection rehearsal (`--max-items 1 --max-fails 1`)
- Add a fake backlog item that points to a non-existent plan file.
- Run; expect status=fail, consecutive_fails=1, loop halts, completion promise emitted.
- Verify: backlog NOT ticked, log file contains diagnostics, no orphan branch created.

### Gate 5 — Crash-recovery rehearsal
- Start the run with `--max-items 1`, but kill the session (`ctrl+c`) immediately after subagent dispatch begins.
- Inspect state.json: should show `current_index=0, results=[]` (in-flight not yet recorded).
- Re-run `/run-backlog`: AskUserQuestion fires asking what to do with the in-flight item.
- Verify: choosing "abort" cleans state.json and lockfile; choosing "skip-as-fail" advances index and records a synthetic fail.

### Gate 6 — Two-item live run (FINAL gate before unattended overnight)
- Queue Slices 1–2 only (`--max-items 2 --max-fails 1`).
- These are the highest-impact slices (postgres migration + Setting/Source).
- Watch live for the first run.
- Verify: Slice 1 PR created and CLEAN, Slice 2 forks from Slice 1's branch (R3 chain mode), Slice 2 PR created and CLEAN, both green, both ticked.

### Gate 7 — Plugin gate
- ralph-loop is currently disabled per `.claude/rules/plugin-gate.md`. Re-enable: `/plugins` → enable ralph-loop → restart session. Skill setup must check that the Stop hook is actually loaded; refuse to start otherwise.

### Gate 8 — Permissions gate
- Skill setup MUST refuse to start if the active permission mode is `default` or `plan` — overnight runs require `acceptEdits` or `bypassPermissions`. Read `~/.claude/projects/-Users-egorg-Dev-house-track-house-track/settings.local.json` and verify.

### Gate 9 — Caffeine / sleep gate (manual)
- macOS: instruct the user to launch the run via `caffeinate -i claude` or pre-arm `caffeinate -i -t 28800 &`. Skill prints the exact command to copy-paste.

ONLY proceed to overnight after Gates 1–9 all pass.

---

## Critical files to read before implementing

- `.claude/skills/feature/SKILL.md` (PHASE 8 emits the completion summary the orchestrator parses; PHASE 0 manages `.claude/plans/.active`)
- `.claude/skills/feature-parallel/SKILL.md` (confirms why we forbid it in v1 — DOMAIN-SPLIT and MERGE judgment calls are wrong to delegate to a subagent overnight)
- `.claude/plans/backlog.md` (input format; Priority 2 is the target queue)
- `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/hooks/stop-hook.sh` lines 30–35 (`session_id` isolation), 60–65 (max-iterations gate), 128–141 (`<promise>` matching), 144–187 (re-feed mechanism)
- `.claude/rules/token-discipline.md` (subagent dispatch rules, fork=1 inheritance)
- `.claude/rules/plugin-gate.md` (re-enable ralph-loop)
- `.claude/rules/framework-boundary.md` (project vs framework — this skill is project-scoped)
- `.claude/rules/session-reporting.md` (banner / completion summary format the iteration body emits)

---

## Out of scope for v1 (explicit non-goals)

- **/feature-parallel under the orchestrator.** R13 — judgment calls in DOMAIN-SPLIT and MERGE are not safe to automate overnight. v1 forces /feature.
- **Auto-merging PRs.** Each /feature opens a PR; human merges in the morning after review. Non-negotiable.
- **Cross-feature replanning.** If Slice 3 reveals Slice 4's plan is wrong, orchestrator does NOT rewrite Slice 4 — it runs Slice 4 as planned, fails, halts, and waits for human triage.
- **Token / API-cost gating.** Use Claude Code's built-in limits.
- **Multi-machine / multi-session orchestration.** R11 — single session, single machine, lockfile-enforced.

---

## Resolved decisions (per user, 2026-05-02)

1. **Base mode: chain** — Slice N+1 forks from Slice N's branch (or, in
   wave mode, the merged tip of the previous wave).
2. **Failed-run PRs:** left open with a `wip:` prefix; morning triage.
3. **Token-cost telemetry in morning report:** yes (via `ccusage daily`).
4. **Within-slice parallel** decided per-slice by the preplanning safety
   gate. **Cross-slice parallel (waves):** in scope, capped at
   `--max-parallel 3`, halts on merge conflict.
5. **Retries per slice:** 2 (one initial attempt + 1 retry).
6. **Priority filter** passed as `--priority N`, refined in the
   preplanning AskUserQuestion gate. Never crosses priority sections.
7. **Models:** L0 + L1 + L2 = Opus (orchestrator, feature-runner,
   /feature planning). L3 domain-implementer = Sonnet. L3 discovery and
   helpers = Haiku. Setup aborts if L0 isn't Opus.
