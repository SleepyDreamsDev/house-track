# Politeness Reassessment — Two-Tier Cadence + Adaptive Throttle

## Context

Target repo: `/Users/egorg/Dev/house-track/house-track/` (the live `main` checkout — confirmed; the `house-track-rules-hooks/` sibling is a framework experiment and is out of scope here).

Today the crawler runs **two large sweeps per day at 09:00 and 21:00 Europe/Chisinau** (`sweep.cronSchedule = '0 9,21 * * *'`), each touching `targetListingsPerSweep ≈ 336` listings via `runSweep()` in `src/sweep.ts`. The sweep is a single monolithic flow: collect index stubs → diff → fetch details for new IDs → backfill unenriched → stale-refresh → mark seen → mark inactive.

This shape has four problems we want to fix:

1. **Burst-pattern detection risk.** Two ~10-min concentrated bursts/day at fixed cron times are easy to fingerprint, even with `cronWindowJitterMs`. Human listing browsers don't behave that way.
2. **Freshness latency.** A new listing posted at 09:30 isn't seen until 21:00 — up to 12 h. With the watchlist feature (alerts on price changes for tracked listings), this is the dominant latency floor.
3. **Backfill speed.** `backfillPerSweep = 30 × 2 sweeps/day = 60 rows/day` ≈ **55 days** to enrich the ~3 300 legacy rows. Stale-refresh competes for the same per-sweep slot.
4. **Brittle 403/429 handling.** A single 403/429 trips the hard 24-h circuit (`data/.circuit_open`). There's no soft tier that responds to 5xx upticks or latency drift — by the time the hard signal fires, we've already been noisy enough to be blocked.

The goal of this reassessment is to (a) shift the request shape from two daily clusters to many small scattered batches across the active window, and (b) add a soft adaptive throttle that responds to early-warning signals before 403/429 hits.

## Approach: Two-tier rhythm with shared fetch mutex

Split the current monolithic `runSweep()` into two independently scheduled rhythms that share the existing single-concurrency fetcher and the existing `Listing` / `SweepRun` / `Setting` tables. A new `FetchTask` queue table makes priority explicit instead of being implicit in the sweep's call order.

### Tier 1 — Index ticker (discovery)

- **Cadence**: every 60–120 min, jittered, only inside the active window **07:00–23:00 Europe/Chisinau**. Quiet hours 23:00–07:00 are hard-silent (zero outbound requests).
- **Per-tick target**: `sweep.indexTickTargetListings = 100` listings ≈ 1–2 GraphQL pages (page size 78). Down from 336.
- **Work per tick**: fetch 1–2 index pages → diff vs DB → mark seen → enqueue **new** stubs into `FetchTask` with priority `NEW` → mark age-out candidates → write `SweepRun` row with `kind = 'index'`.
- **Queue maintenance**: when ticker finishes, if `FetchTask` row count is below `sweep.detailTrickleQueueRefillThreshold` (default 40), seed up to N rows of `STALE_REFRESH` and `BACKFILL` tasks via a single DB query each. Cheap; no extra cron needed.
- The ticker **never fetches detail pages** — that's tier 2's job. This is the key separation that makes the request shape scattered.

### Tier 2 — Detail trickle (enrichment)

- **Cadence**: one fetch every **3–6 min**, jittered, only inside 07:00–23:00. Modulated by adaptive throttle (see below).
- **Source**: `FetchTask` queue, drained strictly by priority then `scheduledFor`:
  1. `NEW` — just-discovered listings (latency-critical)
  2. `WATCHLIST_REFRESH` — `Listing.watchlist = true` rows with `lastFetchedAt` older than 6 h (configurable)
  3. `STALE_REFRESH` — active listings whose `lastFetchedAt` is older than `sweep.staleThresholdHours`
  4. `BACKFILL` — rows with `filterValuesEnrichedAt = null`
- **Per-task flow**: acquire the global fetcher mutex → pop highest-priority eligible task → fetch detail with the existing `POLITENESS.detailDelayMs` (10 s base + jitter) → on success persist + delete task → on failure increment `attemptCount`, reschedule with exponential backoff (`scheduledFor = now + retryBackoffsMs[attemptCount]`), drop after 3 attempts and log.
- The trickle is naturally **rate-limited by serialized fetching** — even if the queue has 1 000 rows, with the 3–6 min cadence + 10 s per detail fetch, daily throughput caps around 200–300 detail fetches.

### Shared concurrency model

Single global fetcher mutex inside `Fetcher` (today's effective state — concurrency 1 — made explicit). Both rhythms acquire it before each request; the index ticker's burst of 1–2 page fetches and the detail trickle's single-detail fetch never overlap. This preserves the current 8 s ± 2 s spacing guarantee.

### Adaptive throttle (soft tier before the 24 h circuit)

A new in-memory `ThrottleObserver` subscribes to every `Fetcher` response. Rolling windows of size 50 (status codes) and 10 (latencies) are kept in memory only — no per-request DB writes.

**Triggers** (any one engages soft-throttle):
- ≥ 3 × 5xx responses in last 50 requests
- mean latency over last 10 requests > 2.5 × mean over last 50
- ≥ 1 connection-reset / EAI_AGAIN in last 20 requests

**Effect when engaged** (for `politeness.softThrottleDurationMinutes`, default 30):
- Active delay multiplier `= politeness.softThrottleMultiplier` (default 3×). Index pages: 8s → 24s. Details: 10s → 30s.
- Detail trickle interval expands proportionally: 3–6 min → 9–18 min.
- If an index tick is scheduled to fire during soft-throttle, defer it to `softThrottleDurationMinutes` later.
- 403/429 continues to trip the **hard** 24-h circuit immediately and unconditionally. Soft-throttle is purely an early-warning attenuator.

The trigger event itself is persisted to a small `ThrottleEvent` table (or a JSON array in `Setting`) so the operator UI can show "soft throttle engaged at 14:23 because: 5xx rate spike". The hot fetch path stays cleaning of DB writes.

## Data flow

```
[Index ticker — every 60–120 min during active window]
  ├─ acquire fetcher mutex
  ├─ fetch 1–2 GraphQL index pages (8s ± 2s × throttle multiplier)
  ├─ release mutex between pages
  ├─ diff stubs vs DB → mark seen
  ├─ enqueue (listingId, NEW) for each new stub
  ├─ if queue depth < refill threshold:
  │     enqueue STALE_REFRESH + BACKFILL candidates
  ├─ mark age-out candidates inactive
  └─ write SweepRun(kind='index', ...)

[Detail trickle — every 3–6 min during active window]
  ├─ if soft-throttle engaged: extend interval
  ├─ acquire fetcher mutex
  ├─ pop highest-priority FetchTask where scheduledFor ≤ now
  ├─ fetch detail (10s ± jitter × throttle multiplier)
  ├─ on success: persist Listing + ListingFilterValue + ListingSnapshot, delete task
  ├─ on retryable failure: attemptCount++, scheduledFor = now + backoff
  ├─ on terminal failure (3 attempts): delete task, log
  └─ release mutex

[ThrottleObserver — subscribed to every fetcher response]
  ├─ update rolling status + latency windows
  ├─ check trigger predicates
  ├─ if engaged: bump delay multiplier, persist ThrottleEvent
  └─ auto-decay multiplier after duration elapses
```

## Critical files to modify

- `src/index.ts` — replace the single `cron.schedule(CRON_SCHEDULE, tick)` with **two** schedulers: `indexTickScheduler` and `detailTrickleScheduler`. Both gate on active-hours + circuit + soft-throttle. Keep `RUN_ONCE=1` semantics.
- `src/sweep.ts` — split `runSweep()` into `runIndexTick()` (no detail fetching, enqueues tasks instead) and `runDetailTask()` (single-task fetch + persist). Delete the in-loop backfill/stale-refresh phases; that work moves to queue seeding inside `runIndexTick()`.
- `src/fetch.ts` — wire `ThrottleObserver` into the response path; export the rolling latency stream. Apply `delayMultiplier` to `maybeWaitBetweenRequests()` and detail-delay computation.
- `src/circuit.ts` — add `SoftThrottleState` alongside existing hard breaker. Both file-backed (sentinel + JSON) so a process restart preserves state.
- `src/settings.ts` — add Zod schemas for new keys (see below).
- `src/persist.ts` — add `enqueueFetchTask()`, `popNextFetchTask()`, `rescheduleFetchTask()`, `deleteFetchTask()`, `countFetchTasks()`, `seedStaleAndBackfillTasks()` helpers. Reuse the existing `findUnenrichedListings()` pattern.
- `prisma/schema.prisma` — add `FetchTask` and `ThrottleEvent` models. Migration name `add_fetch_task_queue`.
- `docs/poc-spec.md` — update the Politeness budget table; add a "Two-tier cadence" section linking to this design.

## Schema additions

```prisma
model FetchTask {
  id           Int       @id @default(autoincrement())
  listingId    String
  priority     Int       // 0=NEW, 1=WATCHLIST, 2=STALE, 3=BACKFILL
  reason       String    // mirrors priority for operator readability
  enqueuedAt   DateTime  @default(now())
  attemptCount Int       @default(0)
  lastError    String?
  scheduledFor DateTime  @default(now())
  @@unique([listingId, reason])
  @@index([priority, scheduledFor])
}

model ThrottleEvent {
  id          Int      @id @default(autoincrement())
  triggeredAt DateTime @default(now())
  trigger     String   // '5xx_rate' | 'latency_spike' | 'connection_reset'
  durationMs  Int
  context     Json?    // window stats at trigger time (Postgres JSONB)
  @@index([triggeredAt])
}
```

The `(listingId, reason)` unique constraint dedupes — re-enqueuing the same listing for the same reason is a no-op. The `(priority, scheduledFor)` composite supports the polling query `findFirst({ where: { scheduledFor: { lte: now } }, orderBy: [{ priority: 'asc' }, { scheduledFor: 'asc' }] })`; priority is the selective prefix because at steady state most rows are due.

## New `Setting` keys (all runtime-mutable via existing `setSetting()` path)

| Key | Default | Purpose |
|---|---|---|
| `sweep.mode` | `'legacy'` → flip to `'two_tier'` after dry-run | Feature flag for migration |
| `sweep.indexTickIntervalMinutesMin` | 60 | Lower bound on index ticker spacing |
| `sweep.indexTickIntervalMinutesMax` | 120 | Upper bound |
| `sweep.indexTickTargetListings` | 100 | Per-tick listing target (replaces 336) |
| `sweep.detailTrickleIntervalSecondsMin` | 180 | Lower bound on detail trickle spacing |
| `sweep.detailTrickleIntervalSecondsMax` | 360 | Upper bound |
| `sweep.detailTrickleQueueRefillThreshold` | 40 | Below this depth, seed STALE+BACKFILL |
| `sweep.staleThresholdHours` | 168 | A listing is "stale" if `lastFetchedAt` older than this |
| `sweep.watchlistRefreshHours` | 6 | Watchlist re-enrichment cadence |
| `politeness.softThrottleMultiplier` | 3 | Delay multiplier when soft-throttle engaged |
| `politeness.softThrottleDurationMinutes` | 30 | How long soft-throttle stays engaged |

Existing `sweep.cronSchedule` stays available but is unused when `sweep.mode = 'two_tier'`.

## Reused existing utilities (do **not** duplicate)

- `Fetcher` (`src/fetch.ts`) — sole network gateway; all new code routes through it.
- `defaultJitter()` (`src/fetch.ts:64`) — apply same jitter shape to new interval randomization.
- `getSetting()` / `setSetting()` (`src/settings.ts`) — runtime config plumbing for every new key above.
- `persist.markSeen()`, `persist.persistDetail()`, `persist.markInactiveOlderThan()` — unchanged contracts.
- `persist.findUnenrichedListings()` — reuse inside `seedStaleAndBackfillTasks()` for the BACKFILL portion.
- `circuit.isOpen()` / `circuit.tripImmediately()` — hard breaker untouched. Soft tier sits *next to* it.
- `SweepRun` model — extend with `kind String @default('legacy')` field rather than introducing a new run-log table. Index ticks write `kind='index'`, detail trickle batches don't write `SweepRun` rows individually (too noisy); a daily aggregate row is written at quiet-hours boundary.
- The existing operator UI SSE channel — emit `index_tick` and `detail_drain` progress events on the same channel.

## Migration path

1. **PR 1 — Plumbing without behavior change.**
   - Add `FetchTask`, `ThrottleEvent` migration.
   - Add new settings keys (read-only, no callers yet).
   - Add `kind` column to `SweepRun` defaulting to `'legacy'`.
   - Land. CI green. No production behavior change.
2. **PR 2 — Two-tier mode behind flag, default off.**
   - Implement `runIndexTick()`, `runDetailTask()`, `ThrottleObserver`, queue helpers.
   - Wire two schedulers in `src/index.ts` that activate only when `sweep.mode = 'two_tier'`.
   - Add `--dry-run` mode that logs every "would fetch X" decision without hitting network.
   - Land with `sweep.mode = 'legacy'`. Run dry-run for 24 h in prod, eyeball the timeline scatter.
3. **PR 3 — Flip default, observe.**
   - Set `sweep.mode = 'two_tier'` in DB via operator UI.
   - Watch `SweepRun(kind='index')` row count = 8–14/day, watch `FetchTask` table drain to ≈0 during active hours, watch `ThrottleEvent` rows.
   - Keep the legacy path callable for 1 week.
4. **PR 4 — Remove legacy.**
   - Delete the old `runSweep()` monolith and the `cronSchedule` setting.
   - Remove the `kind` column's `'legacy'` literal default; backfill historical rows.

Any of PR 2 / PR 3 / PR 4 can be paused without consequence — the system stays functional in whichever mode the flag points at.

## Verification

**End-to-end manual test.**
1. `pnpm db:reset` then run dry-run for 24 simulated hours (use `vi.useFakeTimers()` or a `--simulate-clock` flag): assert that index ticks fire 8–14 times, all between 07:00 and 23:00, with intervals never < 60 min or > 120 min, and that no two detail fetches are scheduled within 180 s of each other.
2. Run live in `two_tier` mode for one full active day. Confirm: zero requests between 23:00 and 07:00, `FetchTask` count drops below 5 by 23:00, no 403/429, no hard circuit trip.

**Unit-level.**
- Queue ordering with mixed priorities + `scheduledFor` ties.
- Dedup behaviour: enqueueing `(listingId, 'new')` twice doesn't double the row.
- ThrottleObserver triggers fire correctly on synthetic 5xx burst, latency drift, connection-reset; multiplier auto-decays after `softThrottleDurationMinutes`.
- Active-hours gate: scheduling at 06:55 with a 60-min interval places the next fire at 07:00, not 07:55.

**Integration.**
- Inject 3 fake 5xx responses via the existing test fetcher; assert `delayMultiplier` becomes 3 and the next detail trickle interval is in [9, 18] min.
- Inject a 429; assert hard circuit trips and both schedulers stop firing until `data/.circuit_open` is removed.
- Re-enable after circuit clear; assert queues resume from where they left off (FetchTask rows persisted across the pause).

**Observability check.**
- Operator UI shows: index-tick history, detail-trickle queue depth over time, current throttle multiplier, last 10 throttle events. If any of these would require new endpoints, scope them into PR 3.

## Out of scope (deliberately)

- Multi-source crawling (only `999.md` today; `Source` table exists but only one row).
- Parallel concurrency (>1 in-flight request) — politeness.md is firm on this.
- Distributed scheduler — single Node process with two `node-cron` instances is enough for the request volumes targeted here.
- Captcha solving — circuit-trip + manual-clear remains the right fallback.
