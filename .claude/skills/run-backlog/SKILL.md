---
name: run-backlog
description: >
  Overnight orchestrator that drives /feature across many backlog items
  unattended via the ralph-loop Stop hook. Each iteration runs ONE wave of
  slices (one or more in parallel), gates on per-wave merge + tests, and
  exits cleanly. Use when the user runs `/run-backlog` to chew through the
  Priority N section of `.claude/plans/backlog.md` overnight.
command: /run-backlog
argument-hint: "[--priority N] [--budget 6h] [--max-fails 2] [--max-items N] [--retries-per-slice 2] [--max-parallel 1] [--base-mode chain|main] [--rehearsal] [--dry-run]"
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, TodoWrite, Agent, Skill
---

# /run-backlog — Overnight Orchestrator

Orchestrate `/feature` across `## Priority N` of
`.claude/plans/backlog.md`. Detailed plan + R1–R25 risk register live at
`.claude/plans/run-backlog-skill.md` — read once on first invocation;
ralph iterations re-feed only the body below. **First read**
`.claude/framework.json` for `TYPECHECK_CMD` / `TEST_CMD_ALL`.

## Argument defaults

| Flag                  | Default | Notes                                        |
| --------------------- | ------- | -------------------------------------------- |
| `--priority N`        | `2`     | which `## Priority N` section to walk        |
| `--budget`            | `6h`    | wall-clock cap, checked at iteration start   |
| `--max-fails`         | `2`     | consecutive wave failures before halt        |
| `--max-items`         | unset   | hard cap on slices attempted                 |
| `--retries-per-slice` | `2`     | initial + 1 retry                            |
| `--max-parallel`      | `1`     | wave width cap (R23). Default serial.        |
| `--base-mode`         | `chain` | `chain` forks each wave from prior tip       |
| `--rehearsal` / `--dry-run` | off | Gates 3 / 2; see "Mode flags"            |

## PHASE 0a — Pre-flight (first invocation only)

Detect first invocation by `[ ! -f .claude/run-backlog/state.json ]`. If
state.json already exists, skip to "Resume detection" at the bottom.

Run these checks in order. ANY failure → abort with a clear banner. Do
not write state files on failure.

1. **R25 — Model gate.** If active model isn't Opus, abort. The
   orchestrator's DAG/merge decisions degrade silently on weaker models.
2. **R15 — Permission gate (Gate 8).** Read
   `.claude/settings.local.json` first, then fall back to
   `.claude/settings.json`. If `permissionMode` is **explicitly** set to
   `default` or `plan`, abort with the message "overnight runs require
   `acceptEdits` or `bypassPermissions`." If the field is missing or
   files don't exist, proceed with a one-line WARN: the mode likely
   comes from a CLI flag or env var, which the loop can't introspect
   — an interactive prompt could stall the run.
3. **Plugin gate (Gate 7).** If `~/.claude/plugins/.../ralph-loop/...`
   isn't installed/enabled, abort: tell user to enable ralph-loop via
   `/plugins` and restart the session.
4. **R1, R14, R16 — clean slate.** Parallel: `git status --porcelain`
   empty; `[ ! -f data/.circuit_open ]`; `git worktree prune`; `rm -f
   .claude/plans/.active`.
5. **R11 — Lockfile (liveness check is strict; partial passes count as
   STALE so PID-reuse can't masquerade as live).**
   `mkdir -p .claude/run-backlog`. If `.claude/run-backlog/.lock`
   exists, classify it via ALL of these tests — a single failure means
   STALE, do not "fail open" by accepting a partial pass:
   - shape: file is exactly 3 lines `session_id\npid\nstarted_at`;
   - pid parses as a positive integer;
   - `kill -0 $pid` succeeds (PID still in the process table);
   - `ps -p $pid -o command= 2>/dev/null` (FULL command line, not just
     `comm`) contains the literal substring `claude` (case-insensitive).
     Match the **full args** rather than the binary basename: `comm`
     alone returns just `node` for Claude Code installs that exec
     `node /path/to/claude.js`, which would falsely accept any random
     Node.js process (build daemon, MCP server, unrelated CLI) that
     happened to inherit the recycled PID. The full command line of a
     real Claude Code process always contains `claude` somewhere
     (binary path, script path, or argv[0]); a generic `node` build
     does not.

   Decision:
   - STALE (any test fails) → clear the lock and proceed.
   - LIVE + same `session_id` as this one → same-session re-acquire
     (e.g. user re-invokes `/run-backlog` after a partial PHASE 0a in
     this same session); rewrite the lock with this pid + new
     started_at and proceed.
   - LIVE + different `session_id` → ABORT (real concurrent run; refuse
     to multiplex). Print both pids/sessions so the user can decide.

   Atomically write the new lock with
   `<this session_id>\n<this pid>\n<started_at>`.
6. **R20 / stall-watchdog (self-bootstrapping).** Closes the
   in-flight-stall gap — no native Agent-tool timeout means a wedged
   subagent hangs forever without an external killer. The orchestrator
   ensures a watchdog is alive before dispatch; it does NOT require the
   user to launch a wrapper.

   Detect existing watchdog:
   - env var `RUN_BACKLOG_WATCHDOG=1` set AND
     `.claude/run-backlog/.watchdog.pid` exists AND `kill -0 $(cat …)`
     succeeds → already gated, proceed.

   Otherwise self-bootstrap: dispatch the loop below via `Bash` with
   `run_in_background: true`. From inside a Bash tool invocation,
   `$PPID` is claude's real PID, so the watchdog can `kill -TERM` it
   directly when stalled:
   ```bash
   mkdir -p .claude/run-backlog
   CLAUDE_PID=$PPID
   echo $CLAUDE_PID > .claude/run-backlog/.claude.pid
   ME=$$
   echo $ME > .claude/run-backlog/.watchdog.pid
   trap 'rm -f .claude/run-backlog/.watchdog.pid .claude/run-backlog/.claude.pid' EXIT
   while sleep 60; do
     # Self-evict if a newer watchdog took over (handles double-bootstrap
     # or SIGKILLed predecessors whose trap never ran).
     [ "$(cat .claude/run-backlog/.watchdog.pid 2>/dev/null)" = "$ME" ] || exit
     # Exit if claude itself is gone (no point watching a dead parent).
     kill -0 $CLAUDE_PID 2>/dev/null || exit
     [ -f .claude/run-backlog/state.json ] || continue
     AGE=$(( $(date +%s) - $(stat -f %m .claude/run-backlog/state.json) ))
     [ $AGE -gt 1800 ] && { kill -TERM $CLAUDE_PID; exit; }
   done
   ```
   After spawn, verify the pidfile exists and `kill -0` succeeds. If
   verification fails twice, abort with a clear error pointing at the
   external wrapper as a fallback. Self-bootstrapping does NOT prevent
   macOS sleep — for **unattended overnight** runs, prefer the external
   wrapper (see "Unattended overnight wrapper" below) so `caffeinate`
   can keep the machine awake.

   Recovery: stalled >30min → watchdog `kill -TERM`s claude directly →
   trap cleans pidfiles → `state.json` survives → next `/run-backlog`
   invocation hits the Resume AskUserQuestion path.

   **The same gate fires on Resume** — see "Resume" section below.

### Unattended overnight wrapper (optional, recommended for overnight)

For unattended overnight runs, launch claude under this wrapper so
`caffeinate` prevents sleep. Self-bootstrapping handles stall-detection
either way; the wrapper just adds sleep-prevention.
```bash
mkdir -p .claude/run-backlog
caffeinate -i -t 28800 &
CAFFEINATE_PID=$!
RUN_BACKLOG_WATCHDOG=1 claude &
CLAUDE_PID=$!
echo $CLAUDE_PID > .claude/run-backlog/.claude.pid
( ME=$BASHPID
  echo $ME > .claude/run-backlog/.watchdog.pid
  while sleep 60; do
    [ "$(cat .claude/run-backlog/.watchdog.pid 2>/dev/null)" = "$ME" ] || exit
    [ -f .claude/run-backlog/state.json ] || continue
    AGE=$(( $(date +%s) - $(stat -f %m .claude/run-backlog/state.json) ))
    [ $AGE -gt 1800 ] && { kill -TERM $CLAUDE_PID; exit; }
  done
) & WATCHDOG_PID=$!
trap 'kill $WATCHDOG_PID $CAFFEINATE_PID 2>/dev/null;
      rm -f .claude/run-backlog/.{claude,watchdog}.pid' EXIT
wait $CLAUDE_PID
```
7. **`.gitignore` self-check.** `.claude/run-backlog/` and
   `.claude/ralph-loop.local.md` must be ignored. Else add them now.

## PHASE 0b — Preplanning (the only PAUSE in the entire flow)

1. Parse `.claude/plans/backlog.md` per the parser rules in the plan
   doc (regex `_Run via \`(/feature(-parallel)?)\`._`, plan_path regex,
   `description_sha = sha256(stripped description)`). Walk only the
   `## Priority N` section. Skip already-`[x]` items.
2. For each candidate, apply the 6-rule **safety gate** from the plan
   (lines 412–440) to classify command. **v1 collapses ALL to `/feature`
   regardless** (R13) but record the original annotation and the rule
   that fired in `state.preplanning[sha].decision_reason`.
3. **Build the wave DAG.** Edges: explicit "depends on slice N" mentions
   in plan bodies, file-scope overlap with prior unmerged slices, and
   the cohort hint from `_Run via /feature-parallel with N, M_`
   annotations (treat cohort as one wave when no edges contradict).
   Topological sort → levels → waves. Cap each wave at `--max-parallel`.
4. **AskUserQuestion approval.** Present:
   - the priority section being walked,
   - the wave plan as `[Wave 1: SliceA → Wave 2: SliceB+SliceC → ...]`,
   - any safety-gate downgrades from `/feature-parallel` to `/feature`,
   - estimated cost rollup (~$25/night per plan §"Model policy").

   Options: **Approve** / **Reject** / **Edit priority filter**.
5. On approval: write `.claude/run-backlog/state.json` with
   `schema_version: 2` and the preplanning DAG; write
   `.claude/ralph-loop.local.md` with the frontmatter and verbatim
   iteration-body prompt below.

## Mode flags

- `--dry-run` (Gate 2): PHASE 0b parse + DAG + safety-gate, print wave
  plan + decision_reason, exit. No state files, no dispatch.
- `--rehearsal` (Gate 3): pass `REHEARSAL: true` in every Boundary-1
  prompt. feature-runner invokes `/feature --no-ship --rehearsal`, which
  commits locally but skips push, PR creation, and merge. Orchestrator
  post-flight skips the `gh pr view` check. Cleanup:
  `git branch -D feature/<slug> && rm -rf .claude/run-backlog/<ts>`.

**Always-on `/feature` contract**: feature-runner ALWAYS passes
`--no-ship` (no auto-merge, no in-`/feature` backlog tick). Orchestrator
owns merge timing (human, morning) and backlog state.

## ralph-loop.local.md frontmatter

```yaml
iteration: 0
max_iterations: <eligible_count * (retries_per_slice + 1) + 2>
completion_promise: "house-track overnight run complete"
session_id: <CLAUDE_CODE_SESSION_ID>
```
(wrap with `---` lines.) `max_iterations` ≠ 0 (R12); `+2` covers final
drained tick + safety margin.

## Iteration body (verbatim — written to ralph-loop.local.md after the second `---`)

This text MUST be byte-identical between this SKILL.md and the
`.claude/ralph-loop.local.md` that gets written. The Stop hook re-feeds
it verbatim every iteration.

```
You are one wave of /run-backlog (an Opus orchestrator). Read .claude/run-backlog/state.json
and .claude/run-backlog/.lock first. ABORT silently if lockfile.session_id
!= $CLAUDE_CODE_SESSION_ID. EXIT if ANY of: .stop exists, budget exceeded, consecutive_fails >=
max_fails, or no eligible items remain. Before the promise, output a
concise final kaizen banner (≤8 lines): wave count, pass/fail counts,
top 3 deduped Workflow-delta items, ccusage total. Then:
<promise>house-track overnight run complete</promise>.

Recovery: if state.in_flight is non-null, run the in-flight handover
decision tree from .claude/plans/run-backlog-skill.md (lines 654–664):
record a synthetic fail entry, increment consecutive_fails, clear
in_flight, then proceed to next iteration.

Wave selection: re-parse .claude/plans/backlog.md from scratch. Find
eligible "- [ ]" items in Priority <N> whose description_sha is NOT in
state.results with last status=success AND retry count < retries_per_slice.
Build current wave from state.preplanning DAG: items with all deps
satisfied, capped at max_parallel.

Wave pre-flight (HALT loop on any failure):
1. git worktree prune; rm -f .claude/plans/.active
2. git status --porcelain must be empty (else git stash push -u -m
   "run-backlog-fail-<ts>"; record fail; halt)
3. [ ! -f data/.circuit_open ] (else halt)
4. git checkout <wave_base> (chain-mode: prior wave's merged tip;
   main-mode: main); git pull --ff-only
5. Run TYPECHECK_CMD (from .claude/framework.json). Must pass.
6. Snapshot HEAD as commit_pre. Set state.in_flight = {wave members}.

Dispatch wave (single response, ONE Agent block with N tool_uses for
parallel waves; sequential for max_parallel=1):
  Agent(subagent_type: "feature-runner", model: "opus",
        isolation: "worktree" if max_parallel > 1 else unset,
        prompt: <Boundary-1 contract: ROLE/SLUG/DESCRIPTION/PLAN_PATH/
                 BASE_BRANCH/COMMIT_PRE/RUN_ID/REHEARSAL>)
Wait for ALL returns.

Wave post-flight (per slice, then per wave):
- Parse each slice's JSON contract. If missing/malformed → status=fail,
  fail_phase="handover" (defensive parsing table in plan).
- Override status=success → fail when: commit==commit_pre (R7), or
  pr_number==null in non-rehearsal (R10), or scope_violations non-empty,
  or output contains literal "<promise>" string.
- Per-slice gh pr view <num> --json mergeable,mergeStateStatus must
  report MERGEABLE; mergeStateStatus in {CLEAN, BLOCKED} OK (R5).
- For each successful slice, lex order: git checkout <wave_base>;
  git merge --no-ff <slice_branch>. On conflict: git merge --abort;
  mark all wave members as merge_conflict; HALT (R21).
- Run TYPECHECK_CMD + TEST_CMD_ALL on merged tip. Red → HALT (R21).
  Green → merged tip = next wave's base.

Record:
- Append per-slice entries to state.results (drop kaizen_summary — keep
  state.json small; raw kaizen lives in the per-slice log).
- Write .claude/run-backlog/<RUN_ID>/<slug>.md per slice; include the
  verbatim kaizen_summary block from feature-runner's JSON.
- For each success: tick [x] in backlog.md by description_sha lookup
  (R6: log WARN and skip tick if sha not found).
- Kaizen: /feature's "Auto-implemented" items already committed inside
  the slice — no work. NEVER auto-apply "Workflow delta" mid-run (cache
  hygiene + framework-file edit ban). Append each delta line, deduped,
  to kaizen-rollup.md. Append every entry from the JSON's
  sync_candidates field, deduped, to sync-rollup.md (structured field,
  not transcript-scraping — works under worktree isolation). Treat any
  "WARN missing-sync-banner" entry as orchestrator-visible: append it
  to MORNING_REPORT.md's "Action items" section so the human knows a
  slice modified framework files without /feature emitting the banner.
- consecutive_fails: reset to 0 if any wave member succeeded; else
  += wave size.
- Rewrite .claude/run-backlog/<RUN_ID>/MORNING_REPORT.md (run summary,
  per-slice table, action items, stash list, ccusage rollup, next-step
  commands; include a "Kaizen rollup" section that lists deduped
  Workflow-delta lines from all slices).

Output ONE line per slice to the parent: "iteration <N> wave <W> slice
<slug>: success|fail (<reason>)". Nothing else. Then exit normally.
```

## Resume (state.json already exists at invocation)

**Watchdog gate applies here too.** Any branch that would (re)write
`.claude/ralph-loop.local.md` and start the loop MUST first re-verify
the gate from PHASE 0a step 6 (env var + live `.watchdog.pid`). The
**Inspect** and **Abort** branches are read/cleanup only, no loop
launch — they bypass the gate so the user can triage stale state from
any session.

- Same session_id (re-invoked inside the live wrapped session): gate
  passes (the original watchdog from the launch is still alive); rewrite
  ralph-loop.local.md from preserved state and exit (Stop hook re-fires).
- Stale session_id → AskUserQuestion: **Resume** / **Abort** (clear
  state, lock, .active, .claude.pid) / **Inspect** (print last
  MORNING_REPORT path). On **Resume**: (a) re-verify gate; if it
  fails, self-bootstrap a watchdog per PHASE 0a step 6 (same logic).
  (b) **Re-acquire `.lock`** by running
  the **same strict liveness routine from PHASE 0a step 5** (shape +
  integer pid + `kill -0` + `ps -p $pid -o command=` contains literal
  `claude` — NOT `comm` and NOT `node` alone, those false-accept
  unrelated Node.js processes that inherited a recycled PID). STALE → clear
  and rewrite. LIVE + this session_id → rewrite (own lock, just
  reasserting). LIVE + different session_id → ABORT (do not silently
  steal another session's live lock — fail-open guard). Without this
  rewrite on a stale lock, the iteration body's
  `lockfile.session_id != $CLAUDE_CODE_SESSION_ID` check aborts every
  iteration silently and the loop dead-ends.
  (c) **Rewrite `.claude/ralph-loop.local.md` frontmatter** with the
  current session_id so the ralph Stop hook also recognises this
  session. Then write the iteration-body prompt and exit.
  No auto-resume after a crash.

## Out of scope (v1)

`/feature-parallel` under the orchestrator (R13). Auto-merging PRs to
main (human merges in the morning). Cross-feature replanning (a failed
slice halts; loop never rewrites downstream plans).
