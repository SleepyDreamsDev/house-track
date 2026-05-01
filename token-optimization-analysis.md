# Token Optimization — Plan Analysis & Cross-Check Suggestions

> Companion document to the original `Token Optimization — house-track + claude-tdd-starter` plan.
> Purpose: validate the plan against current Anthropic guidance and community consensus,
> then propose additional candidates to cross-check against the existing TDD-starter framework.
>
> Sources surveyed (Apr–May 2026): Anthropic engineering blog on Claude Code prompt caching;
> Claude Code official docs (best-practices, hooks, subagents, skills, statusline);
> community guides (Build to Launch, ClaudeFast, ClaudeLog, MindStudio, claudecode-lab);
> community tooling (`ccusage`, `ccstatusline`, `claude-code-cache-fix`, `everything-claude-code`,
> `claude-token-efficient`, `disler/claude-code-hooks-mastery`).

---

## 1. Analysis of the existing plan

### 1.1 What's solid (validated by sources)

- **Split `progress.md` + hierarchical `CLAUDE.md`.** Both validated. Anthropic's docs explicitly
  endorse nested `CLAUDE.md` per subdirectory. Multiple community guides cite trimming the
  auto-injected payload as the single biggest first-turn win.
- **"Don't edit `CLAUDE.md`/`progress.md` mid-session" rule.** This is the single most important
  rule and the plan correctly identifies it. Directly confirmed by Anthropic's engineering blog
  (Thariq Shihipar, Apr 30 2026): _"any change anywhere in the prefix invalidates everything
  after it … we run alerts on our prompt cache hit rate and declare SEVs if they're too low."_
- **Cache-hit threshold at 70%.** Conservative but reasonable. Real Claude Code sessions
  reportedly hit 90–96%; 70% is a "something's clearly wrong" floor, not an aspirational target.
- **Output-discipline blocks in subagent prompts.** Matches Anthropic's official `code-reviewer`
  subagent example, which explicitly limits tools to read-only and constrains output format.
- **Per-agent tool surface restrictions.** Aligned with the docs: _"Enforce constraints by
  limiting which tools a subagent can use."_
- **Token-discipline rule page consolidating guidance.** Sensible — keeps `CLAUDE.md` small
  while preserving the knowledge.

### 1.2 Where the plan is weak or risky

1. **Premise drift between "cache hit" and "first-turn cost."**
   Trimming `progress.md` reduces the _cold-start_ input bill on every session start, but it
   doesn't directly improve the **within-session cache hit rate**. Cache hit % is a function
   of _prefix stability across turns_, dominated by whether anything in the cached prefix
   changes mid-session. The verification step's "≥10pp higher cache hit rate" target may not
   pan out if the project already wasn't editing `CLAUDE.md` mid-session. The trim's actual
   KPI is _"lower total input tokens per session,"_ not _"higher cache hit %."_

2. **The 70% threshold + `input > 50000` gate is a heuristic guess.**
   The right floor is the cache-breakpoint minimum: Sonnet/Haiku need 1,024 tokens before a
   breakpoint; Opus needs 2,048. Below that, the cache is silently bypassed and a low "hit %"
   is meaningless. Use those as the noise gate rather than 50k.

3. **No mention of tool/MCP-set stability.**
   Per Anthropic: _"Changing the tool set in the middle of a conversation is one of the most
   common ways people break prompt caching."_ If house-track has any conditional MCP loading
   or changes its server list across sessions, that's a bigger leak than `progress.md`.

4. **`scripts/CLAUDE.md` may be wasteful.**
   Nested `CLAUDE.md` only auto-loads when Claude reads a file in that subdir. For `scripts/`
   (occasional Playwright capture), that's fine. But check that `prisma/CLAUDE.md` actually
   triggers — if Claude's typical work touches both `src/` and `prisma/` per session, you've
   split one 167-line file into two ~80-line files that _both_ end up in context, which is
   net-zero or worse.

5. **Workstream C step 1 contains a bug Egor caught but left in the document.**
   The "Wrong direction" aside reads as draft notes. Either delete the wrong direction or
   move it to an appendix; leaving it inline invites confusion when this plan is shared.

6. **No `.claudeignore`.**
   Trivial one-liner that prevents glob/grep tools from scanning `node_modules/`, `dist/`,
   `coverage/`, `*.lock`, `.next/`, etc. Every guide cites this as a one-time setup win.
   The plan misses it entirely.

7. **No use of skills for progressive disclosure.**
   Several items going into `src/CLAUDE.md` (TS strict, ESM `.js` suffix rules, fixture
   conventions) are exactly the shape of a Claude Code skill: only loaded when relevant.
   Anthropic's own data: ~98% token savings on installed-but-not-activated skills. The plan
   keeps everything as `CLAUDE.md`-style instructions, which all loads upfront.

8. **No subagent model override.**
   The framework already has agents (`discovery-explorer`, `domain-implementer`, `reviewer`).
   None need Opus or Sonnet for what they do — Haiku handles search/exploration well.
   `CLAUDE_CODE_SUBAGENT_MODEL=claude-haiku-4-5` in `.claude/settings.json` `env` would cut
   subagent costs ~10× without changing any prompt.

9. **`token-logger.sh` could surface cache-break events, not just session totals.**
   A jump in `cache_creation_input_tokens` between two API calls in the same session means
   the cache broke. That's the actionable signal — the user can correlate it with what they
   just did. Reporting only end-of-session aggregates loses that signal.

10. **Status line not used.**
    Egor already has the metric infrastructure (`token-logger.sh`). The same data is exposed
    live via the `statusLine` hook (`current_usage.cache_read_input_tokens` etc.). Showing
    context % and cache hit continuously is a much stronger feedback loop than a Stop-hook
    line nobody reads after they close the session.

11. **`progress-archive.md` referenced from `progress.md` is a footgun.**
    If the reference is ever rendered as a path in `progress.md` and Claude follows it
    ("see archive for full session history"), the archive gets pulled into context anyway.
    The reference text needs to be inert (e.g., a comment, not a path).

---

## 2. Additional practices from research

### 2.1 Authoritative — from Anthropic

| Practice                                                                   | Notes                                                                                                                                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Static-then-dynamic prompt ordering**                                    | Recommended layout: static system prompt + tools → `CLAUDE.md` → session context → conversation. Order matters because cache is prefix-match.                               |
| **Use `<system-reminder>` tags in user messages, not system-prompt edits** | When you need to inject "we just decided X" mid-conversation, never edit the system prompt — append in the user turn.                                                       |
| **Don't put dates/timestamps in static system prompts**                    | Anthropic explicitly cites this as a cache-break they shipped and had to fix internally.                                                                                    |
| **Fork mode for subagents**                                                | `CLAUDE_CODE_FORK_SUBAGENT=1` makes subagents inherit the parent's cached prefix on their first request. Cheaper than fresh subagent dispatch when context is shared.       |
| **Compaction is now an API feature**                                       | As of April 2026, Anthropic shipped cache-safe compaction directly in the API. If anything in the framework wraps direct API calls, use it.                                 |
| **Skill content compaction-survives**                                      | When auto-compact fires, recently-invoked skills are re-attached up to 5k tokens each, capped at 25k combined. Older skills get dropped. Skill ordering by recency matters. |
| **Cache-breakpoint minimums**                                              | Sonnet/Haiku: 1,024 tokens. Opus: 2,048 tokens. Below the threshold, the breakpoint is silently ignored. Useful as a noise gate in `token-logger.sh`.                       |

### 2.2 Strong community consensus

| Practice                                    | Source                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`.claudeignore`**                         | Build to Launch, MindStudio, multiple Medium articles. Top-of-list one-time setup.                                                                                                                             |
| **`CLAUDE.md` ≤ 500 tokens**                | Build to Launch, ClaudeFast. Some say up to 200 lines. The plan's trimmed root will be borderline (~80 lines after extraction). Worth a target.                                                                |
| **Skill architecture for domain knowledge** | ClaudeFast claims ~15k tokens/session recovered with progressive disclosure across 20+ skills vs. CLAUDE.md-everything. Anthropic engineering blog confirms 98% reduction for installed-but-not-active skills. |
| **`/btw` for ephemeral questions**          | Official docs: answer appears in dismissible overlay, never enters conversation history. Useful for "is this regex right?"                                                                                     |
| **`DISABLE_NON_ESSENTIAL_MODEL_CALLS=1`**   | Suppresses background model calls (suggestions, tips). Mentioned in everything-claude-code and ClaudeFast.                                                                                                     |
| **`MAX_THINKING_TOKENS` lowered**           | Default reserves up to ~32k output tokens. Lower to 10k or 0 for routine tasks. ~70% cut on hidden cost.                                                                                                       |
| **Subagent default model = Haiku**          | `CLAUDE_CODE_SUBAGENT_MODEL=claude-haiku-4-5`. Universal recommendation for explore/search subagents.                                                                                                          |
| **`/cost` and `/context` slash commands**   | Built-in. Should be in any token-discipline rule page as a "check yourself" reflex.                                                                                                                            |
| **`ccusage` CLI for historical analysis**   | The de facto community tool. `npx ccusage daily --instances --project house-track` would give Egor exactly the per-project rolling view his plan currently lacks.                                              |

### 2.3 Useful but lower-priority

| Practice                                                       | Notes                                                                                                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom `statusLine` showing context % and cache hit % live** | Same data the Stop hook already extracts, surfaced continuously. `cc-statusline`, `ccstatusline`, `claude-code-usage-bar` all do this. Or a 60-line custom shell script.                                  |
| **PreToolUse hook to format/lint after Edit/Write**            | Reduces follow-up "fix the lint" turns. Already standard in many setups.                                                                                                                                  |
| **PreToolUse blocker for `.env` / sensitive files**            | Plan correctly notes this is over-engineering for now, but useful baseline.                                                                                                                               |
| **Output styles for terse responses**                          | An alternative to embedding output discipline in each agent file. One global output-style "terse-coder" applied as default. Trade-off: less per-agent control.                                            |
| **`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`**                   | For workflows needing parallel sustained context. Almost certainly overkill for SubTracker / house-track scale.                                                                                           |
| **`claude-code-cache-fix` proxy**                              | Third-party proxy claiming to stabilize the request prefix. v3.0.3 reports 95.5% vs 82.3% direct on first warm turn. Probably overkill, but exists. Don't adopt blindly — adds infrastructure dependency. |
| **`disler/claude-code-hooks-mastery` patterns**                | Reference implementation showing all hook events with TTS, logging, validation. Good to mine for ideas.                                                                                                   |

---

## 3. Suggestions to cross-check against the existing framework

Each is a candidate, not a directive. Tagged by where it'd land
(**project** = house-track only; **framework** = `claude-tdd-starter` + sync down)
and by effort (**S/M/L**).

### S1. Add `.claudeignore` to framework template — _framework, S_

One file, sync-able. Standard contents: `node_modules/`, `dist/`, `build/`, `coverage/`,
`.next/`, `*.lock`, `*.log`, `.git/`.

**Cross-check:** does the existing framework already have a `.gitignore`-derived equivalent
or any glob-restriction mechanism? If yes, skip. If no, free win.

### S2. Reframe the verification KPI — _project, S_

Replace "cache hit rate ≥10pp" with two metrics:

- (a) **total input tokens per session** for a representative workload, target −30%
- (b) **`cache_creation_input_tokens` events per session**, target ≤2 (one at session start,
  one if compaction fires)

Cache hit % is downstream of these and not a clean signal on its own.

### S3. Use cache-breakpoint minimums as the warning gate — _framework, S_

In `token-logger.sh`, gate the warning on `(cache_read + cache_creation) > 2048` (Opus) or
`> 1024` (Sonnet/Haiku) instead of `total_input > 50000`. Below the breakpoint minimum,
"low cache hit" is a measurement artifact, not a problem.

### S4. Audit MCP server set for stability — _project, S_

List enabled MCP servers in house-track. Confirm none load conditionally based on file path
or environment. If any do, that's likely a bigger cache leak than `progress.md`.

**Cross-check:** does the framework's `framework.json` or `settings.json` have any conditional
MCP loading?

### S5. Set `CLAUDE_CODE_SUBAGENT_MODEL=claude-haiku-4-5` in framework — _framework, S_

Default for inherit-mode subagents. The framework's `discovery-explorer` is the canonical
"this should be Haiku" agent — it does grep/read/summarize.

**Cross-check:** do any existing agents have `model:` frontmatter that would override this?
If `domain-implementer` needs Sonnet/Opus, set it explicitly in its frontmatter; otherwise
it inherits.

### S6. Set `DISABLE_NON_ESSENTIAL_MODEL_CALLS=1` in framework `settings.json` — _framework, S_

Suppresses background suggestions/tips. Doesn't change core behavior. Trivial one-line
addition to the env block.

### S7. Lower `MAX_THINKING_TOKENS` for default workloads — _framework, S_

Set to `10000` for general use. The TDD framework's typical RED/GREEN/REFACTOR work doesn't
need 32k of extended thinking.

**Cross-check:** does anything in the framework explicitly request extended-thinking depth?
If `reviewer` benefits from deep thinking, override per-agent.

### S8. Convert select per-domain rules to skills — _project + framework, M_

Candidates that fit the skill mold (loaded only when relevant):

- `pest-test-writing` (TDD test patterns) — triggered when files in `tests/` are touched
- `prisma-migration-discipline` — triggered on `prisma/schema.prisma` edits
- `playwright-capture-session` — triggered on `scripts/capture-*.ts`

This is the "82% recovery" lever from ClaudeFast's claim. **Trade-off:** skills don't
trigger 100% reliably; CLAUDE.md is more deterministic. Keep top-3 most-violated rules in
`CLAUDE.md`, push the rest into skills.

**Cross-check:** does the framework already have a skills directory pattern, and is there
a sync convention for skills similar to agents?

### S9. Promote `token-logger.sh` to also warn on cache-break events — _framework, M_

Track per-API-call deltas in `cache_creation_input_tokens` from the JSONL log. When a single
call shows `cache_creation > 1000` in the middle of a session (after the first 2–3 turns),
emit a one-liner:

```
⚠ cache break at turn N (created ${X} new cache tokens).
  Likely cause: edited CLAUDE.md/progress.md, switched model, or tool set changed.
```

This is the actionable signal Egor's monitoring is currently missing.

### S10. Add `statusLine` config to framework template — _framework, M_

Either:

- (a) a 60-line custom shell script showing `branch | model | context% | cache_hit%` from
  the stdin JSON, or
- (b) recommend `ccstatusline` / `cc-statusline` as an optional add-on

**Cross-check:** does the framework already have a `statusLine` entry in
`settings.json.template`? If yes, augment; if no, add as opt-in.

### S11. Make `progress-archive.md` reference inert — _project, S_

In the trimmed `progress.md`, write the pointer as a plain comment, not a path:

```html
<!-- Historical session notes are in .claude/progress-archive.md (do not auto-read) -->
```

Verify by checking that the archive doesn't appear in the next session's tool-use log.

### S12. Add `ccusage` to the framework's recommended tooling docs — _framework, S_

Link from the new `token-discipline.md` rule page.
`npx ccusage daily --instances --project <name>` gives the rolling-window view the plan
currently builds in-house. No reason to reinvent it.

**Cross-check:** any conflict with the existing token-logger JSONL format? `ccusage` reads
the standard Claude Code JSONL location, not the custom log, so no conflict — they coexist.

### S13. Add a CLAUDE.md size check to SessionStart hook — _framework, S_

Five lines of bash: warn if root `CLAUDE.md` exceeds, say, 120 lines or 4 KB. Prevents
silent drift back to bloat.

**Cross-check:** SessionStart hook already exists per the plan's reference to `progress.md`
injection — this is just one more stanza.

### S14. Move the WS-C "wrong direction" aside out of the plan — _project, S_

Editorial. The current plan reads as draft notes when shared. Either delete the false start
or relegate it to an "appendix: things that look right but aren't" section.

### S15. Don't split nested CLAUDE.md unless empirically warranted — _project, S_

Before creating `prisma/CLAUDE.md` and `scripts/CLAUDE.md`, check the file-touch pattern of
recent SubTracker / house-track sessions. If 80% of sessions touch both `src/` and `prisma/`,
splitting is net-zero (both load anyway). If sessions are clearly split by domain, do the
split. Cheap to verify by `grep`-ing recent transcripts.

### S16. Add `<system-reminder>` pattern to framework rule page — _framework, S_

Document this in `token-discipline.md`: when you need to convey "we just decided X"
mid-conversation, do it in the user message, never by editing `CLAUDE.md`. This is what
Anthropic does internally and the rule's not in any community guide surveyed — would be a
differentiator for the starter.

### S17. Consider skipping the manual cache-hit warning entirely if `ccusage` is adopted — _framework, S_

If S12 lands, `ccusage session` already gives per-session cache hit. The Stop-hook warning
becomes redundant. Decide whether `token-logger.sh` should slim down to just the in-session
cache-break detector (S9) and let `ccusage` handle aggregates.

---

## 4. Three things to verify before any of this lands

1. **Pre-change baseline.**
   Grab one full SubTracker `/feature` session and one ad-hoc 30-min session from the
   existing `.claude/logs/token-usage.jsonl`. Capture: total input, total output, cache_read,
   cache_creation, turn count. Without this, "improved" is unfalsifiable.

2. **`CLAUDE_CODE_FORK_SUBAGENT` decision.**
   If subagents in this framework share heavy parent context (project conventions, file
   context already read), enabling fork mode is a win. If they're true exploration workers
   that should start clean, leave it off. The framework's existing agent docs should make
   this explicit.

3. **Tool-set audit across SessionStart.**
   Before/after the trim, capture the exact tool list passed to the API on turn 1 of a
   session. Different counts = something in the framework loads conditionally. That's a
   more important fix than `progress.md`.

---

## 5. Priority shortlist

If only a few things ship, these are the highest-leverage:

- **S1** (`.claudeignore`) — free win, one file, sync-able
- **S5** (`CLAUDE_CODE_SUBAGENT_MODEL=haiku`) — ~10× cheaper subagents, one env var
- **S2** (reframe KPI) — without this the verification step is unfalsifiable
- **S9** (cache-break detector) — the actionable signal currently missing
- **S16** (`<system-reminder>` doc) — codifies Anthropic's own practice; differentiator

Everything else is incremental.

---

## 6. References

- **Anthropic, _Lessons from building Claude Code: Prompt caching is everything_** (Apr 30, 2026).
  Authoritative source for the cache-prefix model and the "don't edit mid-session" rule.
- **Claude Code official docs** — best-practices, hooks, subagents, skills, statusline.
- **Build to Launch**, _Claude Code Token Optimization (2026 Guide)_ — `.claudeignore`, context-mode,
  CLAUDE.md ≤ 500 tokens.
- **ClaudeFast**, _Usage Optimization_ — env vars, skills 82% recovery claim.
- **`ryoppippi/ccusage`** — community-standard token analysis CLI.
- **`affaan-m/everything-claude-code`** — env-var defaults reference.
- **`drona23/claude-token-efficient`** — terse-output CLAUDE.md drop-in.
- **`disler/claude-code-hooks-mastery`** — reference implementations for all hook events.
- **`cnighswonger/claude-code-cache-fix`** — third-party proxy (mentioned for completeness;
  not recommended without strong reason).
