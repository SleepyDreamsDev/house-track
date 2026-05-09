# Token Optimization — house-track + claude-tdd-starter (revised)

## Context

The original article (*"Claude Code: инструменты и оптимизация токенов"*,
thecode.media, 2026) gave a starting set of recommendations. Cross-checking
against Anthropic's own engineering blog ("Lessons from building Claude Code:
Prompt caching is everything", Apr 2026), official docs, and community
tooling (`ccusage`, `disler/claude-code-hooks-mastery`, ClaudeFast) surfaced
several places where the original plan was either off-target or missed
higher-leverage moves. The full cross-check lives in
`/Users/egorg/Dev/house-track/house-track/token-optimization-analysis.md`.

This revision integrates those findings. The headline corrections:

- **Cache hit % is not the right KPI for the `progress.md` trim.** Trimming
  reduces *cold-start* input cost, not *within-session* cache hit. Verification
  must measure both, with separate targets.
- **Env-var changes are the single biggest leverage** (subagent default model,
  thinking budget, suppressed background calls). Free; one file edit; ships
  to every downstream project on next sync.
- **MCP/tool-set instability** can leak more cache than `progress.md`. Audit
  before optimizing the small thing.
- **Nested `CLAUDE.md`** is net-zero or worse if sessions touch both
  domains. Gate on file-touch evidence from logs before splitting.
- **Skills (progressive disclosure)** are a higher ceiling than nested
  `CLAUDE.md` for per-domain knowledge, but lower reliability. Use both.

The intended outcome is one ship cycle that:
(1) captures a baseline, (2) lands the highest-leverage env-var defaults in
the starter, (3) cleans up house-track's actual measured leaks (not
hypothetical ones), and (4) gives the user actionable in-session signal
(cache-break detector, status line) so future drift is caught the same day.

---

## Phase 0 — Baseline (prerequisite, blocks every workstream)

Without this, "improved" is unfalsifiable. Output: one row per session
captured to `.claude/logs/baseline.md`.

1. Pick two reference workloads:
   - **A:** one full `/feature` cycle on a small change.
   - **B:** one ad-hoc 30-min exploration/debug session.
2. From `.claude/logs/token-usage.jsonl`, capture per session:
   - `total_input`, `total_output`, `cache_read`, `cache_creation`, `turns`,
     `agent_dispatches`, model breakdown.
3. Capture the **turn-1 tool/MCP list** for one session — read from the
   transcript file referenced by the Stop hook payload. Different turn-1
   counts across two sessions = conditional MCP loading = bigger leak
   than `progress.md`.
4. Save baseline numbers in `.claude/logs/baseline.md` with date and SHA
   of `CLAUDE.md` / `progress.md` / `settings.json` at capture time.

Estimated cost: 0 — uses already-collected logs.

---

## Workstream A — Project: clean up actual measured leaks

**Goal:** reduce cold-start input bill on session start.

1. **Split `.claude/progress.md`** (currently 104 lines / ~5.4 KB) into:
   - `.claude/progress.md` — under 30 lines: branch, last commit, current
     blocker (if any), "Next session" (≤3 bullets).
   - `.claude/progress-archive.md` — everything else: completed-module
     history, GraphQL discovery notes, fixture details, type-change log.
2. **Reference the archive inertly** to avoid Claude auto-following it:
   ```html
   <!-- Historical session notes are in .claude/progress-archive.md (do not auto-read) -->
   ```
   Verify after one session that the archive does not appear in the
   transcript's tool-use log.
3. **Trim root `CLAUDE.md`** (167 lines now) — target ≤80 lines. Keep:
   stack one-liner, Quick Start, command table, project-specific
   non-obvious rules (politeness budget, circuit breaker), pointer to
   nested rules.
4. **Add `.claudeignore`** (project-only first; framework template in WS-B).
   Standard contents: `node_modules/`, `dist/`, `build/`, `coverage/`,
   `.next/`, `*.lock`, `*.log`, `.git/`, `data/*.db`, `.playwright-mcp/`.
5. **Conditionally split per-domain CLAUDE.md** — gated on log evidence:
   - Grep recent transcripts to estimate file-touch overlap between `src/`,
     `prisma/`, `scripts/`.
   - If ≥80% of sessions touch only one of the three: split.
   - If sessions routinely touch multiple: keep root, do not split.
   - Default assumption from house-track shape: keep root unified for now;
     skill-extract per-domain rules instead (WS-E).
6. **Audit MCP/tool-set stability** (one-time):
   - Diff turn-1 tool list across 3 recent sessions. If any conditional
     loading exists, fix it before any other optimization — bigger lever
     than this whole plan.

**Files changed:** `.claude/progress.md`, `.claude/progress-archive.md` (new),
`.claudeignore` (new), `CLAUDE.md`. Per-domain `CLAUDE.md` files **deferred**
pending evidence.

---

## Workstream B — Framework: env-var defaults (highest ROI)

**Goal:** ship token-economy defaults to every downstream project. All edits
in `claude-tdd-starter/core/.claude/settings.json`'s `env` block.

1. **`CLAUDE_CODE_SUBAGENT_MODEL=claude-haiku-4-5`**
   Default for inherit-mode subagents. `discovery-explorer` is the canonical
   "should be Haiku" agent. ~10× cost cut on subagent dispatches.
   - Cross-check each agent file in `core/.claude/agents/*.md` for `model:`
     frontmatter. If `domain-implementer` or `reviewer` need Sonnet/Opus,
     pin them explicitly so they override the default.
2. **`DISABLE_NON_ESSENTIAL_MODEL_CALLS=1`**
   Suppresses background suggestions/tips. No behavior loss for TDD work.
3. **`MAX_THINKING_TOKENS=10000`**
   Default reserves up to ~32k. RED/GREEN/REFACTOR rarely needs more than
   10k. If `reviewer` benefits from deeper thinking, override per-agent.
4. **`CLAUDE_CODE_FORK_SUBAGENT`** — decision deferred:
   - **On** if subagents share heavy parent context (project conventions,
     files already read).
   - **Off** if they're clean exploration workers.
   - Verdict for this framework: existing `discovery-explorer` is clean
     exploration → leave **off** by default; let projects opt in.

**File changed:** `core/.claude/settings.json` (env block addition only).

---

## Workstream C — Framework: subagent output discipline + rules

**Goal:** make terse, scoped output the default for every dispatched agent.

1. **`core/.claude/agents/domain-implementer.md`** — add Output discipline:
   ```
   ## Output discipline
   - Output: diff + one-line summary per file. No prose, no alternatives,
     no next-step suggestions.
   - Tools: Read, Write, Edit, Bash, Grep, Glob. No WebFetch / WebSearch.
     Stay inside assigned worktree/domain.
   - Stop after the assigned scope.
   ```
2. **`core/.claude/agents/reviewer.md`** — add Output discipline:
   ```
   ## Output discipline
   - Findings format: severity | file:line | one-sentence issue |
     one-sentence fix. Nothing else.
   - Tools: Read, Grep, Glob, Bash (read-only). No Write/Edit.
   - Stop after review; don't fix issues yourself.
   ```
3. **`core/.claude/agents/discovery-explorer.md`** — length cap:
   ```
   ## Output discipline
   - Reports under 400 words, bullets not prose.
   - If exceeds 400 words, return top-N + a "more available, ask if
     needed" footer.
   ```
4. **New file `core/.claude/rules/token-discipline.md`** (≤80 lines):
   - Two KPIs: total input per session (cold-start cost) and
     `cache_creation` events per session (cache stability).
   - Cache-breakpoint minimums: Sonnet/Haiku 1024 tok, Opus 2048 tok —
     below these, "low cache hit %" is meaningless.
   - "Don't edit `CLAUDE.md` / `progress.md` mid-session" rule.
   - "Don't put dates/timestamps in static system prompts" — Anthropic's
     own footgun.
   - **`<system-reminder>` pattern**: when injecting "we just decided X"
     mid-conversation, do it in user message (or via Stop-hook
     `additionalContext`), never edit system prompt or `CLAUDE.md`.
   - Static-then-dynamic prompt ordering: tools → CLAUDE.md →
     session context → conversation.
   - When to invoke `/caveman`, `/clear`, `/cost`, `/context`.
   - Pointer to `ccusage` for historical analysis
     (`npx ccusage daily --instances --project <name>`).
5. **Update `core/CLAUDE.md.template`** — add Token discipline subsection
   pointing at the new rule, plus the "≤30 lines progress.md" guideline.

**Files changed:** three agents, one new rule file, one template.

---

## Workstream D — Framework hooks: actionable in-session signal

**Goal:** convert passive logging into immediate feedback the user
notices the same session.

1. **Extend `core/.claude/hooks/token-logger.sh`** (currently 80 lines):
   - **Replace** the `total_input > 50000` heuristic with the
     cache-breakpoint minimum: gate the warning on
     `(cache_read + cache_creation) > 2048` (assume Opus, since Sonnet's
     1024 is a strict subset).
   - Threshold for warning: `cache_read / (cache_read + cache_creation) < 0.7`
     (instead of cache_read / total_input — cleaner ratio).
   - Add per-call cache-break detection: walk the JSONL turns; flag any
     mid-session turn where `cache_creation_input_tokens > 1000` AFTER
     turn 3. Output:
     ```
     ⚠ cache break at turn N (created ${X} new cache tokens). Likely
       cause: edited CLAUDE.md/progress.md, switched model, or tool set
       changed.
     ```
2. **New hook `core/.claude/hooks/claudemd-size-check.sh`** — SessionStart:
   - 5-line bash. If root `CLAUDE.md` exceeds 120 lines or 4 KB, print a
     warning banner. Prevents silent drift back to bloat.
   - Wire into `settings.json` SessionStart matcher chain after
     `session-start.sh`.
3. **Defer**: `statusLine` integration. Three options exist (custom shell
   script, `ccstatusline`, `cc-statusline`). Recommend documenting in the
   token-discipline rule as opt-in; do not bake into framework default
   until a single tool wins community-wise.

**Files changed:** `token-logger.sh` (in-place edit), new
`claudemd-size-check.sh`, `settings.json` (one matcher entry added).

---

## Workstream E — Skills: progressive disclosure for per-domain rules (deferred until WS-A baseline)

**Goal:** move per-domain knowledge out of always-loaded context into
on-demand skills. ClaudeFast cites ~98% reduction for installed-but-not-
activated skills.

Candidate skills (project-only first, framework if generic enough):

- **`prisma-migration-discipline`** — triggered on `prisma/schema.prisma`
  edits or migration commands. Holds: never amend applied migration, dev
  vs deploy semantics, rename-vs-recreate rules.
- **`vitest-fixture-conventions`** — triggered on test file creation.
  Holds: fixture location, MockAgent for undici, prisma temp DB pattern.
- **`playwright-capture-session`** — triggered on `scripts/capture-*.ts`
  edits. Holds: the GraphQL capture workflow, fixture refresh steps.

**Trade-off note:** skills don't activate 100% reliably (LLM judgment).
Keep top-3 most-violated rules in `CLAUDE.md` for determinism; push the
rest into skills.

**Gate:** do this only if WS-A baseline shows `CLAUDE.md` content is the
dominant context cost. If MCP/tool stability or `progress.md` dominate,
skip until they're handled.

---

## Workstream F — Caveman auto-trigger for output-bound sessions

**Goal:** automatically engage caveman mode only when the session is
output-dominated, where caveman's ~75% output-token reduction actually pays
off. Stay silent on healthy input-dominated sessions (the common case).

**Why it's its own workstream, not folded into D:** the trigger logic
targets a narrow regime (output/input ratio elevated) and ships its own
state machine (one-shot per session, user-overridable). Mixing it into the
cache-break detector would conflate two different signals.

1. **New hook `core/.claude/hooks/caveman-autotrigger.sh`** —
   `UserPromptSubmit` event. Fires once per user turn:
   - Reads the transcript JSONL referenced in the hook payload.
   - Computes rolling `output_tokens / input_tokens` over the last 5
     assistant turns. Skip if total assistant turns < 5 (warm-up noise).
   - If ratio > 0.3 AND sentinel file
     `.claude/logs/.caveman-active-${session_id}` does not exist:
     - Emit a `hookSpecificOutput.additionalContext` payload:
       ```
       <system-reminder>
       This session is output-bound (output/input = X.XX over last 5
       turns, threshold 0.30). Switch to caveman mode for the remainder
       unless the user explicitly asks for full prose. See
       /caveman skill for format.
       </system-reminder>
       ```
     - Touch the sentinel to suppress repeat reminders this session.
   - Cleanup: a SessionStart hook stanza (or directory cron) removes
     stale sentinels older than 24h.
2. **Wire into `core/.claude/settings.json`** — new `UserPromptSubmit`
   matcher chain (event currently unused in the framework).
3. **Cancellation paths** (no extra code needed; documented in the rule
   page):
   - User says "verbose" / "explain in detail" / "no caveman" → assistant
     overrides for that turn (the `<system-reminder>` is advisory, not
     binding).
   - User can `rm .claude/logs/.caveman-active-*` to reset.

**Files changed:** `core/.claude/hooks/caveman-autotrigger.sh` (new),
`core/.claude/settings.json` (matcher entry).

**Manifest update:** register `caveman-autotrigger.sh` under `"framework"`
in both repos' `framework-manifest.json`.

**Success criteria:**

- **True positive rate**: in a manually constructed output-heavy chat
  (5+ turns of long explanations), the hook fires on or before turn 6.
- **True negative rate**: in a normal input-heavy session (file reads,
  terse questions, /feature cycle), the hook stays silent across 10+
  turns. Verify by checking sentinel file absence.
- **Single-fire**: in a session that trips the threshold, only one
  `<system-reminder>` is emitted; the sentinel suppresses the rest.
- **Override works**: after the reminder fires, the user can request
  verbose output for one turn without retriggering on the next.
- **No regression on KPI 2 (cold-start cost)** from WS-A — the hook
  reads the transcript file, not the live context, so it shouldn't
  inflate input.

**Tuning notes (post-ship):**

- 0.3 ratio is a starting heuristic. Re-tune from `token-usage.jsonl`
  after 2 weeks: pick the 75th percentile of output/input ratios across
  sessions where the user manually invoked `/caveman`.
- Window of 5 turns is similarly heuristic. Shorter window = faster
  trip; longer = more stable. Re-tune if false positives observed.

---

## Workstream G — Sync

After WS-B/C/D/F edits land in `claude-tdd-starter`:

```bash
/Users/egorg/Dev/claude-tdd-starter/framework-sync.sh pull \
  /Users/egorg/Dev/house-track/house-track
```

Then:

```bash
/Users/egorg/Dev/claude-tdd-starter/framework-sync.sh diff \
  /Users/egorg/Dev/house-track/house-track
```

Should report all CLEAN. Update both repos' `.claude/framework-manifest.json`
to register new files (`token-discipline.md`, `claudemd-size-check.sh`,
`progress-archive.md.template`) under `"framework"` so future syncs
track them.

---

## Critical files reference

| File | Repo | Workstream | Action |
|---|---|---|---|
| `.claude/logs/baseline.md` | house-track | Phase 0 | new — record measurements |
| `.claude/progress.md` | house-track | A | trim to <30 lines |
| `.claude/progress-archive.md` | house-track | A | new — archived history |
| `CLAUDE.md` | house-track | A | trim to ≤80 lines |
| `.claudeignore` | house-track | A | new |
| `core/.claude/settings.json` | starter | B | env block additions |
| `core/.claude/agents/{domain-implementer,reviewer,discovery-explorer}.md` | starter | C | Output discipline blocks |
| `core/.claude/rules/token-discipline.md` | starter | C | new rule page |
| `core/CLAUDE.md.template` | starter | C | Token discipline section |
| `core/.claude/hooks/token-logger.sh` | starter | D | breakpoint gate + cache-break detector |
| `core/.claude/hooks/claudemd-size-check.sh` | starter | D | new SessionStart hook |
| `core/.claude/progress-archive.md.template` | starter | C | new template |
| `core/.claude/hooks/caveman-autotrigger.sh` | starter | F | new UserPromptSubmit hook |
| `framework-manifest.json` | both | G | register new files |

---

## Existing utilities to reuse

- **`_var()` jq pattern** in hooks — read `framework.json` for project
  values (see `framework-boundary.md:99-105`).
- **Stop-hook chain** in `settings.json` — `token-logger.sh` must remain
  the LAST hook so its output is the final visible line.
- **`caveman` skill** — link from new rule page; do not duplicate.
- **`plugin-gate.md`** — same shape and tone for the new rule page.
- **`framework-sync.sh`** — byte-identical sync; manifest-driven.
- **`ccusage`** — adopt as documented external tool, do not rebuild.

---

## Verification (revised KPIs)

End-to-end after all workstreams ship:

1. **Sanity** (no syntax breakage):
   - `cat .claude/settings.json | jq .` — valid JSON.
   - `bash -n .claude/hooks/token-logger.sh` and
     `bash -n .claude/hooks/claudemd-size-check.sh` — parse-only.
   - One fresh Claude Code session: SessionStart hooks fire without
     error; size-check banner does not warn (CLAUDE.md is trimmed);
     progress.md banner is visibly shorter.

2. **Cold-start cost (the right KPI for WS-A):**
   - Run reference workload A and B again post-change.
   - Target: total input tokens per session **−30%** vs baseline,
     for comparable workloads.
   - Captured automatically by `token-logger.sh`.

3. **Cache stability (the right KPI for WS-B/C/D):**
   - Target: `cache_creation_input_tokens` events per session **≤ 2**
     (one at session start, one if compaction fires).
   - More than 2 = cache breaks happening; D1's per-call detector should
     flag the turn.

4. **Subagent cost cut (WS-B):**
   - Compare per-agent cost from `by_model` breakdown in JSONL log.
   - Target: subagent input tokens at Haiku price ≈ 10× cheaper for
     same dispatch count.

5. **Subagent verbosity (WS-C):**
   - Trigger `/feature` on trivial change; inspect `domain-implementer`
     output. Confirm: no prose, no "next steps," diff + summary only.

6. **Cache-break detector (WS-D):**
   - Manually edit `CLAUDE.md` mid-session as a probe. Stop hook should
     emit `⚠ cache break at turn N`.

7. **Project regression:**
   - `pnpm test` (70/70), `pnpm typecheck`, `pnpm lint`, `pnpm build`
     all green. None of these changes touch runtime code.

8. **Sync clean:**
   - `framework-sync.sh diff` reports all CLEAN after pull.

If KPI 2 (cold-start −30%) misses, re-scope to MCP/tool-set audit
(WS-A step 6) — the dominant cost is likely outside auto-injected
markdown.

---

## Out of scope / explicitly deferred

- **PreToolUse tool-restriction blocker** — over-engineering until
  logs show policy violations.
- **`claude-mem` / `everything-claude-code` plugin install** — duplicates
  existing memory layer.
- **`claude-code-cache-fix` proxy** — adds infrastructure dependency for
  marginal gain; revisit if KPI 3 misses.
- **`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`** — overkill for current
  workload scale.
- **`statusLine` integration** — recommend in docs (WS-D point 3) but do
  not bake in; opt-in until community converges on one tool.
- **Per-domain CLAUDE.md split (WS-A step 5)** — deferred behind log
  evidence; default to skill extraction (WS-E) instead.
- **`/clear-helper` skill** — existing CLAUDE.md note ("/compact after
  each phase") plus the new rule page should suffice; revisit if metrics
  show user friction.

---

## Plan-file location note

This plan was written to `~/.claude/plans/` because Plan-mode's system
reminder pinned that path. User feedback memory says plans should live
in the project's `.claude/plans/`. After plan exit, copy to
`/Users/egorg/Dev/house-track/house-track/.claude/plans/token-optimization.md`
and treat that as the canonical location.
