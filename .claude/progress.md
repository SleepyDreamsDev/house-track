# Session Progress — house-track

> Auto-injected at session start. Update at end of each session.

**Last updated:** 2026-05-02
**Branch:** `claude/scaffold-house-track-EW7gc`
**Last commit:** _(uncommitted: token-optimization workstream)_

## Token-optimization trial active (2026-05-02)

Local-only trial of trimmed `CLAUDE.md`/`progress.md`, env-var subagent
defaults, and new hooks (`claudemd-size-check`, `caveman-autotrigger`,
upgraded `token-logger`). **At end of each session: append one row to
[`.claude/logs/kpi-results.md`](logs/kpi-results.md) using the procedure in
[`.claude/logs/kpi-targets.md`](logs/kpi-targets.md).** After 5 trial
sessions, evaluate against the decision matrix and decide whether to push
upstream to claude-tdd-starter. Baseline:
[`.claude/logs/baseline.md`](logs/baseline.md).

## Current blocker

`GET_ADVERT_QUERY` in `src/graphql.ts` has a minimal selection set; lacks
price/body/region/city/street/mapPoint/images/offerType. Re-capture from a
real browser before `RUN_ONCE=1 pnpm dev` will populate filter values.

## Next session

1. Re-capture `GetAdvert` with full feature selection set.
2. Wire Claude Desktop per `docs/mcp-setup.md`; smoke-test all 3 MCP tools.
3. End-to-end smoke `RUN_ONCE=1 pnpm dev` → verify filter rows + politeness.

<!-- Historical session notes are in .claude/progress-archive.md (do not auto-read) -->
