Feature: Sweep Orchestration & Crawl Pipeline
  In order to reliably harvest 999.md listings under strict politeness constraints
  As the house-track crawler
  I want sweeps scheduled hourly, indexed/diffed/fetched/persisted atomically,
  with circuit-breaker protection and live operator visibility.

  Background:
    Given the PostgreSQL database has been initialized with the Prisma schema
    And the circuit breaker is clear (no sentinel file)
    And politeness config: baseDelayMs=8000, jitterMs=2000, detailDelayMs=10000
    And the cron schedule is "0 9,21 * * *" (9am and 9pm Europe/Chisinau)
    And quiet hours are disabled ([2, 6) suppression)
    And no SweepRun with status='in_progress' exists

  # Scheduling & Bootstrap

  Scenario: Cron bootstrap reads settings and schedules correctly
    Given the Setting table has: sweep.cronSchedule = "0 10 * * *"
    And sweep.cronWindowJitterMs = 60000 (1 minute)
    When the crawler process starts in normal mode
    Then node-cron registers a schedule matching "0 10 * * *"
    And the next tick will be delayed by a random value between 0 and 60000ms
    And the Hono API server listens on 127.0.0.1:3000

  Scenario: RUN_ONCE=1 env triggers one-shot smoke test
    Given RUN_ONCE=1 environment variable
    When the crawler process starts
    Then it runs one tick immediately (no cron, no API server)
    And process.exit(0) is called after the sweep completes
    And the API server is not started

  # Quiet Hours

  Scenario: Cron tick is suppressed during quiet hours
    Given the current time is 03:30 Europe/Chisinau
    And sweep.quietHoursStart = 2, sweep.quietHoursEnd = 6
    When the cron fires
    Then tick() logs {event: "tick.skipped", reason: "quiet_hours"}
    And no SweepRun is created for this tick

  Scenario: Quiet hours wrap around midnight
    Given the current time is 04:00 Europe/Chisinau
    And sweep.quietHoursStart = 22, sweep.quietHoursEnd = 6
    When the cron fires
    Then tick() logs {event: "tick.skipped", reason: "quiet_hours"}
    And no SweepRun is created

  Scenario: Manual sweep via UI bypasses quiet hours
    Given the current time is 03:30 Europe/Chisinau
    And sweep.quietHoursStart = 2, sweep.quietHoursEnd = 6
    When POST /api/sweeps is called by the operator
    Then runSweep() is invoked immediately (ignoring quiet hours)
    And a SweepRun is created with trigger="manual"

  # Concurrency Guard

  Scenario: Cron tick is skipped if a sweep is already in progress
    Given a SweepRun with id=42 and status='in_progress' exists
    When the cron fires (or manual sweep is attempted)
    Then tick() logs {event: "tick.skipped", reason: "sweep_in_progress", activeSweepId: 42}
    And no new SweepRun is created

  Scenario: Phantom in-progress row from crash must be manually cancelled
    Given a SweepRun with id=77 and status='in_progress' and finishedAt=null from a crashed process
    When the operator calls POST /api/sweeps/77/cancel
    Then the row is updated with status="cancelled" and finishedAt set
    And the next cron tick can fire normally

  # Index Pagination

  Scenario: Index pagination fetches pages sequentially until 0 stubs or target reached
    Given GraphQL SearchAds endpoint returns 78 stubs per page
    And targetListingsThisSweep = 200
    When collectIndexStubs() runs
    Then:
      | Page | Stubs | Accumulated | Decision |
      | 0    | 78    | 78          | Continue (< 200) |
      | 1    | 78    | 156         | Continue (< 200) |
      | 2    | 78    | 234         | Break (>= 200) |
    And pagesFetched = 3
    And result.pagesDetail has 3 entries with bytes, attempts, parseMs, found, took

  Scenario: Index pagination stops on empty page (end of index)
    Given GraphQL SearchAds returns [78, 78, 0] stubs across pages
    And targetListingsThisSweep = 500
    When collectIndexStubs() runs
    Then pagination breaks after page 2 (0 stubs found)
    And result.pagesFetched = 3

  Scenario: Politeness delay is applied before each index request
    Given politeness.baseDelayMs = 8000, jitterMs = 2000
    When collectIndexStubs() fetches 3 pages
    Then:
      - No delay before page 0
      - Delay ~8s ± 2s before page 1
      - Delay ~8s ± 2s before page 2
    And total wall time >= 16s (2 × 8s)

  Scenario: Parse error on index page breaks pagination and sets status=partial
    Given page 0 returns valid JSON (78 stubs)
    And page 1 returns malformed JSON
    When parseIndex() on page 1 throws
    Then:
      - Error is caught in collectIndexStubs()
      - result.errors += {url: "<search-page-1>", status: null, msg: "parseIndex: ..."}
      - result.status = 'partial'
      - Pagination breaks (no page 2)
      - result.pagesFetched = 2

  # Diffing

  Scenario: Diffing computes new/seen sets correctly
    Given listings A, B exist in DB; C does not
    And current sweep stubs contain B, C, D
    When diffAgainstDb([B-stub, C-stub, D-stub]) is called
    Then:
      - diff.new = [C, D]
      - diff.seen = [B]
      - the result has only keys {new, seen}; there is no diff.gone (A's delisting is handled later by markInactiveOlderThan)

  Scenario: Cap slicing respects targetListingsThisSweep
    Given diff.new has 150 listings, diff.seen has 100 listings
    And targetListingsThisSweep = 200
    When detail-fetch cap is applied
    Then:
      - newStubs is sliced to min(150, 200) = 150
      - seenStubs is sliced to min(100, 200 - 150) = 50
      - Total capped to 200
      - But markSeen() still receives the original diff.seen (100), not the sliced 50

  # Detail Fetching

  Scenario: New listings trigger full detail fetch with 10s delay
    Given newStubs = ["X", "Y"]
    And politeness.detailDelayMs = 10000
    When fetchAndPersistDetails(newStubs, [], ...) runs
    Then:
      - Delay ~10s before second detail fetch (X → sleep → Y)
      - detailsFetched = 2
      - detailsDetail[0].action = 'new'
      - detailsDetail[1].action = 'new'

  # The Fetcher's politeness clock (lastRequestAt) is a single shared field
  # across index AND detail fetches (fetch.ts:71,140-151). Only the very first
  # request of the whole sweep skips the wait (lastRequestAt === 0). Because
  # index pagination always runs first and sets the clock, the first detail
  # fetch is NOT free — it waits the full detailDelayMs since the last index page.
  Scenario: First detail fetch still pays the politeness wait after index pages
    Given collectIndexStubs() already fetched >= 1 page (lastRequestAt is set)
    And politeness.detailDelayMs = 10000
    When fetchAndPersistDetails(["X"], [], ...) fetches the first detail
    Then:
      - maybeWaitBetweenRequests() computes target = detailDelayMs + jitter
      - The fetch waits ~10s (only the sweep's literal first request is free)
    And the "first request is free" exemption fires at most once per Fetcher instance

  Scenario: Seen listings are re-fetched to capture price/description changes
    Given seenStubs = ["A", "B"]
    When fetchAndPersistDetails([], seenStubs, ...) runs
    Then:
      - Both A and B are fetched
      - persistDetail(A) and persistDetail(B) are called
      - detailsDetail[0].action = 'updated'
      - detailsDetail[1].action = 'updated'

  Scenario: Parse error on detail response logs and continues
    Given detail fetch for "X" succeeds
    And parseDetail(json) throws {message: "Missing field roomCount"}
    When fetchAndPersistDetails([X], [], ...) runs
    Then:
      - Error is caught
      - result.errors += {url: "https://999.md/ro/X", status: null, msg: "parseDetail: Missing field roomCount"}
      - result.status = 'partial'
      - X is NOT persisted to DB
      - Sweep continues (no re-throw)

  Scenario: AdvertNotFoundError on detail (delisted between index and detail) is silent
    Given stub "X" in index, but detail fetch returns AdvertNotFoundError
    When parseDetail() is called
    Then:
      - Error is caught
      - Nothing is logged (silent skip)
      - No error recorded to result.errors
      - Sweep continues

  Scenario: DB error on persistDetail logs and continues
    Given detail fetch succeeds, parseDetail() succeeds
    And persist.persistDetail() throws {message: "connection timeout"}
    When fetchAndPersistDetails([X], [], ...) runs
    Then:
      - Error is caught
      - result.errors += {url: "...", msg: "persist: connection timeout"}
      - result.status = 'partial'
      - Sweep continues

  # Snapshot Content-Addressing

  Scenario: Snapshot is inserted only when rawHtmlHash changes
    Given listing "X" exists with one snapshot at rawHtmlHash "abc"
    When persistDetail(parsed with rawHtmlHash "abc") is called
    Then:
      - No new snapshot is inserted
      - Only one snapshot exists for "X"
      - detailsDetail records the fetch (for forensics)

  Scenario: Snapshot is inserted when rawHtmlHash differs
    Given listing "X" exists with one snapshot at rawHtmlHash "abc"
    When persistDetail(parsed with rawHtmlHash "xyz") is called
    Then:
      - A new snapshot is inserted with rawHtmlHash "xyz"
      - Two snapshots now exist for "X"

  # Backfill Enrichment

  Scenario: Backfill fetches listings with NULL filterValuesEnrichedAt
    Given sweep.backfillPerSweep = 10
    And 25 listings have filterValuesEnrichedAt IS NULL
    When backfillUnenriched() runs after detail-fetching
    Then:
      - persist.findUnenrichedListings(10) returns 10 IDs
      - Each is fetched and parseDetail() emits filter triples
      - Up to 10 listings are re-enriched
      - detailsFetched += 10
      - Each fetch respects 10s detail delay

  Scenario: Backfill respects the cap (disabled when 0)
    Given sweep.backfillPerSweep = 0
    When backfillUnenriched() runs
    Then:
      - No listings are fetched
      - backfillUnenriched() returns immediately

  # Stale-Refresh Rotation

  Scenario: Stale-refresh rotates old listings, watchlist first
    Given sweep.staleRefreshPerSweep = 5
    And watchlist flag is set on listing "W"
    And listings ["A", "B", "C"] have lastFetchedAt from 7+ days ago
    And listing "W" has lastFetchedAt from 3 days ago
    When staleRefresh() runs
    Then:
      - persist.findStaleListings(limit=5, sinceFetched=1min ago) returns: [W, A, B, C, ...nth]
      - Listings are re-fetched in order (watchlist wins tie)
      - detailsFetched += 5

  Scenario: Stale-refresh skips listings touched in the same sweep
    Given sweep started at time T
    And listing "X" had lastFetchedAt = T - 30s (touched in this sweep already)
    When staleRefresh() queries findStaleListings(sinceFetched = T - 60s)
    Then:
      - "X" is not returned (60s fudge excludes recent touches)

  Scenario: Stale-refresh is disabled when cap is 0
    Given sweep.staleRefreshPerSweep = 0
    When staleRefresh() runs
    Then:
      - No listings are fetched
      - staleRefresh() returns immediately

  # Age-Out

  Scenario: Age-out marks inactive listings absent for > missingThresholdMs
    Given missingThresholdMs = 129600000 (3 sweeps × 12h per sweep)
    And listing "OLD" has lastSeenAt from 5 days ago
    And listing "FRESH" has lastSeenAt from 1 day ago
    And both are active=true
    When markInactiveOlderThan(129600000) is called
    Then:
      - "OLD".active flips to false
      - "FRESH".active remains true
      - result.status = 'ok' (sweep reached end of index)

  Scenario: Age-out is skipped on partial sweeps
    Given pagination broke early due to parse error
    And result.status = 'partial'
    And listing "MISSING" has lastSeenAt from 5 days ago
    When runSweep finishes
    Then:
      - markInactiveOlderThan() is NOT called
      - "MISSING".active remains true (preserved)

  Scenario: Mark seen bumps lastSeenAt on all seen stubs
    Given diff.seen = [A, B, C]
    And detail cap sliced seenStubs to [A, B] (skipped C)
    When markSeen(diff.seen) is called
    Then:
      - A.lastSeenAt is bumped to now
      - B.lastSeenAt is bumped to now
      - C.lastSeenAt is bumped to now (receives full diff, not cap-sliced)

  # Circuit Breaker

  Scenario: 3 consecutive 4xx (excl. 404) opens circuit for 24h
    Given pristine circuit (no sentinel)
    When fetch returns 400
    Then circuit.recordFailure() sets failureCount = 1 (no sentinel yet)
    When fetch returns 401
    Then circuit.recordFailure() sets failureCount = 2
    When fetch returns 405
    Then circuit.recordFailure() sets failureCount = 3
    And circuit.openSentinel() writes /data/.circuit_open with mtime = now
    And circuit.isOpen() returns true

  Scenario: 404 errors do not increment circuit counter
    Given pristine circuit
    When fetch returns 404
    Then circuit.recordFailure() is NOT called
    And failureCount = 0
    # 404 also is NOT a recordSuccess() — the counter is left untouched, neither
    # incremented (fetch.ts:217 excludes 404) nor reset (recordSuccess only runs
    # on the 2xx tail at fetch.ts:233). A 404 returns its body to the caller.

  # A non-404 4xx (400/401/405/...) does NOT throw. attempt() records the
  # failure on the circuit and then RETURNS {res, attempts} with the 4xx body
  # (fetch.ts:217-220). fetchGraphQL then runs JSON.parse(res.body) on that
  # body unconditionally (fetch.ts:123). So a single non-404 4xx surfaces to
  # the sweep as a JSON.parse exception, NOT as an HTTP-status error.
  Scenario: Single non-404 4xx records failure but returns body to caller
    Given pristine circuit (failureCount = 0)
    When fetchGraphQL receives 400 with a non-JSON body
    Then:
      - circuit.recordFailure() runs (failureCount = 1, no sentinel yet)
      - attempt() returns the response (no throw)
      - fetchGraphQL JSON.parse(body) throws a SyntaxError
      - The sweep catches it as a fetch/parse error, status='partial', continues
    And the 4xx is NOT retried (retry only covers thrown network errors and 5xx)

  Scenario: An intervening success breaks the consecutive-4xx run
    Given two non-404 4xx fetches have set failureCount = 2
    When the next fetch returns 200 with a valid JSON body
    Then circuit.recordSuccess() resets failureCount to 0
    And a subsequent single 4xx only brings failureCount back to 1 (no trip)
    # failureCount is process-local (circuit.ts:19) — it does not persist across
    # cron ticks. The sentinel file is the only cross-tick circuit state.

  Scenario: Successful fetch resets circuit counter
    Given circuit.failureCount = 2
    When fetch returns 200
    Then circuit.recordSuccess() sets failureCount = 0

  Scenario: 403 or 429 opens circuit immediately (no count needed)
    Given pristine circuit
    When fetch returns 403
    Then circuit.tripImmediately() writes /data/.circuit_open
    And CircuitTrippingError(403, url, attempts) is thrown
    And sweep catches it, sets status='circuit_open', exits

  Scenario: HTML response on GraphQL endpoint trips circuit (CAPTCHA interstitial)
    Given fetch returns 200 with Content-Type: text/html
    And opts.rejectContentTypePrefix = 'text/html'
    When doRequest() detects HTML body
    Then circuit.tripImmediately() writes sentinel
    And CircuitTrippingError is thrown

  Scenario: Pre-flight circuit check skips sweep if open
    Given /data/.circuit_open sentinel with mtime from 2 hours ago
    When runSweep(deps) is called
    Then:
      - circuit.isOpen() returns true (24h pause not yet elapsed)
      - No index pagination occurs
      - SweepRun row is created with status='circuit_open'
      - Sweep exits immediately

  Scenario: Circuit auto-clears after 24h
    Given /data/.circuit_open sentinel with mtime from 25 hours ago
    When circuit.isOpen() is called
    Then:
      - (now - mtime) = 25h > 24h
      - Returns false
      - Next tick proceeds normally

  Scenario: Manual circuit reset via UI
    Given circuit is open (sentinel exists)
    When DELETE /api/circuit is called
    Then:
      - /data/.circuit_open is deleted
      - circuit.isOpen() returns false
      - Next tick proceeds

  # Retry & Backoff

  Scenario: 5xx errors trigger retry with exponential backoff
    Given retryBackoffsMs = [10000, 30000, 90000]
    When fetch returns 502 on attempt 0
    Then:
      - Sleep 10s
      - Retry attempt 1
    When attempt 1 returns 503
    Then:
      - Sleep 30s
      - Retry attempt 2
    When attempt 2 returns 500
    Then:
      - Sleep 90s
      - Retry attempt 3
    When attempt 3 returns 500
    Then:
      - Retry budget exhausted
      - Throw error annotated with attempts=4
      - Sweep logs {url, status: null, msg: "5xx after retries: 500 ...", attempts: 4}

  Scenario: Network error retries with same backoff
    Given fetch throws "ECONNREFUSED"
    When attempt() catches error
    Then:
      - If backoff available, sleep and retry
      - If backoff exhausted, throw with attempts count

  # Politeness Wait & Abort

  Scenario: Politeness wait respects AbortSignal
    Given Fetcher is sleeping for 8s before next request
    When operator cancels sweep (abortController.abort())
    Then:
      - sleepAbortable() receives 'abort' event
      - Promise resolves immediately (< 100ms)
      - Next request check: opts.signal.aborted is true
      - Throw AbortError
      - Sweep catches and sets status='cancelled'

  Scenario: Politeness wait does not block graceful shutdown
    Given a detail fetch is sleeping ~8s between requests
    When process receives SIGTERM
    Then:
      - sleepAbortable() races timeout vs signal
      - Signal event fires, resolves the promise
      - Fetch loop stops cleanly
      - finishSweep writes partial status

  # Progress Publishing

  Scenario: Progress is published after each index page
    Given fetchIndexStubs() on 3 pages
    When each page is fetched and parsed
    Then publishProgress() is called 3 times
    And SweepRun.pagesFetched is flushed to DB after each page
    And operator UI polls GET /api/sweeps/:id and sees 1, 2, 3 incrementally

  Scenario: Progress is published after each detail batch
    Given 150 new details to fetch
    When each detail is persisted
    Then publishProgress() is called frequently (not after every detail, but regularly)
    And SweepRun.detailsFetched increments live
    And progress bars update in operator UI

  Scenario: DB blip during progress publish does not abort sweep
    Given publishProgress() call
    And Prisma recordSweepProgress() throws "connection timeout"
    When error is caught
    Then:
      - Log {event: "sweep.progress.publish_failed", ...}
      - Sweep continues (error not re-thrown)
      - Next publishProgress() attempt may succeed

  # Sweep Status Tracking

  Scenario: Sweep completes with status=ok
    Given pagination reached end of index
    And all details fetched without error
    And no parse errors on index pages
    When runSweep finishes
    Then:
      - result.status = 'ok'
      - finishSweep() writes SweepRun with status='ok'
      - Age-out is fired (markInactiveOlderThan was called)

  Scenario: Sweep completes with status=partial on pagination error
    Given page 2 parse fails
    When collectIndexStubs() catches error and breaks
    Then:
      - result.status = 'partial'
      - Details are still fetched from pages 0–1 stubs
      - Backfill + stale-refresh still run
      - Age-out is NOT fired (incomplete index)
      - finishSweep() writes status='partial'

  Scenario: Sweep completes with status=failed on unhandled error
    Given runSweep() throws "Unexpected: X is null"
    When outer catch() fires
    Then:
      - result.status = 'failed'
      - Error is recorded to result.errors[0]
      - finishSweep() writes status='failed'
      - log.error() is called with full error context

  Scenario: Sweep completes with status=cancelled on operator abort
    Given operator clicks "Cancel" on SweepDetail page
    When abortController.abort() fires
    Then:
      - Current fetch's sleepAbortable() resolves
      - Next request check fails, throws AbortError
      - Outer catch: controller.signal.aborted is true
      - result.status = 'cancelled'
      - finishSweep() writes status='cancelled'

  Scenario: Sweep completes with status=circuit_open if open at start
    Given circuit is open
    When runSweep() pre-flight checks circuit.isOpen()
    Then:
      - Returns true
      - Log {event: "sweep.skip", reason: "circuit_open"}
      - SweepRun created with status='circuit_open'
      - No index pagination occurs

  # Error Serialization

  Scenario: SweepRun.errors is serialized as JSON array
    Given detail fetch for "X" fails with status 500
    And index page 1 parse fails
    When finishSweep(result) is called
    Then:
      - result.errors has 2 entries: [{url, status, msg, attempts}, {url, status, msg, attempts}]
      - SweepRun.errors is JSON.stringify(result.errors)
      - Operator UI parses and displays in Errors tab

  # Configuration Snapshot

  Scenario: configSnapshot is captured at sweep start
    Given setting sweep.maxPagesPerSweep = 25
    And setting sweep.targetListingsPerSweep = 650
    When runSweep() starts
    Then:
      - deps.persist.snapshotConfig() is called inside try
      - Returns current Setting values (keys like "sweep.maxPagesPerSweep")
      - Override with deps values (e.g., deps.maxPagesPerSweep = 50 for smoke test)
      - result.configSnapshot stored
      - finishSweep() writes it to SweepRun.configSnapshot (JSON)

  # Detail Metadata

  Scenario: Detail forensics are recorded per listing
    Given detail fetch for "X" takes 45ms parsing, 8.2KB, 1 attempt
    And price is 95000 EUR
    When detail is persisted
    Then:
      - detailsDetail.push({id: "X", url: "https://999.md/ro/X", status: 200, bytes: 8200, attempts: 1, parseMs: 45, action: "new", priceEur: 95000})
      - Operator UI can render forensics table (price, parsing latency, retry count, action type)

  # Logging & SSE

  Scenario: Sweep events are streamed live via SSE
    Given a sweep is active (activeSweepId = 42)
    When log.info({event: "sweep.page", page: 1, found: 78}) is called
    Then:
      - Pino writes JSON to stdout
      - teeStream reads JSON, emits to sweepEvents EventEmitter
      - GET /api/sweeps/42/events SSE client receives event with timestamp, level, msg, metadata
      - Operator UI updates live status

  Scenario: Non-sweep logs are not SSE-emitted
    Given activeSweepId = null (no active sweep)
    When log.info({event: "api.request", path: "/api/circuit"}) is called
    Then:
      - Pino writes JSON to stdout
      - teeStream tries to emit, but sweepId is null
      - No SSE event (sweepId guard skips emission)

  # Ordinal Test Scenario: Full Happy Path

  Scenario: Full happy-path sweep: schedule → fetch → persist → report
    Given politeness delays, no circuit open, targetListingsThisSweep=200
    And 3 index pages, 200 total stubs (100 new, 100 seen)
    And all GraphQL requests succeed
    And all parseIndex() calls succeed
    And all parseDetail() calls succeed
    And all persistDetail() calls succeed
    When cron fires at 21:00
    Then:
      - SweepRun created with status='in_progress'
      - Fetcher applies 8s ± 2s between index pages (3 requests)
      - parseIndex() yields 78, 78, 44 stubs
      - diffAgainstDb() returns new=100, seen=100
      - fetchAndPersistDetails() fetches 200 details with 10s ± 0s delays
      - 100 new snapshots inserted, 100 seen snapshots conditionally inserted
      - backfillUnenriched() fetches up to 30 legacy listings
      - staleRefresh() fetches up to 50 old listings
      - markSeen() bumps lastSeenAt on all 100 seen stubs
      - markInactiveOlderThan() marks gone listings as inactive
      - result.status = 'ok'
      - finishSweep() writes SweepRun with all counters, no errors
      - log: {event: "sweep.done", status: "ok", pagesFetched: 3, detailsFetched: 280, newListings: 100, updatedListings: 100}
      - Operator UI shows complete summary with 0 errors

  # ── Gaps surfaced by adversarial review against src/ ──

  # runSweep(deps, initialSweepId?) takes an OPTIONAL pre-created sweep id
  # (sweep.ts:114,122). Manual sweeps create the SweepRun row in the API layer
  # first, then pass its id so the row the operator is already watching is the
  # one that gets driven — startSweep() is skipped.
  Scenario: Manual sweep reuses a pre-created SweepRun via initialSweepId
    Given the API created SweepRun id=99 with trigger='manual', status='in_progress'
    When runSweep(deps, 99) is called
    Then:
      - deps.persist.startSweep() is NOT called (id 99 reused)
      - activeSweepId = 99
      - finishSweep(99, result) writes the terminal status onto the same row

  # BUG-SHAPED EDGE: the circuit pre-flight branch (sweep.ts:115-120) always
  # calls startSweep() and ignores initialSweepId. If a manual sweep already
  # created id=99 and the circuit is open, runSweep creates a SECOND row,
  # finishes that one as circuit_open, and leaves id=99 stuck in_progress.
  Scenario: Circuit-open pre-flight ignores initialSweepId and orphans the manual row
    Given the circuit is open (sentinel within pause window)
    And the API pre-created SweepRun id=99 status='in_progress'
    When runSweep(deps, 99) is called
    Then:
      - circuit.isOpen() returns true
      - A NEW SweepRun row (not 99) is created via startSweep()
      - That new row is finished with status='circuit_open'
      - SweepRun id=99 is left status='in_progress' (must be cancelled by operator)
    # Documented as a known wart; the concurrency guard will then block the next
    # tick until id=99 is manually cancelled.

  # An abort that lands BETWEEN phases (not during an in-flight fetch) does not
  # throw. collectIndexStubs / detail loops check signal.aborted at the loop
  # top and `break` (sweep.ts:238,299,359) without throwing. If nothing is
  # in-flight to raise AbortError, the try-block completes normally and status
  # stays 'ok'/'partial' — the outer catch's signal.aborted check never runs.
  Scenario: Abort landing between phases does not mark the sweep cancelled
    Given a sweep is mid-flight and all fetches have already returned
    When abortController.abort() fires while no request is in flight
    Then:
      - The next phase's loop sees signal.aborted and breaks early
      - No AbortError is thrown, so the outer catch is not entered
      - result.status remains whatever it was (e.g. 'ok'), NOT 'cancelled'
      - markSeen still runs; age-out runs iff status was 'ok'
    # Cancellation is only reliably observed when a fetch is actively waiting or
    # in flight (sleepAbortable / signal check in Fetcher.run, fetch.ts:136).

  # CircuitTrippingError or an abort during backfill/stale-refresh is RE-THROWN
  # (sweep.ts:440,494) so it reaches runSweep's outer catch — even though these
  # phases run after the main detail budget.
  Scenario: Circuit trips during backfill — sweep ends circuit_open not partial
    Given detail fetching completed with status='ok'
    And backfillUnenriched() issues a fetch that returns 429
    When the Fetcher throws CircuitTrippingError
    Then:
      - backfillUnenriched re-throws (does not swallow as 'partial')
      - runSweep outer catch sets result.status='circuit_open'
      - markSeen was NOT reached (threw before it)

  Scenario: Abort during stale-refresh ends the sweep cancelled
    Given backfill finished, staleRefresh() is fetching
    When operator aborts mid stale-fetch
    Then:
      - staleRefresh re-throws the abort
      - outer catch sees controller.signal.aborted, status='cancelled'

  # Counter semantics differ between new and seen, and between the four phases.
  Scenario: newListings is the cap-sliced count, set before any fetch
    Given diff.new has 150 ids and the cap slices newStubs to 120
    When runSweep proceeds
    Then:
      - result.newListings = 120 (sweep.ts:156, set from the sliced array length)
      - A new listing whose persistDetail() throws STILL counts in newListings
        (the count is the planned slice, not successful persists)

  Scenario: updatedListings counts only successfully-persisted seen listings
    Given seenStubs = [A, B], persistDetail(A) succeeds, persistDetail(B) throws
    When fetchAndPersistDetails runs
    Then:
      - result.updatedListings = 1 (incremented only after persist succeeds, sweep.ts:406)
      - result.detailsFetched counts BOTH A and B (incremented before persist, sweep.ts:402)
      - B contributes a 'persist: ...' error and status='partial'

  Scenario: detailsFetched is a grand total across all four fetch phases
    Given 200 detail fetches + 30 backfill + 50 stale-refresh
    When the sweep finishes
    Then:
      - result.detailsFetched = 280 (index-detail + backfill + stale all increment it)
      - newListings/updatedListings only reflect the index-detail phase

  # Quiet hours are DISABLED by setting start === end (index.ts:127), not by a
  # separate flag. The Background "quiet hours are disabled" means start == end.
  Scenario: Quiet hours disabled when start equals end
    Given sweep.quietHoursStart = 6 and sweep.quietHoursEnd = 6
    When the cron fires at any hour
    Then inQuietHours() returns false (no suppression)

  # RUN_ONCE routes through tick(), so the quiet-hours and in-progress guards
  # still apply (index.ts:142-150). A smoke run can no-op then exit(0).
  Scenario: RUN_ONCE smoke test is still gated by quiet hours and concurrency
    Given RUN_ONCE=1 and the current time is inside quiet hours
    When the process starts and tick() runs
    Then:
      - tick() logs {event: "tick.skipped", reason: "quiet_hours"}
      - No sweep runs
      - process.exit(0) still fires after tick() resolves

  Scenario: RUN_ONCE no-ops if a phantom in-progress row exists
    Given RUN_ONCE=1 and a SweepRun with status='in_progress' exists
    When tick() runs
    Then:
      - tick() logs {event: "tick.skipped", reason: "sweep_in_progress"}
      - No new sweep starts; process.exit(0) fires

  # The HTML-interstitial guard is hardcoded for every GraphQL POST, not a
  # per-call option (fetch.ts:117).
  Scenario: HTML-interstitial rejection applies to all GraphQL POSTs
    Given fetchGraphQL is used for both SearchAds and GetAdvert
    Then rejectContentTypePrefix='text/html' is set unconditionally in fetchGraphQL
    And any 2xx text/html body on either operation trips the breaker

  # tick()'s own catch only logs; it never re-throws to the cron callback.
  Scenario: Unhandled error escaping runSweep is logged but does not crash cron
    Given runSweep() itself throws before its internal try (unexpected)
    When tick()'s try/catch catches it
    Then:
      - log.error({event: "sweep.unhandled", err}) is emitted
      - tick() returns; the next cron tick still fires

  # The API listen host is env-driven so the same entrypoint works for the
  # host-local path (loopback) and the container (published-port reachable).
  Scenario: API bind host is configurable via HOST env
    Given the crawler boots its Hono API server (index.ts bootstrap)
    When HOST is set in the environment
    Then the server binds that host
    And when HOST is unset it defaults to 127.0.0.1
