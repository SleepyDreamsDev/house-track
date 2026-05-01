# Token Discipline Rules

> Framework-generic. Reusable across all projects.
> Read alongside `tdd-workflow.md` and `session-reporting.md`.

---

## The Two KPIs

1. **Cold-start cost** — total input tokens at session start (system prompt
   + CLAUDE.md + auto-injected context). This is the bill you pay every
   single session, regardless of what you do during it. Lower is better.
2. **Cache stability** — `cache_creation_input_tokens` events per session.
   Target: ≤ 2 (one at session start, one if compaction fires). Each extra
   event means a static-context edit broke the prefix.

`cache_read` is an outcome, not a target. Optimizing for "cache hit %" is
the wrong frame — a session that does very little will look great by that
metric while burning cold-start cost on every restart.

## Cache breakpoint minimums

The Anthropic API requires a minimum prefix length before it will write a
cache entry:

- Sonnet / Haiku: **1024 tokens**
- Opus: **2048 tokens**

Below those minimums, no cache is written and "low cache hit %" is
meaningless. Don't tune anything based on a sub-breakpoint reading.

## Static-then-dynamic prompt ordering

Always order prompts:

1. Tools / system instructions (static, always-cached)
2. CLAUDE.md / project conventions (static-ish, cached when stable)
3. Session context (auto-injected progress.md, file SHAs)
4. Live conversation

Anything dynamic in slot 1 or 2 invalidates everything after it. The single
biggest avoidable footgun is a date or timestamp in the system prompt.

## Mid-session cache hygiene

- **Don't edit `CLAUDE.md` or `progress.md` mid-session.** Both are loaded
  near the top of the cached prefix; editing them recreates the cache from
  that point. Update at end-of-session only.
- **Don't switch models mid-session** unless you're starting fresh —
  caches are model-scoped.
- **Don't add/remove MCP servers mid-session.** Tool list churn breaks
  cache the same way.

## `<system-reminder>` injection pattern

When the orchestrator needs to inject "we just decided X" mid-conversation,
do it as a **user-message-side hook** (Stop / UserPromptSubmit
`hookSpecificOutput.additionalContext`). Never edit the system prompt or
`CLAUDE.md` to record an in-flight decision — that breaks cache.

Hooks ship the new context in the **dynamic** suffix, leaving the static
cached prefix intact.

## When to invoke which command

| Command    | When                                              |
| ---------- | ------------------------------------------------- |
| `/compact` | After each TDD phase. Don't wait for the warning. |
| `/clear`   | Before a fresh task in the same project.          |
| `/cost`    | Spot-check current session billing.               |
| `/context` | Inspect what's currently in the cached prefix.    |
| `/caveman` | Output-bound sessions only — auto-triggered when applicable. |

## Subagent dispatch

- Default model is Haiku (via `CLAUDE_CODE_SUBAGENT_MODEL` env). Use it
  for read-and-summarize work (`discovery-explorer`).
- Pin Sonnet for TDD-execution agents (`domain-implementer`).
- Pin Opus for reviewer / threat-modeling work where cross-cutting
  reasoning matters.
- Subagents inherit the parent context only when `CLAUDE_CODE_FORK_SUBAGENT=1`.
  Default is off; opt in only when subagents share heavy parent state.

## Historical analysis

For per-project / per-day breakdowns and trend analysis, use
[`ccusage`](https://github.com/ryoppippi/ccusage):

```bash
npx ccusage daily --instances --project <name>
```

Don't rebuild this — adopt it.

## Skill: `/caveman`

When output dominates input (long prose responses), `/caveman` reduces
output tokens ~75% by speaking in caveman shorthand without losing technical
accuracy. The auto-trigger fires once per session when the rolling
output/input ratio exceeds 0.30 over 5+ assistant turns. The reminder is
advisory — explicit user request for verbose output overrides for that turn.

## Hook signals to watch

- `token-logger.sh` (Stop): warns when `cache_read / (cache_read +
  cache_creation) < 0.7` AND the session crossed the breakpoint minimum.
- `token-logger.sh` per-turn cache-break detector: flags any post-turn-3
  turn that creates >1000 new cache tokens. Likely cause: edited static
  context, model switch, or tool-set change.
- `claudemd-size-check.sh` (SessionStart): warns when root `CLAUDE.md`
  exceeds 120 lines / 4 KB. Prevents silent drift back to bloat.

## Out-of-scope (don't bake in)

- `statusLine` integration. Three options exist (`ccstatusline`,
  `cc-statusline`, custom shell). Opt-in per project; do not enforce.
- Cache-fix proxy. Adds infrastructure dependency for marginal gain.
- `claude-mem` plugin. Duplicates the existing memory layer.
