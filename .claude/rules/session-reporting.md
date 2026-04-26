# Session Reporting Rules

> Framework-generic. Reusable in claude-tdd-starter.
> Apply when executing plans or multi-step tasks.

---

## What to Report

- **Before each file edit:** one-line summary of what is changing and why
- **After each bash command:** whether it succeeded or failed + one-line result
- **After a logical group of changes:** short progress summary (2-3 lines)
- **If typecheck or test fails:** print the error immediately — do not silently continue
- **When starting a major phase (RED / GREEN / REFACTOR / SHIP):** announce it with the phase banner

## Phase Banners

```
── PHASE 0 PLAN ✓ ── loaded <plan-filename>
── PHASE 1 DISCOVER ✓ ── domain(s): <detected>
── PHASE 1.5 SPECIFY ✓ ── N scenarios in specs/<feature>.feature
── FAST MODE: auto-approving N scenarios. Proceeding to RED+GREEN. ──
── PHASE 2 RED ✓ ── N tests written, all failing
── PHASE 3 GREEN ✓ ── N/N tests passing
── PHASE 4 REFACTOR ✓ ── code improved, all tests green
```

## Completion Summary

```
══════════════════════════════════════════════════════
  FEATURE COMPLETE: <short description>
══════════════════════════════════════════════════════
  Gherkin spec: specs/<feature>.feature — N scenarios
  Tests: N passing
  Branch: feature/<slug>
  Commit: <hash> <message>
  Files: <list>
  Assumptions: <list or "none">
  Next session: <what to work on next>
══════════════════════════════════════════════════════
```

## Kaizen Retrospective

After every feature delivery, output:

```
── KAIZEN ──────────────────────────────────────
  What went well:
    - <1-2 things>
  What could improve:
    - <1-2 concrete, actionable suggestions>
  Auto-implemented:
    - <Fix/Quality improvements applied, or "none">
  Workflow delta (not auto-implemented):
    - <Workflow/Architecture suggestions, or "none">
────────────────────────────────────────────────
```

Classify improvements:

- **Fix / Quality** → auto-implement + commit
- **Workflow / Architecture** → output only, do not auto-implement
