# Operator UI Smoke Test — Design

**Status:** Approved (2026-05-09)
**Author:** brainstorming session
**Scope:** Single PR. Adds an HTTP-triggered, UI-exposed smoke test that runs a
truncated sweep against live 999.md and reports assertion pass/fail.

---

## Motivation

`scripts/smoke.ts` already exists as a CLI smoke (`LIVE_SMOKE=1 pnpm smoke`):
it spawns `RUN_ONCE=1 dist/index.js`, runs a full sweep (~30 listings, several
minutes), and asserts no rate-limit errors, ≥30 listings touched, and that
filter-value enrichment ran.

That smoke is too heavyweight for a quick "is the crawler still working
against live 999.md?" check from the operator UI. Operators currently have
no in-UI way to verify the fetch + parse + persist path end-to-end —
especially after editing politeness or filter settings, or after resetting
the circuit breaker.

This feature adds a thin variant: one button on the Sweeps page that runs a
3-listing sweep, reports assertion results inline, and shows up in the sweep
history tagged with `trigger='smoke'`.

---

## Decisions Captured

| Decision | Choice |
|---|---|
| Persistence | Persist + record SweepRun (`trigger='smoke'`). Real upserts, real history row. |
| Volume | 1 index page + 3 detail fetches (~32s wall clock at default politeness). |
| UI location | Sweeps page header (next to the existing breaker banner / sweep table). |
| Circuit breaker | **Respect** breaker. Button disabled when open, with explanatory tooltip. |
| Assertions | Mirror `scripts/smoke.ts` assertions, scaled to 3 listings. |

---

## Architecture

### Backend — `POST /api/sweeps/smoke`

Lives alongside the existing sweep endpoints in `src/web/routes/sweeps.ts`.

**Behavior:**

1. If `circuit.isOpen()`, return `409 { error: 'circuit_open' }`. Button is
   already disabled in the UI; this is a defense-in-depth check.
2. Build the same `SweepDeps` as the existing `POST /api/sweeps`, but
   **override three** deps to scope the sweep:
   - `maxPagesPerSweep = 1`
   - `targetListingsThisSweep = 3`
   - `backfillPerSweep = 0`
3. Record `SweepRun` via `persist.startSweep({ source: '999.md',
   trigger: 'smoke' })`. The `trigger` field is already supported in
   `src/persist.ts:171`.
4. **Await** `runSweep(deps, sweep.id)` — unlike the existing
   fire-and-forget `POST /api/sweeps`, this endpoint blocks (~32s) so the
   HTTP response can carry assertion results synchronously.
5. After `runSweep` resolves, run assertions (see below) and return:

   ```json
   {
     "sweepId": 42,
     "durationMs": 31203,
     "passed": true,
     "assertions": [
       { "name": "sweep status=ok", "ok": true, "detail": "actual: ok" },
       { "name": "no 403/429 in errors", "ok": true, "detail": "0 found" },
       { "name": "≥1 listing touched", "ok": true, "detail": "actual: 3" },
       { "name": "≥1 ListingFilterValue created", "ok": true, "detail": "actual: 7" },
       { "name": "≥1 listing newly enriched", "ok": true, "detail": "actual: 3" }
     ]
   }
   ```

**Why synchronous HTTP wait:** A 30s blocking endpoint is unusual but
correct here. The smoke is a single deliberate operator click, not a
background job. SSE-streaming an already-recorded `SweepRun` would
duplicate the existing `/api/sweeps/stream` plumbing for no UX benefit
(the operator is sitting at the screen waiting for the result anyway).

### Shared assertion module — `src/smoke-assertions.ts`

The current `scripts/smoke.ts` inlines `runAssertions(prisma, since)` and a
`MIN_NEW_OR_UPDATED_LISTINGS = 30` constant. We extract these into a new
module so both CLI and HTTP smoke share one source of truth.

```ts
// src/smoke-assertions.ts
export interface AssertionResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeAssertOpts {
  /** Minimum listings.touched threshold. CLI uses 30, HTTP smoke uses 1. */
  minListingsTouched: number;
}

export async function runSmokeAssertions(
  prisma: PrismaClient,
  since: Date,
  opts: SmokeAssertOpts,
): Promise<AssertionResult[]> { /* ... */ }
```

`scripts/smoke.ts` is updated to import `runSmokeAssertions(prisma, since,
{ minListingsTouched: 30 })` and the HTTP route uses
`{ minListingsTouched: 1 }`. The `countRateLimitErrors` helper moves with
it.

This refactor is in-scope: it prevents drift between CLI and HTTP smoke,
and the unit-testable extraction is load-bearing for the test plan below.

### Frontend — Sweeps page

`web/src/pages/Sweeps.tsx` gets:

- A **"Run smoke"** button in the page header. Visually a secondary action
  (not destructive — distinct from "Reset breaker"). Sits to the right of
  the title/subtitle line.
- Disabled state when `circuit.open === true`, with `title="Circuit
  breaker open — reset before running smoke"`.
- `useMutation` against `POST /api/sweeps/smoke`. While pending, button
  shows `"Running smoke… ~30s"` with a spinner.
- On success (HTTP 200, regardless of `passed`):
  - Toast: green if `passed`, red if any assertion failed. Body lists
    `passed/total` and the names of any failing assertions.
  - Toast includes a link **"View sweep #<id>"** routing to
    `/sweeps/<sweepId>` (existing detail page).
  - `qc.invalidateQueries({ queryKey: ['sweeps'] })` and
    `['circuit']` so the table refreshes.
- The smoke run shows up in the existing sweep history table like any
  other sweep, with a small `smoke` chip in the Started column to
  distinguish it from `manual` and cron-triggered runs. (The trigger
  column is implicit today — we surface it visually for smoke only.)

---

## Data Flow

```
Operator clicks "Run smoke"
    ↓
[UI] POST /api/sweeps/smoke  (no body)
    ↓
[Route] circuit.isOpen()? → 409 if yes
    ↓
[Route] persist.startSweep({ source:'999.md', trigger:'smoke' }) → sweepId
    ↓
[Route] runSweep(deps with capped maxPages=1, target=3, backfill=0, sweepId)
    ↓ (~32s: 1 search page fetch + 3 advert fetches at 8s politeness)
[Route] runSmokeAssertions(prisma, sweepStart, { minListingsTouched: 1 })
    ↓
[Route] return { sweepId, durationMs, passed, assertions }
    ↓
[UI] Toast with pass/fail summary + sweep link
    ↓
[UI] Refetch sweeps + circuit queries
```

---

## Error Handling

| Failure mode | Behavior |
|---|---|
| Circuit breaker open at request time | 409, no SweepRun row created, toast "Reset breaker first" |
| Sweep fails mid-run (e.g., 403 from 999.md) | SweepRun finalized with `status='failed'`. HTTP returns 200 with `passed=false` and assertion `sweep status=ok` failing. Toast shows the failure. |
| Sweep partial (some details fetched, some failed) | SweepRun `status='partial'`. `passed=false`, the `sweep status=ok` assertion reports `actual: partial`. |
| Cancellation (operator cancels via existing `/api/sweeps/:id/cancel`) | SweepRun `status='cancelled'`. Same shape as failed. |
| Server crash during the 30s wait | Browser sees a connection error. Next `GET /api/sweeps` will show the orphaned `in_progress` SweepRun — same recovery path as today's manual sweep. |

No new failure modes introduced — the smoke shares the existing sweep
finalization plumbing (`finishSweep` in the `runSweep` finally block).

---

## Testing

Following the project's TDD conventions (`specs/*.feature` per feature;
integration > unit > edge cases):

### Gherkin spec — `specs/sweep-smoke.feature`

```gherkin
Feature: Operator UI smoke test

  Scenario: Smoke run returns passing assertions when fetch path is healthy
  Scenario: Smoke refuses with 409 when circuit breaker is open
  Scenario: Smoke records a SweepRun row tagged trigger=smoke
  Scenario: Smoke caps fetch volume to 1 index page + 3 detail fetches
  Scenario: Smoke surfaces partial sweep as passed=false
  Scenario: runSmokeAssertions threshold is configurable (CLI=30, HTTP=1)
```

Each `Scenario:` maps to one `it()` block per project convention.

### Integration tests

- `src/web/routes/__tests__/sweeps.smoke.test.ts` — mocks `Fetcher` via
  the existing `MockAgent` pattern (per CLAUDE.md: never hit real 999.md
  in tests). Provides 1 page response + 3 detail responses. Asserts:
  - `POST /api/sweeps/smoke` returns 200 with shape
    `{ sweepId, durationMs, passed: true, assertions: [...] }`
  - DB has a new `SweepRun` row with `trigger='smoke'`,
    `pagesFetched=1`, `detailsFetched=3`
  - Circuit-open returns 409 and creates **no** SweepRun row
  - Mocked Fetcher receives exactly 4 requests (1 search + 3 advert),
    proving the volume cap is enforced

### Unit tests

- `src/__tests__/smoke-assertions.test.ts` — feeds synthetic
  `SweepRun` / `Listing` / `ListingFilterValue` rows via Prisma
  testcontainer, asserts:
  - All-pass case → all `ok=true`
  - 403 in errors → `no 403/429` fails with detail count
  - Threshold parameter respected: 0 listings touched fails for
    `minListingsTouched: 1`, but 0 vs 0 not directly testable (we test
    1 vs 30 instead — 1 listing touched, threshold 30 fails)

Coverage target per project conventions: 70%+ on the new module.

---

## Out of Scope

Explicitly NOT in this PR:

- **Smoke history page or trend tracking.** Smoke runs are visible in the
  existing sweep history; no separate dashboard.
- **Auto-smoke on schedule.** Smoke is operator-triggered only. (If we
  later want a "canary" hourly smoke, that's a separate feature.)
- **Smoke on Settings save.** A natural next feature ("run smoke after
  changing politeness?") is deferred until we see whether operators
  actually want it.
- **SSE streaming of smoke progress.** The 30s synchronous wait is
  acceptable for a deliberate one-off action.
- **Bypass mode.** Smoke always respects the circuit breaker. No
  "force smoke" override — if the breaker is open, the operator resets
  it first.

---

## Files Touched

**New:**
- `src/smoke-assertions.ts` — extracted assertion logic
- `src/__tests__/smoke-assertions.test.ts`
- `src/web/routes/__tests__/sweeps.smoke.test.ts`
- `specs/sweep-smoke.feature`

**Modified:**
- `src/web/routes/sweeps.ts` — add `POST /api/sweeps/smoke` handler;
  also add `trigger` to the `GET /api/sweeps` response mapping (currently
  the field is set on insert but not surfaced — the frontend needs it to
  render the `smoke` chip)
- `scripts/smoke.ts` — switch to importing `runSmokeAssertions`
- `web/src/pages/Sweeps.tsx` — add Run smoke button + mutation + toast;
  add `trigger?: string` to the `SweepRun` interface and render a
  `smoke` chip in the Started column when present
- `docs/operator-ui.md` — document the new button under "How to..."

**Unchanged but worth noting:**
- `src/sweep.ts` — no changes; smoke uses existing `targetListingsThisSweep`
  and `maxPagesPerSweep` deps.
- `src/persist.ts` — no changes; `trigger='smoke'` already supported.
- Database schema — no migration needed.
