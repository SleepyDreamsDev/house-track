# Sweep Orchestration & Crawl Pipeline

## Purpose & Scope

The sweep orchestration subsystem coordinates the periodic crawl of 999.md listings, from cron scheduling through indexing, diffing, and detail-fetching to final persistence. This spec governs the happy-path control flow, retry logic, circuit-breaker integration, and the two-tier (legacy + future) cadence design that keeps a growing database responsive under politeness constraints.

---

## Architecture & Key Modules

| File                  | Responsibility                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`        | Cron entrypoint, bootstrap, tick scheduling, dependencies, quiet hours, API server setup                                                    |
| `src/sweep.ts`        | Core sweep logic: index pagination, diffing, detail-fetching, backfill, stale-refresh; AbortController management; live progress publishing |
| `src/circuit.ts`      | Sentinel-file-based circuit breaker; manual clear on operator UI; 3-consecutive-4xx tripwire                                                |
| `src/fetch.ts`        | HTTP client with politeness delays, exponential retry, content-type validation, UA spoofing, circuit-breaker escalation                     |
| `src/config.ts`       | Hardcoded filter (GraphQL search input), politeness policy, circuit thresholds, sweep tuning knobs                                          |
| `src/settings.ts`     | Runtime settings layer — read-only access to Postgres Setting rows, with fallback to config.ts defaults                                     |
| `src/parse-index.ts`  | Extract ListingStub array from GraphQL SearchAds response                                                                                   |
| `src/parse-detail.ts` | Extract ParsedDetail (full schema) from GraphQL GetAdvert response; emit filter triples for enrichment                                      |
| `src/persist.ts`      | DB operations: diffAgainstDb, markSeen, markInactiveOlderThan, persistDetail, startSweep/finishSweep, progress flushing, snapshot config    |
| `src/log.ts`          | Pino JSON logger teed to EventEmitter; live SSE streaming during active sweep                                                               |

---

## Data Flow / Control Flow

### Initialization (Bootstrap)

1. **Process start** (`src/index.ts` line 199):
   - Module-scoped `PrismaClient` instantiated once; reused across all cron ticks.
   - `RUN_ONCE=1` env triggers one-shot smoke-test mode → immediate `tick()` + `process.exit()`.
   - Normal mode: spawn Hono API server + schedule cron.

2. **Cron scheduling** (line 186–196):
   - `sweep.cronSchedule` read from Postgres Setting (default `'0 9,21 * * *'`).
   - Jitter window `sweep.cronWindowJitterMs` (default 1h) applied as `setTimeout(random(0, jitterMs))` after cron fires.
   - Schedule + jitter are read once at boot; live mutation requires process restart.

### Per-Tick Execution (`tick()` at line 141–157)

1. **Pre-flight**:
   - Check `inQuietHours()` (line 124–139): suppress cron ticks during `[quietHoursStart, quietHoursEnd)` in Europe/Chisinau timezone.
   - Check for active sweep: if any SweepRun row has `status='in_progress'`, skip this tick (guard: concurrency = 1).

2. **Dependency injection** (`buildDeps()` at line 35–118):
   - Read runtime-mutable settings from Postgres (baseDelayMs, jitterMs, detailDelayMs, maxPagesPerSweep, etc.).
   - Instantiate `Fetcher` with circuit breaker, politeness config, retry backoffs.
   - Resolve active filter (source + override from Postgres).
   - Compute per-tick target: `targetListingsThisSweep = targetMean ± jitter(random)`.
   - Return `SweepDeps` bundle (callbacks + caps).

3. **Main sweep** (`runSweep(deps, initialSweepId?)` at line 114–200):
   - **`initialSweepId` (optional)**: when the API layer pre-creates a SweepRun row (manual sweeps), it passes the row id so `runSweep` drives that exact row instead of calling `startSweep()` (line 122). When absent (cron), `startSweep()` creates a fresh row.

   a. **Pre-flight circuit check** (line 115–120):
   - If circuit breaker is open, write a SweepRun with `status='circuit_open'` and exit immediately.
   - **Wart**: this branch always calls `startSweep()` and _ignores_ `initialSweepId` (line 117). If a manual sweep pre-created id=N and the circuit is open, a _second_ row is created and finished as `circuit_open`, leaving id=N stuck `in_progress` until the operator cancels it. The concurrency guard then blocks subsequent ticks until that orphan is cleared.

   b. **Index pagination** (`collectIndexStubs()` at line 228–281):
   - For `page = 0` to `maxPagesPerSweep - 1`:
     - POST to GraphQL endpoint with `SearchAds` query + search filter variables.
     - Fetcher applies 8s ± 2s delay before each request; retries 5xx with backoff [10s, 30s, 90s].
     - Parse response with `parseIndex()` → extract ListingStub[].
     - If any page yields 0 stubs, break pagination (end of index).
     - If accumulated stubs ≥ targetListingsThisSweep, break (size cap).
     - Record per-page detail: bytes, attempts, parse time, stub count.
   - Return all accumulated stubs.

   c. **Diffing** (line 142):
   - Call `persist.diffAgainstDb(allStubs)` → yields two sets:
     - **new**: ids not in DB → require full detail fetch.
     - **seen**: ids exist and present in this sweep → should be re-fetched for price/description changes.
   - Delisting is handled separately: ids absent for ≥ 3 consecutive sweeps are flipped inactive by `markInactiveOlderThan()` later (no `gone` key on the diff result).
   - Apply cap: if `new.length + seen.length > targetListingsThisSweep`, slice both sets to the cap.

   d. **Detail fetching** (`fetchAndPersistDetails()` at line 283–414):
   - Increment `detailQueueDepth` upfront (visible to UI as progress).
   - **For each stub in new[]**:
     - POST to GraphQL endpoint with `GetAdvert` query.
     - Fetcher applies 10s delay (detailDelayMs) before this request to slow detail traffic.
     - Parse response with `parseDetail()` → extract ParsedDetail.
     - Call `persist.persistDetail(parsed)` → upsert Listing + conditionally insert ListingSnapshot (content-addressed on rawHtmlHash).
     - Record detail metadata: bytes, attempts, parse time, price.
     - On error: log to `result.errors`, set status to 'partial', continue sweep.
   - **For each stub in seen[]**:
     - Same fetch/parse/persist flow — politeness delay applies to every request.
     - Unchanged listings skip snapshot write (hash dedup) but still cost a detail record for forensics.
     - Mark `action='updated'` in details record.

   e. **Backfill enrichment** (`backfillUnenriched()` at line 420–468):
   - Find up to `backfillPerSweep` listings with `filterValuesEnrichedAt IS NULL`.
   - Re-fetch each via same detail path to populate filter triples (source-side schema drift mitigation).
   - Respects politeness budget (10s delay per request).

   f. **Stale-refresh rotation** (`staleRefresh()` at line 475–522):
   - Find up to `staleRefreshPerSweep` listings ordered by (watchlist DESC, lastFetchedAt ASC).
   - Re-fetch each to capture price/description evolution; prevent long tail from going stale.
   - Fudge: skip any listing touched in this sweep's last 60 seconds.

   g. **Mark seen + age out + cluster recompute** (line 169–190):
   - Call `persist.markSeen(diff.seen)` → bump `lastSeenAt` on every seen stub (without detail cost).
   - Call `persist.markInactiveOlderThan(missingThresholdMs)` → mark any listing absent for >≈3 sweeps as `active=false`.
   - Call `persist.recomputeClusters()` → rebuild dedup `canonicalId` assignments over active + recently delisted (≤180d) listings; log the multi-member cluster count as `sweep.clusters`.
   - Both age-out and cluster recompute only fire when `status='ok'` (full index reached); skipped on partial sweeps.
   - Recompute runs **after** age-out (it selects on `delistedAt`, which age-out stamps in the same sweep) and is wrapped in its own try/catch: clusters are derived, rebuildable data, so a clustering failure logs `sweep.clusters_failed` and must not flip a successful sweep to `failed`.

   h. **Error handling** (line 181–189):
   - `CircuitTrippingError` → set status to `'circuit_open'`.
   - `controller.signal.aborted` → set status to `'cancelled'` (manual operator cancel via UI).
   - Uncaught → set status to `'failed'`, record error.

   i. **Sweep finalization** (line 190–199):
   - Delete AbortController from module-scoped registry.
   - Call `persist.finishSweep(sweepId, result)` → write final row, unblock next tick.
   - Log final summary.
   - Clear `activeSweepId` only after all final operations.

### Progress Publishing

- `publishProgress()` (line 207–226): called after each index page, detail batch, backfill/stale rotation.
- Flushes in-memory counters to SweepRun row via `persist.recordSweepProgress()`.
- Wrapped in try/catch; DB blip does not abort sweep.
- Operator UI polls `/api/sweeps` every few seconds to render live progress bars.

---

## Contracts & Types

### Input: SweepDeps

```typescript
// runSweep signature: runSweep(deps: SweepDeps, initialSweepId?: number)
// initialSweepId reuses a pre-created SweepRun (manual sweeps) instead of
// calling startSweep(). NOTE: the circuit-open pre-flight branch ignores it.

interface SweepDeps {
  // GraphQL callbacks returning {json, bytes, attempts}
  fetchSearchPage: (pageIdx: number, signal?: AbortSignal) => Promise<FetchEnvelope>;
  fetchAdvert: (id: string, signal?: AbortSignal) => Promise<FetchEnvelope>;

  persist: {
    diffAgainstDb(stubs: ListingStub[]): Promise<{ new; seen }>;
    markSeen(stubs: ListingStub[]): Promise<void>;
    markInactiveOlderThan(thresholdMs: number): Promise<void>;
    persistDetail(parsed: ParsedDetail): Promise<void>;
    startSweep(): Promise<{ id: number }>;
    finishSweep(id: number, result: SweepResult): Promise<void>;
    findUnenrichedListings(limit: number): Promise<string[]>;
    findStaleListings(opts: { limit; sinceFetched }): Promise<string[]>;
    snapshotConfig(): Promise<Record<string, unknown>>;
    recordSweepProgress(id: number, update: SweepProgressUpdate): Promise<void>;
    recomputeClusters(): Promise<number>; // returns multi-member cluster count
  };

  circuit: {
    isOpen(): Promise<boolean>;
  };

  parseIndex: (json: unknown) => ListingStub[];
  parseDetail: (id: string, json: unknown) => ParsedDetail;

  maxPagesPerSweep: number;
  missingThresholdMs: number;
  backfillPerSweep?: number;
  staleRefreshPerSweep?: number;
  targetListingsThisSweep?: number;
  log?: Logger;
}
```

### Output: SweepResult

```typescript
interface SweepResult {
  status: 'ok' | 'partial' | 'failed' | 'circuit_open' | 'cancelled';
  pagesFetched: number;
  detailsFetched: number;
  newListings: number;
  updatedListings: number;
  errors: Array<{ url; status?: number; msg; attempts?: number }>;
  configSnapshot: Record<string, unknown> | null;
  pagesDetail: Array<{ n; url; status; bytes; attempts; parseMs; found; took }>;
  detailsDetail: Array<{ id; url; status; bytes; attempts; parseMs; action; priceEur }>;
  eventLog: unknown | null;
}
```

### ListingStub (Index Response)

```typescript
interface ListingStub {
  id: string; // 999.md numeric ID
  url: string; // https://999.md/ro/<id>
  title: string;
  priceEur: number | null;
  priceRaw: string | null;
  areaSqm: number | null;
  postedAt: Date | null;
  imageUrls: string[]; // Already in SearchAds, no extra cost
}
```

### ParsedDetail (Detail Response)

Full schema defined in `src/types.ts`; key fields:

- All ListingStub fields (id, url, title, price, area, postedAt).
- Extended: rooms, land size (are), district, sector, street, floors, yearBuilt, heating type, full description, features, seller type, bump timestamp, geo (lat/lon), seller identity (authorId/name/type/phone).
- **rawHtmlHash**: sha256 of normalized response; used for content-addressed snapshot.
- **filterValues**: FilterValueTriple[] (feature → option mapping from 999.md taxonomy).

### Prisma Models Written

**SweepRun** (line 128–152 in schema.prisma):

```
id:              INT @id @autoincrement()
startedAt:       DateTime @default(now())
finishedAt:      DateTime?
status:          String  // "ok" | "partial" | "failed" | "circuit_open" | "cancelled"
pagesFetched:    Int @default(0)
detailsFetched:  Int @default(0)
newListings:     Int @default(0)
updatedListings: Int @default(0)
errors:          Json?   // Array of {url, status, msg, attempts}
source:          String  @default("999.md")
trigger:         String  @default("cron")  // "cron" | "manual"
configSnapshot:  Json?   // Settings snapshot at sweep start
pagesDetail:     Json?   // Per-page forensics
detailsDetail:   Json?   // Per-detail forensics
eventLog:        Json?   // Reserved for future event-trace
kind:            String  @default("legacy")  // "legacy" | "index" | "detail"
```

**Listing** (core fields written by persistDetail):

```
id:              String @id
url:             String @unique
firstSeenAt:     DateTime
lastSeenAt:      DateTime (bumped by markSeen)
lastFetchedAt:   DateTime (set by persistDetail)
active:          Boolean (flipped by markInactiveOlderThan)
title, priceEur, priceRaw, rooms, areaSqm, landAre, district, street, etc.
```

**ListingSnapshot** (created only when rawHtmlHash differs):

```
id:              INT @id @autoincrement()
listingId:       String
capturedAt:      DateTime @default(now())
priceEur:        Int?
description:     String?
rawHtmlHash:     String
```

---

## Invariants & Business Rules

1. **Concurrency = 1**: Only one SweepRun with `status='in_progress'` at a time. Each tick checks `findInProgressSweep()` before starting; phantom rows from crashes must be cancelled via UI before a new sweep can fire.

2. **Politeness budget** (non-negotiable per CLAUDE.md):
   - Inter-request delay: **8s base ± 2s jitter**.
   - Detail fetches: **10s delay** (per-call `delayMs` override of baseDelayMs).
   - Retries on 5xx: **exponential backoff** [10s, 30s, 90s].
   - User-Agent: realistic Firefox on Linux; no cookies.
   - Accept-Language: ro-RO, ru-RU, en.
   - **Single shared clock**: the Fetcher keeps one `lastRequestAt` field (fetch.ts:71) spanning _all_ requests — index and detail interleave on the same gap. Only the literal first request of the Fetcher's life is free (`lastRequestAt === 0`, fetch.ts:141-143). Because index pagination runs first, the **first detail fetch is NOT free** — it waits the full `detailDelayMs` since the last index page.
   - The HTML-interstitial guard (`rejectContentTypePrefix='text/html'`) is **hardcoded in `fetchGraphQL`** (fetch.ts:117), applied to every GraphQL POST; it is not a per-call toggle.

3. **Circuit breaker**:
   - **Tripwire 1**: 3 consecutive 4xx (excl. 404) → open for 24h. `failureCount` is **process-local** (circuit.ts:19); only the sentinel file carries state across cron ticks.
   - **Tripwire 2**: 403/429 → open immediately (IP-level block risk).
   - **Tripwire 3**: HTML response on GraphQL endpoint (CAPTCHA interstitial) → open immediately.
   - **Manual clear**: delete `/data/.circuit_open` sentinel or use UI button.
   - **Check at sweep-start**: if open, write row with `status='circuit_open'` and exit (no retries).
   - **A non-404 4xx does NOT throw**: `attempt()` records the failure on the circuit then **returns the 4xx response body** to the caller (fetch.ts:217-220). `fetchGraphQL` runs `JSON.parse(body)` unconditionally (fetch.ts:123), so a single non-404 4xx surfaces to the sweep as a `JSON.parse` exception (caught → `status='partial'`), not as an HTTP-status error. Non-404 4xx are **not retried** (retry covers thrown network errors and 5xx only).
   - **404 is neutral**: neither counted (excluded at fetch.ts:217) nor reset (`recordSuccess` only runs on the 2xx tail, fetch.ts:233). Its body is returned to the caller.
   - **Reset on success**: any 2xx with an accepted content-type calls `recordSuccess()` → `failureCount = 0`, so an intervening success breaks the "consecutive" run.

4. **Diff semantics**:
   - **new**: id not in DB → full detail fetch required.
   - **seen**: id in DB, present in this index → re-fetch to capture price/description changes; counts toward detail budget.
   - **delisting** (not a diff key): ids in DB but absent for ≥3 sweeps are marked inactive by `markInactiveOlderThan()`, run only after a complete index (status='ok').

5. **Detail targeting**:
   - Per-tick draw: `targetListingsThisSweep = mean ± random(jitter)`.
   - Pagination stops once stubs accumulate to the draw.
   - Detail fetching (new + seen) is capped to the same draw; the cap slice is computed after diffing.
   - Backfill + stale-refresh run _after_ the detail budget; they don't count toward the cap.

6. **Snapshot content-addressing**:
   - `persistDetail()` computes `rawHtmlHash` from normalized response.
   - Snapshot is inserted only if hash differs from the latest snapshot for that listing.
   - Unchanged listings skip DB write but still appear in `detailsDetail` for forensics.

7. **Filter enrichment**:
   - `filterValuesEnrichedAt` tracks when a listing was last fetched for filter triples.
   - Backfill picks listings with `filterValuesEnrichedAt IS NULL` (legacy rows + never-fetched).
   - `persistDetail()` always writes filter triples; backfill de-duplicates via upsert.

8. **Stale rotation**:
   - Listings are ordered (watchlist DESC, lastFetchedAt ASC).
   - Watchlist (operator-flagged) always fetches first; the long tail rotates oldest-first.
   - Fudge: 60-second skip on listings touched earlier in the same sweep.

9. **Age-out semantics**:
   - `missingThresholdMs = missingSweepsBeforeInactive × (24/expectedPerDay) × 3600s`.
   - Default: 3 sweeps × 12 hours = 36 hours.
   - Only fires when sweep reaches end of index (status='ok').

10. **Partial-sweep constraint**:
    - If pagination breaks early (parse error, page yields 0 stubs, or manual cancel), `status='partial'`.
    - Age-out is skipped (don't corrupt active set based on incomplete data).
    - Backfill + stale-refresh continue (they don't rely on complete index).

11. **Error recovery**:
    - Per-listing parse error → log, skip listing, continue sweep.
    - Per-listing fetch error → log, set status='partial', continue.
    - Index-page parse error → log, break pagination, status='partial'.
    - Unhandled exception → status='failed', record error, finalize.

12. **Progress visibility**:
    - `publishProgress()` called after each index page, detail batch, backfill/stale rotation.
    - UI polls `/api/sweeps/:id` to render counters live; without flushes, row stays at zeros until finishSweep.

13. **Counter semantics** (asymmetric, easy to misread):
    - `newListings` = the **cap-sliced** new-stub count, set once _before_ fetching (sweep.ts:156). A new listing whose `persistDetail` throws still counts.
    - `updatedListings` increments **only after a successful** `persistDetail` of a seen stub (sweep.ts:406). A failed persist does not count.
    - `detailsFetched` is a **grand total** across all four fetch phases (index-detail + backfill + stale, sweep.ts:317/402/447/501). New-listing details increment it before parse; seen details before persist.

14. **Abort is only reliable mid-fetch**: loops check `signal.aborted` at the top and `break` (sweep.ts:238/299/359) without throwing. An abort landing _between phases_ (no request in flight) raises no `AbortError`, so the outer catch's `signal.aborted` branch never runs and the status stays whatever it was (often `'ok'`) — NOT `'cancelled'`. Cancellation is observed only when a fetch is actively waiting (`sleepAbortable`) or in flight (fetch.ts:136).

15. **Backfill/stale propagate cancel & circuit**: a `CircuitTrippingError` or aborted signal during backfill or stale-refresh is **re-thrown** (sweep.ts:440/494), reaching the outer catch → `'circuit_open'` / `'cancelled'`. In that case `markSeen` and age-out are skipped (the throw bypasses them). Per-listing parse/persist/fetch errors in these phases are recorded as `'partial'` and continue.

16. **Quiet hours disabled via start == end**: `inQuietHours()` returns false when `quietHoursStart === quietHoursEnd` (index.ts:127). There is no separate enable flag; equal bounds is the disable mechanism. Ranges may wrap midnight (start > end).

17. **RUN_ONCE is still gated**: the smoke path calls `tick()`, which applies the quiet-hours and in-progress guards before `buildDeps`/`runSweep` (index.ts:142-150). A smoke run during quiet hours, or while a phantom `in_progress` row exists, logs `tick.skipped` and no-ops, then `process.exit(0)` fires anyway.

18. **tick()'s catch only logs**: an error escaping `runSweep` is caught in `tick()` and logged as `sweep.unhandled` (index.ts:154-156); it is never re-thrown to the cron callback, so the next tick still fires.

---

## Edge Cases & Failure Modes

### Scenario: 403 Received During Index Pagination

1. Fetcher sees 403 → calls `circuit.tripImmediately()` → writes sentinel.
2. Throws `CircuitTrippingError` (uncaught from `doRequest`).
3. Bubbles to `collectIndexStubs` → caught nowhere → propagates to `runSweep` outer catch.
4. `catch(CircuitTrippingError)` → set status = 'circuit_open'.
5. Next tick: `runSweep` pre-flight check sees open circuit → writes row immediately, exits.
6. **Outcome**: sweep stops, operator clears sentinel, resumption at next tick.

### Scenario: Parse Error on Detail Response

1. `parseDetail()` throws (schema drift, unexpected shape).
2. Caught in `fetchAndPersistDetails` (line 321–329).
3. If `AdvertNotFoundError` (delisted between index and detail), skip silently (not an error).
4. Otherwise, log error, record to `result.errors`, set status='partial', continue.
5. Listing is NOT persisted; DB state unchanged.
6. **Outcome**: data loss averted; operator reviews logs for schema changes.

### Scenario: Manual Cancel via UI

1. Operator clicks "Cancel Sweep" on SweepDetail page.
2. API calls `abortSweepRun(sweepId)` → finds controller, calls `controller.abort()`.
3. In-flight fetch: `sleepAbortable()` receives abort event → resolves immediately.
4. Next request: `run()` checks `opts.signal?.aborted` → throws AbortError.
5. `fetchAndPersistDetails` catch: `signal.aborted` is true → re-throw to outer catch.
6. `runSweep` outer catch: `controller.signal.aborted` → set status='cancelled'.
7. **Outcome**: sweep halts gracefully, row marked cancelled, next tick runs normally.

### Scenario: Long-Running Sweep Across Cron Tick

1. Sweep starts at 21:00, takes 45 minutes (e.g., 700 details + backfill).
2. Next cron tick fires at 21:xx (same schedule hour in different minute).
3. `tick()` calls `findInProgressSweep()` → finds existing row → logs skip + exits.
4. Cron tick is dropped (no queuing).
5. **Outcome**: concurrency guard prevents double-start; operator scales targetListingsPerSweep if sweeps routinely collide.

### Scenario: DB Connection Lost During Detail Persist

1. `persistDetail()` throws (Prisma connection pool exhausted, query timeout, network blip).
2. Caught in `fetchAndPersistDetails` (line 344–349).
3. Log error, record to `result.errors`, set status='partial', continue.
4. Listing is NOT persisted; stubs may be marked seen later (lastSeenAt bumped) but detail is lost.
5. **Outcome**: stale entry for this listing; next sweep may re-fetch and persist successfully.

### Scenario: Network Timeout on Backoff

1. Fetch fails on index page; Fetcher sleeps 10s before retry.
2. During sleep, `signal.aborted` fires (operator cancel).
3. `sleepAbortable()` resolves → check `if (opts.signal?.aborted)` → throw AbortError.
4. Retry loop exits; error annotated with attempt count.
5. `collectIndexStubs` catch: propagates to outer catch → status='cancelled'.
6. **Outcome**: clean abort, no retry resumption.

### Scenario: Quiet Hours Suppression

1. Cron fires at 03:00 local time (Europe/Chisinau).
2. `inQuietHours()` with `[quietHoursStart=2, quietHoursEnd=6]` → returns true.
3. `tick()` logs skip, exits (no `buildDeps`, no `runSweep`).
4. Manual sweep via UI button: `POST /api/sweeps` is not gated by quiet hours (operator override).
5. **Outcome**: cron is silent overnight; operator can still trigger as needed.

### Scenario: Pagination Cap Met Before End of Index

1. Sweep targets 700 listings; first 9 pages yield 78 × 9 = 702 stubs.
2. `collectIndexStubs` loop: page 9 accumulated >= 700 → break.
3. Diff + detail cap sliced to 700 total.
4. `markInactiveOlderThan()` call: status is 'ok' but we _did_ reach the index end (page yielded < 78 on next page).
5. **Edge**: if page 9 yields exactly 78, we don't know if there's a page 10.
6. **Mitigation**: operator observes "stubs capped to targetListingsThisSweep" in logs; adjust target or maxPagesPerSweep.

---

### Scenario: Abort Between Phases (Race Window)

1. Operator cancels just as the detail loop finishes its last fetch.
2. No request is in flight; the next loop (backfill/stale) sees `signal.aborted` at its top guard and `break`s without throwing.
3. The outer `try` completes normally; `controller.signal.aborted` is checked **only in the catch**, which is never entered.
4. **Outcome**: status persists as `'ok'`/`'partial'` (not `'cancelled'`). markSeen runs; age-out runs iff status was `'ok'`. Cancel is only crisp when caught mid-fetch.

### Scenario: Circuit Open With a Pre-Created Manual Row

1. Operator clicks "Run sweep"; the API creates SweepRun id=99 (`in_progress`) and calls `runSweep(deps, 99)`.
2. Circuit is open. Pre-flight branch calls `startSweep()` (a NEW row id=100), ignoring 99 (sweep.ts:117).
3. Row 100 is finished `circuit_open`; row 99 is left `in_progress`.
4. **Outcome**: orphan row 99 blocks the concurrency guard until the operator cancels it via `POST /api/sweeps/99/cancel`.

### Scenario: Single Non-404 4xx Reaches the Parser

1. GraphQL POST returns 400 with an HTML/error body.
2. `attempt()` calls `circuit.recordFailure()` then returns the body (no throw).
3. `fetchGraphQL` runs `JSON.parse(body)` → `SyntaxError`.
4. The sweep catches it as a fetch error → `status='partial'`, continues. After 3 such, the circuit trips on the next failure.

## Configuration & Operational Notes

### Environment Variables

| Variable       | Purpose                                      | Default                              |
| -------------- | -------------------------------------------- | ------------------------------------ |
| `RUN_ONCE`     | Run one sweep, exit immediately (smoke test) | unset                                |
| `NODE_ENV`     | Application mode                             | 'development'                        |
| `LOG_LEVEL`    | Pino log level                               | 'info'                               |
| `DATABASE_URL` | Postgres connection string                   | (required in prod)                   |
| `TZ`           | Container timezone                           | Europe/Chisinau (docker-compose.yml) |

### Postgres Settings (Runtime Mutable)

All keys live in the `Setting` table; `src/settings.ts` fetches them with fallbacks to `src/config.ts`.

**Politeness**:

- `politeness.baseDelayMs` (default 8000)
- `politeness.jitterMs` (default 2000)
- `politeness.detailDelayMs` (default 10000)

**Sweep tuning**:

- `sweep.maxPagesPerSweep` (default 50)
- `sweep.backfillPerSweep` (default 30)
- `sweep.staleRefreshPerSweep` (default 50)
- `sweep.targetListingsPerSweep` (default 700)
- `sweep.targetListingsJitter` (default 130)
- `sweep.expectedPerDay` (default 2)

**Cron**:

- `sweep.cronSchedule` (default '0 9,21 \* \* \*')
- `sweep.cronWindowJitterMs` (default 3600000, 1h)
- `sweep.quietHoursStart` (default 2)
- `sweep.quietHoursEnd` (default 6)

**Circuit breaker** (read-only at runtime; config.ts only):

- `CIRCUIT.consecutiveFailureThreshold` = 3
- `CIRCUIT.pauseDurationMs` = 86400000 (24h)
- `CIRCUIT.sentinelPath` = '/data/.circuit_open'

### Sentinel File

- **Path**: `/data/.circuit_open`
- **Contents**: empty (only mtime matters).
- **Manual clear**: delete file or call `DELETE /api/circuit`.
- **Auto-clear**: after `pauseDurationMs` (24h), `circuit.isOpen()` returns false.

### Filter Resolution

1. Check for `Source` row with `slug='999md'` and `filterOverridesJson`.
2. Fallback: use hardcoded `FILTER.searchInput` from config.ts.
3. Resolved once per tick in `buildDeps()` → frozen for duration of sweep (mid-tick mutations ignored).

### Log Streaming

- Pino outputs JSON to stdout → docker-compose captures with json-file driver.
- Log rotation: 10MB × 5 files (hardcoded in docker-compose.yml).
- Live SSE: sweep events emitted to `/api/sweeps/:id/events` for operator UI.

---

## Acceptance Criteria

1. **Scheduling**: Cron ticks at `sweep.cronSchedule` with ±`sweep.cronWindowJitterMs` jitter; quiet hours suppress cron but not manual triggers.

2. **Concurrency guard**: Only one SweepRun with `status='in_progress'` at any time; phantom rows must be manually cancelled.

3. **Politeness**: Index pages fetch with 8s ± 2s delay; detail pages with 10s delay. Retries on 5xx use [10s, 30s, 90s] backoff. No request fires until the delay has elapsed.

4. **Circuit breaker**:
   - 3 consecutive 4xx (excl. 404) → open for 24h.
   - 403/429 → open immediately.
   - HTML on GraphQL endpoint → open immediately.
   - Pre-flight check: if open at sweep-start, write row with status='circuit_open' and exit.

5. **Index pagination**: Iterate pages 0..(maxPagesPerSweep - 1). Stop early if (a) page yields 0 stubs, (b) accumulated stubs ≥ targetListingsThisSweep, (c) parse error.

6. **Diffing**: Compute new/seen sets (delisting is handled separately via `markInactiveOlderThan()`). Cap detail-fetch total to targetListingsThisSweep. Record detail metadata per listing.

7. **Detail fetching**:
   - Fetch all new IDs.
   - Re-fetch seen IDs to capture price/description changes.
   - Content-address snapshots on rawHtmlHash; skip DB write if hash unchanged.
   - Errors: log, record to SweepRun.errors, set status='partial', continue.

8. **Backfill**: Up to backfillPerSweep listings with filterValuesEnrichedAt IS NULL. Respects politeness delay.

9. **Stale-refresh**: Up to staleRefreshPerSweep listings (watchlist first, then oldest-last-fetched). Respects politeness delay.

10. **Mark seen**: Bump lastSeenAt on ALL seen stubs (from diff.seen), not the cap-sliced subset.

11. **Age-out**: Mark active=false on listings absent for > missingThresholdMs. Only fire on status='ok' (complete index).

12. **Progress visibility**: Call publishProgress() after each index page, detail batch, backfill, stale-refresh. Operator UI polls live.

13. **Status tracking**:
    - 'ok': full index reached, all detail fetches complete, age-out fired.
    - 'partial': pagination broke early or per-detail error occurred.
    - 'failed': unhandled exception.
    - 'circuit_open': circuit was open at sweep-start.
    - 'cancelled': operator cancelled via UI.

14. **Error handling**: Uncaught errors in tick() → log + exit tick. Errors in sweep → catch, record to SweepRun.errors, finalize (do not re-throw to tick).

15. **Abort support**: AbortController wired to Fetcher politeness wait + all outstanding detail fetches. Cancel resolves within ~100ms on backpressure wait.

16. **Logging**: Pino JSON to stdout; teed to EventEmitter for live SSE. Each log line includes timestamp, level, event name, metadata.

---

## Open Questions / Known Gaps

1. **Two-tier cadence** (PR 1 plumbing shipped; PR 2 pending):
   - `SweepRun.kind` column added (defaults 'legacy').
   - `FetchTask` and `ThrottleEvent` tables added (no producer/consumer wired yet).
   - `sweep.mode` setting added (defaults 'legacy', feature-gated for 'two_tier').
   - PR 2 will implement index ticker (60–120 min) + detail trickle (3–6 min per request) + adaptive soft-throttle observer.
   - See `docs/superpowers/specs/2026-05-10-politeness-two-tier-design.md` for full design.

2. **Adaptive soft-throttle** (deferred to PR 2):
   - Rolling-window observer watches 5xx-rate / latency-spike / connection-reset signals.
   - On trigger: multiply active delay by `softThrottleMultiplier` (default 3×) for `softThrottleDurationMinutes` (default 30).
   - Pre-emptive slowdown before the hard 24h circuit can trip.
   - Requires instrumentation of network-error patterns (not yet in place).

3. **Per-source filter overrides**:
   - `Source.filterOverridesJson` schema column exists (phase 4 UI layer).
   - Resolution logic in place (src/filter-resolver.ts).
   - Operator UI for editing not yet shipped.

4. **Seller portfolio graph** (Phase 2+):
   - `Listing.authorId` / `authorName` / `authorType` columns populated (next capture extends owner selection).
   - Phone-reveal operation not yet wired (phone is PII, requires separate legal/UX flow).
   - Dedup cluster computation (Phase 2) not yet implemented.

5. **Geo coordinates**:
   - `Listing.lat` / `lon` columns populated by parseDetail (mapPoint feature 3).
   - Opaque value shape; extraction defended.
   - Used for geo-proximity dedup in Phase 2.

6. **Filter taxonomy LUT**:
   - `parseDetail()` emits filterId=0 (unknown) and featureId/optionId pairs.
   - Persistence resolves featureId → filterId via `parse-taxonomy.ts` LUT.
   - LUT bootstrapped from hardcoded FILTER.searchInput on startup.
   - Full taxonomy query not yet captured (GraphQL operation exists, not wired to cron).

---

## Integration with Adjacent Subsystems

- **Operator UI** (`src/web/`): Polls `/api/sweeps` for live progress; `/api/sweeps/:id/events` for SSE stream; `/api/circuit` for breaker reset.
- **Settings layer** (`src/settings.ts`): Runtime-mutable tuning (politeness, pagination caps, quiet hours, cron schedule).
- **Persistence** (`src/persist.ts`): DB schema version control via Prisma migrations; snapshot content-addressing; filter triple enrichment.
- **Parsing** (`src/parse-*.ts`): Schema-drift mitigation via defensive extraction; feature tag/image capture.
- **Filter resolution** (`src/filter-resolver.ts`): Source-level + operator-level filter composition.
- **GraphQL** (`src/graphql.ts`): Operation strings and variable builders (SearchAds, GetAdvert).
