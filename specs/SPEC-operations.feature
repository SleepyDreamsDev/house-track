Feature: Operations: Politeness, Capture-Session, Deployment
  In order to crawl 999.md without triggering anti-bot defenses, scale the crawler safely to production,
  and maintain the GraphQL schema as 999.md evolves,
  I want the operational subsystem to enforce politeness constraints, persist settings at runtime,
  manage the circuit breaker lifecycle, and provide a runbook for manual schema capture.

  Background:
    Given a working Docker Compose stack with Postgres + Crawler + Operator UI
    And TZ=Europe/Chisinau set in both services
    And a PrismaClient pooled for cron ticks
    And POLITENESS.baseDelayMs=8000, jitterMs=2000, detailDelayMs=10000
    And CIRCUIT.consecutiveFailureThreshold=3, pauseDurationMs=86400000, sentinelPath='/data/.circuit_open'
    And DEFAULT_SCHEDULE='0 9,21 * * *' (9 AM + 9 PM Europe/Chisinau)
    And SWEEP defaults: quietHoursStart=2, quietHoursEnd=6 (quiet hours ON by default),
        cronWindowJitterMs=3600000 (1h), expectedPerDay=2, targetListingsPerSweep=700,
        targetListingsJitter=130, backfillPerSweep=30, staleRefreshPerSweep=50, maxPagesPerSweep=50

  # Politeness enforcement tests

  Scenario: Inter-request delay is 8s±2s per Fetcher instance
    Given a Fetcher with baseDelayMs=8000, jitterMs=2000
    When the first request is issued
    Then no delay is applied (lastRequestAt is 0)
    And the response is returned
    And lastRequestAt is updated to Date.now()

  Scenario: Subsequent requests observe the inter-request gap
    Given a Fetcher with baseDelayMs=8000, jitterMs=2000
    And lastRequestAt is set to 100 ms in the past
    And jitter() returns 1000
    When the second request is issued at t=7500
    Then the Fetcher sleeps for 3500 ms (target=9000, elapsed=7500)
    And lastRequestAt is updated to 10500
    And the request is sent

  Scenario: Detail fetches override baseDelayMs with detailDelayMs
    Given a Fetcher with baseDelayMs=8000, detailDelayMs=10000
    When fetchAdvert() is called with delayMs=10000
    Then maybeWaitBetweenRequests observes the 10000 override
    And the detail fetch is slower than index fetches

  Scenario: Jitter is symmetric around ±jitterMs
    Given jitter() is mocked to return values [-2000, -1000, 0, 1000, 2000]
    When five requests are issued in sequence
    Then the delays vary between 6000 and 10000 (base±jitter)

  Scenario: Concurrency is 1 — only one request is inflight at a time
    Given a Fetcher instance
    When two requests are queued simultaneously
    Then the first request waits for the inter-request gap
    And the second request waits for the first to complete + another gap
    And no requests overlap

  Scenario: 5xx errors trigger retry with exponential backoff
    Given a Fetcher with retryBackoffsMs=[10000, 30000, 90000]
    And a URL that returns 500, then 500, then 200
    When fetchPage() is called
    Then the Fetcher sleeps 10s between attempt 1 and 2
    And sleeps 30s between attempt 2 and 3
    And returns the 200 response on attempt 3
    And the response includes attempts=3

  Scenario: Network errors are retried with the same backoff schedule
    Given a Fetcher with retryBackoffsMs=[10000, 30000, 90000]
    And a URL that times out twice, then succeeds
    When fetchPage() is called
    Then retry logic applies (10s, then 30s)
    And the response is returned on the third attempt

  Scenario: 403 Forbidden trips the circuit immediately
    Given a Fetcher and a Circuit with threshold=3
    And a URL that returns 403
    When fetchGraphQL() is called
    Then circuit.tripImmediately() is invoked on the FIRST occurrence (no retry, no threshold)
    And CircuitTrippingError is thrown (carrying status=403 and attempts=1)
    And circuit.recordFailure() is NOT called
    And the sentinel file is created

  Scenario: 429 Too Many Requests trips the circuit immediately
    Given a Fetcher and Circuit
    And a URL that returns 429
    When fetchGraphQL() is called
    Then CircuitTrippingError is thrown
    And circuit.tripImmediately() is invoked
    And the sentinel file is created

  Scenario: 404 is a success path, not retried, not circuit-tripping
    Given a Fetcher and Circuit
    And a URL that returns 404
    When fetchPage() is called
    Then the Fetcher does NOT retry (no backoff applied)
    And circuit.recordFailure() is NOT called
    And circuit.recordSuccess() IS called (404 falls through to the success path)
    And the 404 response is returned to the caller (attempts=1)

  Scenario: Non-404 4xx records one failure and returns without retry
    Given a Fetcher and a Circuit with threshold=3
    And a URL that returns 401 (or 400/405)
    When fetchPage() is called
    Then circuit.recordFailure() is called exactly once
    And the Fetcher does NOT retry (the 401 response is returned, attempts=1)
    And the breaker opens only after 3 such occurrences across separate requests

  Scenario: HTML content-type on GraphQL endpoint is rejected as interstitial
    Given a Fetcher with rejectContentTypePrefix='text/html'
    And a GraphQL endpoint that returns 200 OK with content-type: text/html (CAPTCHA)
    When fetchGraphQL() is called
    Then the response is rejected before JSON.parse()
    And CircuitTrippingError is thrown (trip immediately)
    And the sentinel file is created

  Scenario: Headers include User-Agent, Accept-Language, Origin, Referer
    Given a Fetcher with POLITENESS headers configured
    When fetchGraphQL() is called
    Then the request includes:
      | Header            | Value |
      | User-Agent        | Mozilla/5.0 (X11; Linux x86_64; rv:128.0)... |
      | Accept-Language   | ro-RO,ru-RU;q=0.9,en;q=0.8 |
      | Origin            | https://999.md |
      | Referer           | https://999.md/ro/list/real-estate/houses-and-yards |
      | Sec-Fetch-Dest    | empty |
      | Sec-Fetch-Mode    | cors |
      | Sec-Fetch-Site    | same-origin |

  Scenario: GraphQL POST uses acceptJson, HTML/index fetches use accept
    Given POLITENESS.accept='text/html,application/xhtml+xml' and acceptJson='application/json, text/plain, */*'
    When a GraphQL POST is issued
    Then the Accept header is 'application/json, text/plain, */*' (acceptJson)
    When a plain HTML/index fetch is issued
    Then the Accept header is 'text/html,application/xhtml+xml' (accept)

  Scenario: No cookies are sent in any request
    Given a Fetcher
    When any request is issued
    Then the Cookie header is absent
    And the request carries no session state

  # Circuit breaker tests

  Scenario: Circuit opens on the Nth consecutive 4xx (threshold=3)
    Given a Circuit with consecutiveFailureThreshold=3
    When recordFailure() is called for the 1st time
    Then the sentinel file is NOT created yet
    When recordFailure() is called for the 2nd time
    Then the sentinel file is NOT created yet
    When recordFailure() is called for the 3rd time
    Then the sentinel file is created
    And isOpen() returns true

  Scenario: Circuit isOpen() checks sentinel mtime against pauseDurationMs
    Given a Circuit with pauseDurationMs=86400000 (24h)
    And the sentinel file exists with mtime=1 hour ago
    When isOpen() is called
    Then the file is still within the 24h window
    And returns true

  Scenario: Circuit isOpen() returns false when pause expires
    Given a Circuit with pauseDurationMs=86400000 (24h)
    And the sentinel file exists with mtime=25 hours ago
    When isOpen() is called
    Then the file is outside the 24h window
    And returns false

  Scenario: recordSuccess() resets the failure counter to 0
    Given a Circuit with recordFailure() called twice
    And failureCount=2
    When recordSuccess() is called
    Then failureCount is reset to 0

  Scenario: tripImmediately() opens sentinel without waiting for threshold
    Given a Circuit
    And a 403 response is received (unambiguous block signal)
    When circuit.tripImmediately() is called
    Then the sentinel file is created immediately
    And isOpen() returns true on the next check
    And no threshold is needed

  Scenario: Manual circuit reset via operator UI
    Given a Circuit with the sentinel file present (paused)
    When the operator clicks "Reset circuit breaker" in the Sweeps page
    Then the sentinel file is deleted
    And circuit.isOpen() returns false
    And the next cron tick proceeds normally

  Scenario: Manual circuit reset via terminal
    Given a Circuit with the sentinel file present at CIRCUIT.sentinelPath (default /data/.circuit_open)
    When the operator deletes the sentinel at that path
    Then the sentinel file is gone
    And circuit.isOpen() returns false
    And the next sweep is not skipped
    # NOTE: the path is absolute (/data/.circuit_open). A relative "rm data/.circuit_open"
    # only works when CWD is the parent of /data; inside the container the path is /data.

  # Cron + settings tests

  Scenario: Cron schedule is read from Setting table at boot
    Given the Setting table has key='sweep.cronSchedule', valueJson='"0 9,21 * * *"'
    When the crawler boots
    Then cron.schedule('0 9,21 * * *') is called
    And the crawler listens for ticks at 9 AM and 9 PM Europe/Chisinau

  Scenario: Cron uses default schedule if no Setting exists
    Given the Setting table is empty
    When the crawler boots
    Then cron.schedule('0 9,21 * * *') is called (hardcoded default)

  Scenario: Cron schedule changes require a process restart
    Given the crawler is running with cron.schedule('0 9,21 * * *')
    And the operator changes sweep.cronSchedule to '0 * * * *' (every hour)
    When the operator saves the setting
    Then the Setting row is updated
    But the running cron schedule is NOT changed (old '0 9,21' still applies)
    When the operator restarts the crawler container
    Then cron.schedule('0 * * * *') is called (new schedule)

  Scenario: Cron ticks are offset by cronWindowJitterMs
    Given the Setting table has sweep.cronWindowJitterMs=5000
    And cron fires at 2026-06-01 09:00:00
    When the tick is offset by jitter
    Then the tick is deferred by 0..5000 ms randomly
    And tick() is called after the offset

  Scenario: Quiet hours suppress cron ticks
    Given the Setting table has sweep.quietHoursStart=22, sweep.quietHoursEnd=6
    And the current hour in Europe/Chisinau is 23
    When cron fires
    Then tick() is skipped
    And the log contains event='tick.skipped', reason='quiet_hours'

  Scenario: Quiet hours range wraps midnight
    Given sweep.quietHoursStart=22, sweep.quietHoursEnd=6 (wraps 22:00..05:59)
    And the current hour is 3 (within the range)
    When inQuietHours() is called
    Then it returns true (3 >= 22 OR 3 < 6)
    When the current hour is 12 (outside the range)
    Then it returns false (NOT (12 >= 22 OR 12 < 6))

  Scenario: Quiet hours don't wrap when start < end
    Given sweep.quietHoursStart=9, sweep.quietHoursEnd=17 (9 AM to 5 PM)
    And the current hour is 10
    Then inQuietHours() checks 10 >= 9 AND 10 < 17 (true)
    When the current hour is 8
    Then inQuietHours() checks 8 >= 9 AND 8 < 17 (false)

  Scenario: Quiet hours are disabled when start == end
    Given sweep.quietHoursStart=12, sweep.quietHoursEnd=12
    When inQuietHours() is called at any hour
    Then it returns false (disabled)

  Scenario: Quiet hours are ON by default (02:00..05:59 Europe/Chisinau)
    Given no Setting overrides for quiet hours
    Then sweep.quietHoursStart defaults to 2 and sweep.quietHoursEnd defaults to 6
    And a cron tick fired at 03:00 Europe/Chisinau is suppressed by default
    And a cron tick fired at 09:00 proceeds

  Scenario: Cron-fire jitter defaults to 1 hour, not 5 seconds
    Given no Setting override for sweep.cronWindowJitterMs
    Then it defaults to 3600000 ms (1h)
    And after the cron expression fires, tick() is deferred by setTimeout(random(0, 3600000))

  Scenario: Manual sweep triggers bypass quiet hours
    Given quiet hours are active (suppressing cron)
    When the operator clicks "Run smoke" button
    Then the sweep runs immediately (quiet hours are bypassed)

  Scenario: Settings are read once per sweep start
    Given the Fetcher is built with baseDelayMs from Setting
    And the operator changes politeness.baseDelayMs from 8000 to 12000
    When the current sweep is running
    Then the sweep continues to use 8000 (read at start)
    When the next cron tick fires
    Then buildDeps() reads the Setting again
    And the new sweep uses 12000

  # Single-active-sweep guard tests

  Scenario: findInProgressSweep() returns null when no sweep is active
    Given the SweepRun table has no rows with status='in_progress'
    When findInProgressSweep() is called
    Then it returns null

  Scenario: findInProgressSweep() returns the sweepId when a sweep is in progress
    Given the SweepRun table has a row with status='in_progress', id=5
    When findInProgressSweep() is called
    Then it returns 5

  Scenario: Cron tick is skipped if a sweep is already in progress
    Given a sweep with status='in_progress' is in the DB
    When the cron fires
    Then tick() calls findInProgressSweep() and gets 5
    And runSweep() is NOT called
    And the log contains event='tick.skipped', reason='sweep_in_progress', activeSweepId=5

  Scenario: Phantom in_progress rows must be manually cancelled
    Given a SweepRun row with status='in_progress' from a crashed prior process
    When the operator wants to run a new sweep
    Then the cron tick skips due to the phantom row
    And the operator calls POST /api/sweeps/5/cancel to delete it
    Then the next cron tick proceeds normally

  # Docker Compose deployment tests

  Scenario: Docker Compose stacks Postgres + Crawler + Web on localhost only
    Given docker-compose.yml with services: postgres, property-crawler, (web on same service)
    When docker compose up --build -d is run
    Then postgres listens on 127.0.0.1:5432 only
    And property-crawler listens on 127.0.0.1:3000 only
    And no services are exposed to 0.0.0.0 (public)

  Scenario: TZ=Europe/Chisinau is set in both Postgres and Crawler services
    Given the Dockerfile and docker-compose.yml
    When a service is running
    Then the environment variable TZ is Europe/Chisinau
    And naive datetime functions (now() in SQL, new Date() in JS) use Chisinau time

  Scenario: Postgres health check waits for ready before Crawler starts
    Given docker-compose.yml with depends_on.postgres.condition=service_healthy
    And the postgres healthcheck command: pg_isready -U house_track
    When docker compose up -d is run
    Then postgres is polled every 5s (timeout 3s, retry 10×)
    And the property-crawler service waits for postgres to be healthy
    And the crawler does NOT start until postgres is ready

  Scenario: Migrations run automatically at boot
    Given the Dockerfile CMD runs: prisma migrate deploy && node dist/index.js
    When the container boots
    Then prisma migrate deploy is called first
    And any pending migrations are applied (idempotent; no-op if DB is up-to-date)
    And then node dist/index.js is invoked

  Scenario: Migrations are idempotent
    Given the DB is already at the latest migration
    When the container boots and runs prisma migrate deploy
    Then no SQL is executed
    And the command exits 0 (success)
    And the container proceeds to boot the app

  Scenario: DATABASE_URL is injected from .env
    Given docker-compose.yml sets DATABASE_URL=postgresql://house_track:${POSTGRES_PASSWORD}@postgres:5432/house_track
    And .env has POSTGRES_PASSWORD=secret123
    When the container starts
    Then the DATABASE_URL is resolved to postgresql://house_track:secret123@postgres:5432/house_track
    And PrismaClient connects to that URL

  Scenario: Read-only role is created for MCP run_sql tool
    Given init-ro-role.sh mounted at /docker-entrypoint-initdb.d/10-init-ro-role.sh
    And create-ro-role.sql mounted at /opt/house-track/create-ro-role.sql
    When postgres first boots (empty database)
    Then init-ro-role.sh runs psql -f /opt/house-track/create-ro-role.sql with -v ro_password=$RO_PASSWORD
    And a house_track_ro role with SELECT-only grants is created
    And on an already-initialised volume the hook does NOT re-run

  Scenario: init-ro-role.sh fails closed when RO_PASSWORD is unset
    Given RO_PASSWORD is not set in the environment
    When init-ro-role.sh runs
    Then it logs "ERROR: RO_PASSWORD must be set to create the read-only MCP role."
    And exits 1

  Scenario: Compose aborts when POSTGRES_PASSWORD or RO_PASSWORD is missing
    Given .env does not define POSTGRES_PASSWORD (or RO_PASSWORD)
    When docker compose up is run
    Then compose aborts via the ${VAR:?message} fail-closed interpolation
    And no containers are created

  Scenario: Crawler container runs as non-root with tini as PID 1
    Given the runtime stage of the Dockerfile
    Then USER is node (non-root)
    And ENTRYPOINT is /usr/bin/tini --
    And CMD short-circuits on migrate failure (prisma migrate deploy && node dist/index.js)

  Scenario: Crawler logs are rotated by the json-file driver
    Given docker-compose.yml property-crawler logging options
    Then the json-file driver caps each file at max-size 10m
    And keeps at most max-file 5 rotated files

  Scenario: Postgres image is the alpine variant
    Given docker-compose.yml
    Then the postgres image is postgres:16-alpine
    And both services set restart: unless-stopped

  # Sweep orchestration tests

  Scenario: Pre-flight check skips sweep when circuit is open
    Given the circuit breaker is open
    When runSweep() is called
    Then circuit.isOpen() returns true
    And the fetcher is NOT used (no network calls)
    And a SweepRun is created with status='circuit_open'
    And finishSweep() closes it immediately

  Scenario: Happy path: one index page with new + seen listings
    Given an index page with 5 stubs (all new in DB)
    And detail pages return 200 OK for all 5
    When runSweep() is called
    Then:
      | Step | Behavior |
      | 1. collectIndexStubs | fetches page 0, parses 5 stubs |
      | 2. diffAgainstDb | returns new=[5 stubs], seen=[] (only {new, seen} keys; no gone) |
      | 3. fetchAdvert | 10s delay × 5 detail fetches |
      | 4. parseDetail | extracts full schema for each |
      | 5. persistDetail | upserts Listing, inserts Snapshot |
      | 6. finishSweep | status='ok', newListings=5, detailsFetched=5 |

  Scenario: Empty index page stops pagination early
    Given an index page 0 with 78 stubs
    And page 1 is empty
    And maxPagesPerSweep=50 (high cap)
    When collectIndexStubs() is called
    Then page 0 is fetched
    Then page 1 is fetched and returns empty
    And pagination stops (no page 2 attempt)
    And allStubs.length = 78

  Scenario: Pagination stops when maxPagesPerSweep cap is hit
    Given pages 0..2 each have 78 stubs
    And maxPagesPerSweep=2
    When collectIndexStubs() is called
    Then page 0 is fetched (78 stubs)
    Then page 1 is fetched (78 stubs)
    And page 2 is NOT fetched (cap reached)
    And allStubs.length = 156

  Scenario: targetListingsThisSweep caps detail processing
    Given the diff returns new=[100 stubs], seen=[100 stubs]
    And targetListingsThisSweep=50
    When fetchAdvert is called
    Then at most 50 listings are fetched (new + seen combined)
    And the sweep closes early

  Scenario: Backfill processes oldest unenriched listings
    Given sweep.backfillPerSweep=10
    And the DB has 100 listings with filterValuesEnrichedAt=NULL
    And 80 listings are from 1 month ago, 20 are from 1 week ago
    When backfill happens
    Then the 10 oldest (1 month ago) are selected
    And their details are fetched
    And filterValuesEnrichedAt is updated on persist

  Scenario: Stale refresh processes oldest lastFetchedAt
    Given sweep.staleRefreshPerSweep=5
    And the DB has 1000 listings
    When stale refresh happens
    Then watchlist=1 listings are prioritized first
    Then the next 4 oldest lastFetchedAt are selected (staleRefreshPerSweep - 1)
    And their details are fetched

  Scenario: markSeen updates lastSeenAt on seen listings
    Given stubs [A, B, C] are marked as "seen"
    When markSeen([A, B, C]) is called
    Then the Listing rows for A, B, C have lastSeenAt = now()

  Scenario: markInactiveOlderThan marks listings gone for 3+ sweeps
    Given SWEEP.missingSweepsBeforeInactive = 3
    And sweep.expectedPerDay defaults to 2 (NOT 24) — the stable anchor for the threshold
    And the threshold window = missingSweepsBeforeInactive sweeps at the expectedPerDay cadence
    And a listing's lastSeenAt is older than that window
    When markInactiveOlderThan(threshold) is called
    Then the listing.active is set to false
    And the listing.delistedAt is set to now()
    And the listing.delistReason is set to 'stale_cutoff'

  Scenario: Error in a single listing parse does not kill the sweep
    Given detail page X returns 200 OK but malformed JSON
    And detail page Y returns 200 OK and parses correctly
    When parseDetail(X, ...) throws an error
    Then the sweep catches it, logs with the listing ID
    And continues to fetch Y
    And finishSweep() sets status='partial', errors=[{id: X, error: ...}]

  Scenario: CircuitTrippingError during index fetch stops the sweep
    Given the index page returns 403
    When fetchSearchPage(0) is called
    Then CircuitTrippingError is thrown
    And runSweep() catches it
    And the circuit is already tripped (sentinel file exists)
    And finishSweep() is called with status='partial', errors=[...]
    And the next tick will skip due to circuit.isOpen()

  Scenario: AbortSignal cancels in-flight fetches
    Given an AbortController is registered for sweepId=5
    When the operator calls POST /api/sweeps/5/cancel
    Then the AbortController is triggered
    And all pending fetchSearchPage / fetchAdvert calls throw AbortError
    And finishSweep() is called with status='cancelled'

  # Capture-Session workflow tests

  Scenario: Capture-session launches Firefox in headed mode
    Given scripts/capture-session.ts is run with pnpm capture-session
    When the script executes
    Then firefox.launch({ headless: false }) is called
    And the browser context is created with userAgent=POLITENESS.userAgent
    And the viewport is 1280 × 900
    And the context locale is 'ro-RO'

  Scenario: Capture-session uses headless Firefox if --headless flag is set
    Given scripts/capture-session.ts is run with pnpm capture-session --headless
    When the script executes
    Then firefox.launch({ headless: true }) is called
    And no GUI window appears

  Scenario: Capture-session intercepts GraphQL POSTs on /graphql endpoint
    Given a browser context is created
    When context.route(GRAPHQL_URL, ...) is called
    Then all POST requests to https://999.md/graphql are intercepted
    And the request body is parsed for operationName, query, variables
    And the response is forwarded normally

  Scenario: Capture-session captures SearchAds query and variables
    Given the browser navigates to the listings page
    And a SearchAds POST is fired
    When the interceptor checks operationName
    Then it matches 'SearchAds'
    And the query string and variables are stored
    And captures.search is populated

  Scenario: Capture-session captures GetAdvert query when available
    Given the browser clicks a listing detail
    And a GetAdvert POST is fired
    When the interceptor checks operationName
    Then it matches 'GetAdvert'
    And the query and variables are stored
    And captures.advert is populated

  Scenario: Capture-session falls back to direct API probe if GetAdvert is not observed
    Given the GetAdvert POST is not fired client-side (999.md SSRs the page)
    And the browser is on a listing detail page with an id
    When 5 seconds elapse without capturing GetAdvert
    Then the script calls probeGetAdvert() directly
    And a GraphQL POST is issued to /graphql with the GetAdvert query
    And the response is captured

  Scenario: Capture-session validates GetAdvert query via GraphQL schema
    Given the stored GetAdvert query from prior runs
    When probeGetAdvert() tests it against the live endpoint
    Then the query either validates (kind='data') or fails with schema errors
    If it fails with errors (unknown field), the script runs introspection

  Scenario: Capture-session rebuilds GetAdvert query via introspection
    Given the existing GetAdvert query is outdated
    When buildAdvertQueryViaIntrospection() is called
    Then an introspection query is issued to discover the Advert type
    Then scalar/enum fields are selected directly
    Then OBJECT/INTERFACE fields are wrapped with { __typename }
    And the rebuilt query is validated against the endpoint

  Scenario: Capture-session extracts headers from both SearchAds and GetAdvert
    Given both SearchAds and GetAdvert are captured with headers
    When writeArtefacts() merges the headers
    Then a union of all headers is written to docs/captured-headers.md
    And per-request headers (cookie, auth, CSRF) are marked as noise
    And static headers (User-Agent, Accept, etc.) are listed for wiring

  Scenario: Capture-session sniffs User-Agent drift
    Given POLITENESS.userAgent='Mozilla/5.0 (X11; Linux x86_64; rv:128.0)...'
    And the captured headers have User-Agent='Mozilla/5.0 (X11; Linux x86_64; rv:129.0)...'
    When writeArtefacts() compares them
    Then a warning is logged: "User-Agent drift — update POLITENESS.userAgent"

  Scenario: Capture-session extracts and saves cookies to .env.local
    Given context.cookies() returns [{name: 'cf_clearance', value: '...'}, ...]
    When writeArtefacts() formats them
    Then .env.local is written with BOOTSTRAP_COOKIES="cf_clearance=...; ..."
    And .env.local is gitignored (never committed)

  Scenario: Capture-session validates fixtures by typechecking
    Given updated src/graphql.ts with new query bodies
    When writeArtefacts() runs pnpm typecheck
    Then if typecheck succeeds, the file is kept
    And the script logs "✓ Done"
    When typecheck fails, the original is restored from .bak
    And the script throws an error

  Scenario: Capture-session trims search fixture to 5 ads
    Given a SearchAds response with 78 ads
    When trimSearchAdsResponse(body, 5) is called
    Then the response.data.searchAds.ads array is truncated to [0..4]
    And the trimmed fixture is written to search-ads-response.json

  Scenario: Capture-session reports missing operations
    Given SearchAds is captured but GetAdvert is not
    When the script ends
    Then it exits non-zero (exit code 1)
    And the log shows: "✗ Capture incomplete — aborting without writing files"
    And no files are modified

  Scenario: Capture-session is all-or-nothing on SearchAds + GetAdvert
    Given only SearchAds is captured
    When the script finishes
    Then no files are written (abort before writeArtefacts)
    And the script exits 1

  Scenario: Capture-session captures the filter-taxonomy op when detected
    Given a GraphQL POST whose operationName matches looksLikeTaxonomyOpName()
    When the interceptor runs
    Then captures.taxonomy is populated
    And writeArtefacts() writes src/data/filter-taxonomy.1406.json
    And FILTER_TAXONOMY_QUERY in src/graphql.ts is replaced

  Scenario: Capture-session taxonomy op can be forced via --taxonomy-op
    Given the heuristic does not auto-detect the taxonomy op
    And the operator re-runs with --taxonomy-op=<Name>
    When a POST with operationName=<Name> is observed
    Then it is captured as taxonomy

  Scenario: Capture-session partial (no taxonomy) still writes and exits 0
    Given SearchAds and GetAdvert are both captured
    But no taxonomy op is detected
    When the script finishes
    Then search + advert artefacts ARE written (graphql.ts, both fixtures, headers, cookies)
    And FILTER_TAXONOMY_QUERY and the taxonomy fixture are left untouched
    And a "⚠ Taxonomy not auto-captured … re-run with --taxonomy-op=<Name>" warning is printed
    And the script returns normally (exit 0), NOT rolled back

  Scenario: Capture-session introspection skips fields with required arguments
    Given buildAdvertQueryViaIntrospection() runs against the Advert __type
    When a field has an argument whose type.kind is NON_NULL
    Then that field is skipped (not selected)
    And scalar/enum fields are selected directly
    And OBJECT/INTERFACE/UNION fields are selected as "{ __typename }"
    And 'id' is force-prepended if not already selected

  Scenario: Capture-session probe surfaces GraphQL validation errors distinctly
    Given a direct GetAdvert probe returns a body with an errors array (or a 400 with errors)
    When postGraphQL() parses the response
    Then ProbeResult.kind is 'errors' (not 'fail')
    And the script proceeds to rebuild the query via introspection

  # Verify-robots workflow tests

  Scenario: Verify-robots fetches robots.txt and validates required paths
    Given scripts/verify-robots.ts is run with pnpm verify-robots
    When the script executes
    Then fetch(ROBOTS_URL) is called with User-Agent header
    And robots.txt is parsed for User-agent: * disallow rules
    And required paths are checked: [/graphql, /ro/list/real-estate/houses-and-villas, /ro/103772337]

  Scenario: Verify-robots exits 0 if all required paths are allowed
    Given robots.txt allows all required paths
    When isPathAllowedForStar() is called for each path
    Then all return true
    And the script logs "All required paths are permitted"
    And exits with code 0

  Scenario: Verify-robots exits 1 if any required path is disallowed
    Given robots.txt disallows /graphql
    When isPathAllowedForStar() is called for /graphql
    Then it returns false
    And the script logs "✗ /graphql"
    And exits with code 1 (aborting)

  Scenario: Verify-robots exits 1 when robots.txt fetch is not OK
    Given fetch(ROBOTS_URL) returns a non-2xx status (e.g. 503)
    When the script runs
    Then it logs "✗ https://999.md/robots.txt returned 503"
    And exits with code 1 (before parsing)

  Scenario: Robots parser is disallow-only (no Allow rule support)
    Given a robots.txt that has both Disallow and Allow lines for User-agent *
    When parseRobots() runs
    Then only Disallow values (non-empty) are collected into starDisallows
    And Allow lines are ignored (not RFC 9309 — a path under a disallowed prefix is reported blocked even if a more-specific Allow would permit it)

  # Backfill-filter-ids workflow tests

  Scenario: Backfill-filter-ids loads bootstrap LUT from config
    Given scripts/backfill-filter-ids.ts is run with pnpm backfill:filters
    When the script executes
    Then bootstrapLutFromConfig() is called
    And a Map<featureId, filterId> is returned with hardcoded entries

  Scenario: Backfill-filter-ids merges captured taxonomy if fixture exists
    Given src/data/filter-taxonomy.1406.json exists with captured featureId/filterId pairs
    When the script loads the fixture
    Then parseTaxonomyResponse() extracts the LUT
    And mergeLuts(bootstrap, captured) combines them
    And captured edges take precedence over bootstrap

  Scenario: Backfill-filter-ids updates rows with filterId=0
    Given 50 ListingFilterValue rows with filterId=0, featureId=245
    And the LUT has (245 → 32) mapping
    When the script calls updateMany()
    Then all 50 rows are updated to filterId=32
    And the log shows "updated featureId=245 → filterId=32: 50 rows"

  Scenario: Backfill-filter-ids is idempotent
    Given all ListingFilterValue rows are already updated
    When the script runs again
    Then updateMany() finds 0 rows with filterId=0, featureId=X
    And 0 rows are updated
    And the script reports "updated 0 rows total"

  Scenario: Backfill-filter-ids --dry-run shows what would be updated
    Given 50 rows with filterId=0, featureId=245
    When the script runs with --dry-run
    Then updateMany() is NOT called (count() is used instead)
    And the log shows "(dry-run) would update 50 rows total"
    And no database changes are made

  Scenario: Backfill-filter-ids reports unresolved rows
    Given 100 ListingFilterValue rows total, 50 with filterId=0
    When the script finishes
    Then it logs "50 rows still have filterId=0 (featureId not in LUT — capture taxonomy to resolve)"

  # Operator UI routes + Analytics tests

  Scenario: GET /api/settings returns all runtime-mutable keys
    Given the operator UI makes a request to /api/settings
    When the server responds
    Then the response includes all Setting keys with current values and defaults
    And the response is a JSON array of {key, current, default}

  Scenario: POST /api/settings/:key updates a setting
    Given the operator submits a form to save politeness.baseDelayMs=12000
    When POST /api/settings/politeness.baseDelayMs is called with value=12000
    Then the Setting row is upserted
    And the next sweep reads the new value

  Scenario: GET /api/sweeps returns paginated SweepRun history
    Given the operator navigates to the Sweeps page
    When the server responds to /api/sweeps
    Then the response includes [SweepRun] with pagination metadata

  Scenario: GET /api/sweeps/latest returns the most recent sweep
    Given the operator checks the Dashboard
    When /api/sweeps/latest is called
    Then the most recent SweepRun is returned
    And the UI displays the last sweep tile

  Scenario: GET /api/sweeps/:id returns sweep detail + error log
    Given the operator clicks a sweep row to expand it
    When /api/sweeps/5 is called
    Then the SweepRun row is returned with errors[] (JSON array)
    And the UI renders the error log in a syntax-highlighted box

  Scenario: POST /api/sweeps runs a manual smoke sweep
    Given the operator clicks "Run smoke" button
    When POST /api/sweeps with trigger='smoke' is called
    Then buildDeps() is called with overrides: maxPagesPerSweep=1, targetListingsThisSweep=3
    And runSweep() runs a 1-page, 3-listing-max sweep
    And the SweepRun is recorded with trigger='smoke'

  Scenario: POST /api/sweeps is blocked if circuit is open
    Given the circuit breaker is open
    When the operator tries to run a manual sweep
    Then POST /api/sweeps returns 409 Conflict
    And the response message is "Circuit breaker is open"

  Scenario: POST /api/sweeps/:id/cancel stops an in-progress sweep
    Given a SweepRun with status='in_progress', id=5
    When POST /api/sweeps/5/cancel is called
    Then getSweepAbortControllers().get(5).abort() is triggered
    And in-flight network requests throw AbortError
    And finishSweep() is called with status='cancelled'

  Scenario: DELETE /api/circuit clears the circuit breaker
    Given the circuit is open (sentinel file exists)
    When DELETE /api/circuit is called
    Then the sentinel file is deleted
    And circuit.isOpen() returns false
    And the response is { status: 'closed' }

  Scenario: Dashboard analytics tile shows active listing count
    Given the DB has 250 active listings
    When GET /api/stats/overview is called
    Then the response includes activeListingCount=250

  Scenario: Dashboard analytics show new listings in the last 24 hours
    Given 15 listings were firstSeenAt in the last 24h
    When GET /api/stats/overview is called
    Then the response includes newToday=15

  Scenario: Dashboard shows sweep success rate (7-day rolling)
    Given 168 sweeps in the last 7 days, 160 with status='ok'
    When GET /api/stats/overview is called
    Then successRate = 160 / 168 ≈ 95.2%
    And the UI displays this as a percentage tile

  Scenario: Dashboard by-district breakdown is pie-chart compatible
    Given listings in: Centru (80), Botanica (50), Rîșcani (40)
    When GET /api/stats/by-district is called
    Then the response is [{district: 'Centru', count: 80}, ...]
    And the UI renders a pie chart

  Scenario: Houses page pagination loads more on scroll
    Given the Listings table has 1000 rows
    When the operator scrolls to the bottom
    Then the UI calls GET /api/listings?limit=50&offset=50
    And the next 50 rows are appended

  Scenario: Houses page filters by price range
    Given the operator sets price range [50000, 150000]
    When the filter is applied
    Then GET /api/listings?priceMin=50000&priceMax=150000 is called
    And only listings in that range are returned

  Scenario: Houses page sorts by price descending
    Given the operator clicks the "Price" column header
    When sort is applied
    Then GET /api/listings?sort=priceEur&order=desc is called
    And listings are returned sorted by price descending

  Scenario: Settings page saves crawler tuning changes
    Given the operator changes politeness.baseDelayMs from 8000 to 10000
    When the "Save" button is clicked
    Then POST /api/settings/politeness.baseDelayMs with value=10000 is called
    And a toast shows "Saved"
    And the next sweep uses the new value

  Scenario: Settings page shows filter overrides per source
    Given the Sources section displays 999md
    When the operator clicks "Edit overrides"
    Then a JSON editor opens with politeness + filter override fields
    And changes are saved per-source (not global)
