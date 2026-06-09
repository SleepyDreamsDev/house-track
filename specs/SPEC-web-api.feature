Feature: Operator Web API (Hono)
  As an operator
  I want to query crawl data, sweeps, listings, and settings via HTTP
  So that the web UI can display real-time crawler status, view market analytics, and allow runtime tuning

  Background:
    Given the Hono server is running on 127.0.0.1:3000
    And Postgres is accessible via Prisma
    And there are 10 SweepRun records in the database
    And there are 50 Listing records in the database

  # ── Server & Health ──
  Scenario: Server health check responds with 200
    When I send GET /api/health
    Then response status is 200
    And response body is {"status":"ok"}

  Scenario: Feed sub-paths win the prefix match over the generic /api/listings/:id route
    Given the feed routers are registered before registerListingsRoutes
    When I send GET /api/listings/new-today
    Then the request is handled by the feed router (not the :id detail handler)
    And response status is 200 (not a 404 'Listing not found' for an id 'new-today')

  # ── Sweeps: List & Latest ──
  Scenario: GET /api/sweeps returns paginated sweep runs
    When I send GET /api/sweeps?limit=5&offset=0
    Then response status is 200
    And response body has shape { sweeps: Array, total: number, limit: number, offset: number }
    And response.sweeps.length <= 5
    And each sweep has id, startedAt, finishedAt, status, trigger, pagesFetched, detailsFetched, newListings, updatedListings, errorCount, durationMs

  Scenario: GET /api/sweeps/latest returns most recent sweep
    When I send GET /api/sweeps/latest
    Then response status is 200
    And response has id, startedAt, finishedAt, status, pagesFetched, detailsFetched, newListings, updatedListings
    And response.startedAt is >= all other sweep startedAt values

  # ── Sweeps: Trigger & Control ──
  Scenario: POST /api/sweeps returns 409 if sweep is already running
    Given a SweepRun with status 'in_progress' exists
    When I send POST /api/sweeps
    Then response status is 409
    And response.error is 'sweep_in_progress'
    And response.activeSweepId is the id of the running sweep

  Scenario: POST /api/sweeps returns 500 if buildDeps or startSweep throws
    Given no SweepRun has status 'in_progress'
    And persist.startSweep throws
    When I send POST /api/sweeps
    Then response status is 500
    And response.error is 'Internal server error'

  Scenario: POST /api/sweeps swallows a background runSweep rejection
    Given no SweepRun has status 'in_progress'
    And runSweep will reject after the 201 is returned
    When I send POST /api/sweeps
    Then response status is 201
    And the rejection is logged via console.error and never reaches the client

  Scenario: POST /api/sweeps triggers a manual sweep (non-blocking)
    Given no SweepRun has status 'in_progress'
    When I send POST /api/sweeps
    Then response status is 201
    And response has id, startedAt
    And a new SweepRun row exists with status 'in_progress' and trigger 'manual'
    And runSweep() executes asynchronously in the background

  Scenario: POST /api/sweeps/smoke triggers a smoke test (1 page, 3 targets)
    Given no SweepRun has status 'in_progress'
    And circuit breaker is not open
    When I send POST /api/sweeps/smoke
    Then response status is 201
    And a new SweepRun row exists with status 'in_progress' and trigger 'smoke'
    And the smoke sweep fetches at most 1 page
    And the smoke sweep fetches at most 3 detail listings
    And the smoke SweepDeps has backfillPerSweep 0 and staleRefreshPerSweep 0

  Scenario: POST /api/sweeps/smoke returns 409 if circuit breaker is open
    Given no SweepRun has status 'in_progress'
    And circuit breaker sentinel file exists
    When I send POST /api/sweeps/smoke
    Then response status is 409
    And response.error is 'circuit_open'

  Scenario: POST /api/sweeps/:id/cancel aborts a running sweep with an in-memory controller
    Given a SweepRun with id 7 has status 'in_progress'
    And an AbortController is registered for sweep 7
    When I send POST /api/sweeps/7/cancel
    Then response status is 200
    And response.status is 'cancelled'
    And the controller.abort() is called
    And the route does NOT update the DB row directly (runSweep's finally block stamps 'cancelled')

  Scenario: POST /api/sweeps/:id/cancel updates the DB when no controller exists (stale in_progress row)
    Given a SweepRun with id 8 has status 'in_progress'
    And no AbortController is registered for sweep 8 (e.g. after a process restart)
    When I send POST /api/sweeps/8/cancel
    Then response status is 200
    And response.status is 'cancelled'
    And the SweepRun.status is updated to 'cancelled' with finishedAt set

  Scenario: POST /api/sweeps/:id/cancel returns 409 if the sweep is not running
    Given a SweepRun with id 9 has status 'ok'
    When I send POST /api/sweeps/9/cancel
    Then response status is 409
    And response.error is 'Can only cancel running sweeps'

  Scenario: POST /api/sweeps/:id/cancel returns 404 if the sweep does not exist
    When I send POST /api/sweeps/99999/cancel
    Then response status is 404
    And response.error is 'Sweep not found'

  Scenario: POST /api/sweeps/:id/cancel returns 400 on a non-positive-int id
    When I send POST /api/sweeps/0/cancel
    Then response status is 400
    And response.error is 'Invalid sweep id'

  # ── Sweeps: Detail & Streaming ──
  Scenario: GET /api/sweeps/:id returns full sweep detail with live progress
    Given a SweepRun with id 5 exists
    When I send GET /api/sweeps/5
    Then response status is 200
    And response has id, status, startedAt, finishedAt, source, trigger, config, summary, pages, details, errors, logTail, progress, currentlyFetching
    And response.summary has pagesFetched, detailsFetched, newListings, updatedListings, errors, durationMs
    And response.progress has phase, pagesDone, pagesTotal, detailsDone, detailsQueued, newCount, updatedCount, queued
    And response.config defaults to {} when configSnapshot is null
    And response.source defaults to '999.md' and trigger defaults to 'cron'

  Scenario: GET /api/sweeps/:id zeroes live-only fields for a non-active in_progress row
    Given a SweepRun with id 11 has status 'in_progress' but is not the in-memory active sweep
    When I send GET /api/sweeps/11
    Then response status is 200
    And response.progress.detailsQueued is 0
    And response.currentlyFetching is null

  Scenario: GET /api/sweeps/:id returns 400 with 'Invalid sweep ID' (capital ID) on bad id
    When I send GET /api/sweeps/0
    Then response status is 400
    And response.error is 'Invalid sweep ID'

  Scenario: GET /api/sweeps/:id returns 404 with lowercase 'not found'
    When I send GET /api/sweeps/99999
    Then response status is 404
    And response.error is 'not found'

  Scenario: GET /api/sweeps/latest returns 404 when there are no sweeps
    Given there are zero SweepRun records
    When I send GET /api/sweeps/latest
    Then response status is 404
    And response.error is 'No sweeps found'

  Scenario: GET /api/sweeps reports growing durationMs for an in-flight sweep
    Given a SweepRun with status 'in_progress' and null finishedAt
    When I send GET /api/sweeps
    Then the running sweep's durationMs equals now - startedAt (not null)

  Scenario: GET /api/sweeps/:id/stream opens SSE connection and streams events
    Given a SweepRun with id 3 has status 'in_progress'
    When I open Server-Sent Events connection to /api/sweeps/3/stream
    Then connection opens with 200 and Content-Type text/event-stream
    And an initial comment `: connected to 3\n\n` is written immediately to flush headers
    And response headers include Cache-Control 'no-cache, no-transform', Connection 'keep-alive', X-Accel-Buffering 'no'
    And a heartbeat comment is sent every 15 seconds (`: ping\n\n`)
    And when sweepEvents.emitEvent({sweepId:'3', ...}) is called, the event is streamed as `data: {...}\n\n` JSON
    And the streamed payload omits sweepId (only t, lvl, msg, meta?)
    And when connection closes or is aborted, the heartbeat interval is cleared and the event listener unsubscribes

  Scenario: GET /api/sweeps/:id/stream ignores events for other sweeps
    Given an SSE connection is open to /api/sweeps/3/stream
    When sweepEvents.emitEvent({sweepId:'7', ...}) is called
    Then no data frame is written for that event (sweepId mismatch)

  Scenario: GET /api/sweeps/:id/errors returns 400/404 on bad input
    When I send GET /api/sweeps/0/errors
    Then response status is 400
    And response.error is 'Invalid sweep id'

  Scenario: GET /api/sweeps/:id/errors returns 404 when the sweep is missing
    When I send GET /api/sweeps/99999/errors
    Then response status is 404
    And response.error is 'Sweep not found'

  Scenario: GET /api/sweeps/:id/errors coerces a non-array errors column to []
    Given a SweepRun with id 12 has a non-array errors value
    When I send GET /api/sweeps/12/errors
    Then response status is 200
    And response body is []

  Scenario: GET /api/sweeps/:id/smoke-assertions returns 409 for a non-smoke sweep
    Given a SweepRun with id 13 has trigger 'manual'
    When I send GET /api/sweeps/13/smoke-assertions
    Then response status is 409
    And response.error is 'Not a smoke sweep'

  Scenario: GET /api/sweeps/:id/errors returns parsed error JSON array
    Given a SweepRun with id 2 has errors JSON: [{"page":1,"msg":"timeout"},{"page":2,"msg":"403"}]
    When I send GET /api/sweeps/2/errors
    Then response status is 200
    And response body is the errors array with both objects

  Scenario: GET /api/sweeps/:id/smoke-assertions computes pass/fail once sweep finishes
    Given a SweepRun with id 4 has status 'ok' and trigger 'smoke'
    When I send GET /api/sweeps/4/smoke-assertions
    Then response status is 200
    And response has sweepId, durationMs, passed (boolean), assertions (array)
    And each assertion has {ok: boolean, title: string, actual?: *, expected?: *}

  Scenario: GET /api/sweeps/:id/smoke-assertions returns pending=true while sweep is in_progress
    Given a SweepRun with id 6 has status 'in_progress' and trigger 'smoke'
    When I send GET /api/sweeps/6/smoke-assertions
    Then response status is 200
    And response.pending is true

  # ── Listings: Search & Filtering ──
  Scenario: GET /api/listings returns paginated, filtered listings
    When I send GET /api/listings?limit=10&minPrice=50000&maxPrice=300000&district=Botanica
    Then response status is 200
    And response has rows, total, limit, offset
    And each row has id, url, title, priceEur, areaSqm, rooms, district, firstSeenAt, active, watchlist, excluded
    And all rows have priceEur between 50000 and 300000
    And all rows have district 'Botanica'

  Scenario: GET /api/listings rejects empty district parameter with 400
    When I send GET /api/listings?district=
    Then response status is 400
    And response.error contains 'district query parameter is empty or whitespace-only'

  Scenario: GET /api/listings accepts comma-separated and repeated district params
    When I send GET /api/listings?district=Botanica,Centru
    Then response status is 200
    And all rows have district in ['Botanica', 'Centru']

  Scenario: GET /api/listings validates and coerces numeric parameters
    When I send GET /api/listings?minPrice=not_a_number
    Then response status is 200
    And the invalid minPrice is treated as undefined (no price filter applied)

  Scenario: GET /api/listings/:id returns full listing detail
    Given a listing with id "lst-999" exists
    When I send GET /api/listings/lst-999
    Then response status is 200
    And response has id, url, title, priceEur, priceRaw, areaSqm, rooms, district, sector, description, features (JSON), imageUrls (JSON), snapshots

  Scenario: GET /api/listings/:id returns 404 if listing not found
    When I send GET /api/listings/nonexistent-id
    Then response status is 404
    And response.error is 'Listing not found'

  Scenario: GET /api/listings/:id/price-history returns snapshot timeline
    Given a listing with id "lst-555" has snapshots: [{priceEur: 100000, capturedAt: t-7d}, {priceEur: 95000, capturedAt: t-3d}, {priceEur: 90000, capturedAt: t}]
    When I send GET /api/listings/lst-555/price-history
    Then response status is 200
    And response.points is a 3-element array with priceEur values [100000, 95000, 90000] in order

  # ── Listings: Watchlist & Exclusion ──
  Scenario: PUT /api/listings/:id/watchlist sets watchlist flag
    Given a listing with id "lst-111" has watchlist false
    When I send PUT /api/listings/lst-111/watchlist with {"watchlist":true}
    Then response status is 200
    And Listing.watchlist is updated to true
    And response.watchlist is true

  Scenario: PUT /api/listings/:id/excluded freezes a listing from detail re-fetch
    Given a listing with id "lst-222" has excluded false
    When I send PUT /api/listings/lst-222/excluded with {"excluded":true}
    Then response status is 200
    And Listing.excluded is updated to true
    And response.excluded is true

  Scenario: PUT /api/listings/:id/watchlist returns 404 if listing not found
    When I send PUT /api/listings/nonexistent/watchlist with {"watchlist":true}
    Then response status is 404
    And response.error is 'Listing not found'

  Scenario: PUT /api/listings/:id/watchlist rejects a missing/non-boolean body with 400
    When I send PUT /api/listings/lst-111/watchlist with {}
    Then response status is 400
    And response.error is 'Body must be { watchlist: boolean }'

  Scenario: PUT /api/listings/:id/excluded rejects a non-boolean body with 400
    When I send PUT /api/listings/lst-222/excluded with {"excluded":"yes"}
    Then response status is 400
    And response.error is 'Body must be { excluded: boolean }'

  Scenario: GET /api/listings/:id/price-history returns 404 for an unknown listing
    When I send GET /api/listings/nonexistent/price-history
    Then response status is 404
    And response.error is 'Listing not found'

  # ── Listings: Facets ──
  Scenario: GET /api/listings/facets returns filter-rail data
    When I send GET /api/listings/facets
    Then response status is 200
    And response has total, districts, price (min/max), rooms (min/max), areaSqm (min/max), floors (min/max)
    And response.types is an array of strings (derived from title regex)
    And response.sectors is an array of {name, count} objects if any sectors exist
    And response.municipality is an array of Chișinău district names (if Botanica/Centru/etc. exist)
    And response has favoritesCount, excludedCount, mislabeledCount, roomsValues, landAre (min/max)
    And facets are computed over active AND non-excluded listings only

  Scenario: GET /api/listings/facets omits sectors and municipality keys when empty
    Given there are no listings with a sector and none in a municipality locality
    When I send GET /api/listings/facets
    Then response status is 200
    And response has no 'sectors' key and no 'municipality' key (omitted, not empty arrays)

  # ── Listings: Feeds (Dashboard) ──
  Scenario: GET /api/listings/new-today returns listings added in last 24h (max 10)
    Given listings added within last 24 hours exist
    When I send GET /api/listings/new-today
    Then response status is 200
    And response is an array with at most 10 items
    And each item has id, url, title, priceEur, areaSqm, rooms, district, firstSeenAt, isNew=true
    And items are sorted by firstSeenAt descending (newest first)

  Scenario: GET /api/listings/price-drops returns listings with ≥5% price drop in last 7d
    Given a listing with snapshots: [{priceEur: 100000, capturedAt: 7d ago}, {priceEur: 94000, capturedAt: now}]
    When I send GET /api/listings/price-drops
    Then response status is 200
    And the listing is included with priceWas=100000, priceEur=94000
    And dropRatio = 94000 / 100000 = 0.94 <= 0.95, so it qualifies

  Scenario: GET /api/listings/price-drops excludes drops <5%
    Given a listing with snapshots: [{priceEur: 100000, capturedAt: 7d ago}, {priceEur: 97500, capturedAt: now}]
    When I send GET /api/listings/price-drops
    Then response status is 200
    And the listing is NOT included (drop is only 2.5%)

  Scenario: GET /api/listings/price-drops skips listings with fewer than 2 in-window snapshots
    Given a listing with a single snapshot in the last 7 days
    When I send GET /api/listings/price-drops
    Then response status is 200
    And that listing is NOT included (cannot compute a drop)

  # ── Statistics ──
  Scenario: GET /api/stats/by-district returns district aggregates
    When I send GET /api/stats/by-district
    Then response status is 200
    And response is an array of {name, count, eurPerSqm}
    And each district is sorted by count descending

  Scenario: GET /api/stats/new-per-day returns 7-day new listing counts
    When I send GET /api/stats/new-per-day
    Then response status is 200
    And response is an array of 7 numbers (one per day, oldest first)
    And days with no new listings have value 0 (not omitted)

  Scenario: GET /api/stats/success-rate computes sweep success ratio
    Given 100 finished SweepRun records with status 'ok', 'partial', 'failed'
    When I send GET /api/stats/success-rate
    Then response status is 200
    And response has rate (0.0–1.0), ok (count), total (100), window (100)
    And rate = ok_count / total

  Scenario: GET /api/stats/avg-price returns mean priceEur across active listings
    When I send GET /api/stats/avg-price
    Then response status is 200
    And response has avgPrice (rounded integer), count
    And avgPrice = ROUND(SUM(priceEur) / COUNT(*)) for active listings with non-null priceEur

  # ── Analytics: Overview ──
  Scenario: GET /api/analytics/overview computes market KPIs
    When I send GET /api/analytics/overview
    Then response status is 200
    And response has kpis with medianEurPerSqm, activeInventory, medianDomDays, bestDealsCount, recentDropsCount, iqrEurPerSqm, sellerMix, etc.
    And response has trendByDistrict (monthly €/m² by district for 12 months)
    And response has heatmap (district → room-bucket → avg €/m²)
    And response has domBuckets, inventory12w, newPerWeek, gonePerWeek, scatter

  Scenario: GET /api/analytics/overview respects filter slice (district, sector, price, type, etc.)
    When I send GET /api/analytics/overview?district=Botanica&minPrice=100000&maxPrice=250000
    Then response status is 200
    And all KPIs are computed over only listings matching those filters

  Scenario: GET /api/analytics/overview rejects invalid filter with 400
    When I send GET /api/analytics/overview?district=
    Then response status is 400
    And response.error contains 'district query parameter is empty or whitespace-only'

  # ── Analytics: Segments ──
  Scenario: GET /api/analytics/segments groups by sector/rooms/priceBand/month
    When I send GET /api/analytics/segments?by=sector,rooms
    Then response status is 200
    And response is an array of segments
    And each segment has key, median_eur_per_sqm, iqr, seller_mix, median_dom_closed

  Scenario: GET /api/analytics/segments rejects invalid dimension
    When I send GET /api/analytics/segments?by=invalid_dim
    Then response status is 400
    And response.error contains 'invalid by dimensions'

  # ── Analytics: Valuation (Hedonic) ──
  Scenario: GET /api/analytics/valuation fits log-linear hedonic model
    Given at least 10 listings with priceEur, areaSqm, rooms, sector, yearBuilt
    When I send GET /api/analytics/valuation
    Then response status is 200
    And response has n (sample count), rSquared, coefficients (dict)
    And response.deals is sorted by residualPct ascending (most underpriced first)
    And response.overpriced is sorted by residualPct descending (most overpriced first)

  Scenario: GET /api/analytics/valuation returns insufficientData if <10 samples
    Given fewer than 10 listings match the filter
    When I send GET /api/analytics/valuation
    Then response status is 200
    And response.insufficientData is true
    And response has minSamples 10, rSquared null, n (>=0)
    And response.deals and response.overpriced are empty

  # ── Analytics: Duplicates / Sellers / Distress / Market-Index ──
  Scenario: GET /api/analytics/duplicates groups dedup clusters by canonicalId
    Given some listings have canonicalId set
    When I send GET /api/analytics/duplicates
    Then response status is 200
    And response is an array of {canonicalId, canonical, duplicates, size}
    And clusters are sorted by size descending
    And canonical may be null if the canonical row is absent

  Scenario: GET /api/analytics/sellers aggregates by authorId with sell-through
    Given some listings have authorId set
    When I send GET /api/analytics/sellers
    Then response status is 200
    And response is an array of {authorId, authorName, listings, activeListings, sellThrough}
    And sellThrough = delisted / total
    And sellers are sorted by listings descending

  Scenario: GET /api/analytics/distress returns description-language stress signals
    When I send GET /api/analytics/distress
    Then response status is 200
    And response has activeCount, distressedCount, distressShare, signalBreakdown, closedCount, weekendDelistShare, postingHour
    And signalBreakdown has a count per DISTRESS_LEXICON category

  Scenario: GET /api/analytics/market-index drops sectors below MARKET_INDEX_MIN_ACTIVE
    Given a sector with fewer than 5 active listings
    When I send GET /api/analytics/market-index
    Then response status is 200
    And that sector is excluded from the temperature scoring

  Scenario: GET /api/analytics/overview accepts region as a legacy alias for district
    When I send GET /api/analytics/overview?region=Botanica
    Then response status is 200
    And the slice is filtered as if district=Botanica

  Scenario: GET /api/analytics/segments without by param defaults to sector,rooms,priceBand
    When I send GET /api/analytics/segments
    Then response status is 200
    And segments are grouped by sector,rooms,priceBand

  Scenario: GET /api/analytics/segments with empty by param returns 400
    When I send GET /api/analytics/segments?by=
    Then response status is 400
    And response.error contains 'invalid by dimensions'

  # ── Analytics: Best-Buys ──
  Scenario: GET /api/analytics/best-buys scores listings and returns top 50
    When I send GET /api/analytics/best-buys
    Then response status is 200
    And response is an array with at most 50 items
    And each item has id, url, title, priceEur, areaSqm, rooms, district, daysOnMkt, eurPerSqm, medianEurPerSqm, discount, z (std-dev), score, priceDrop, dropPct

  Scenario: GET /api/analytics/best-buys score accounts for discount, z-score, and recent price drop
    When I send GET /api/analytics/best-buys
    Then response status is 200
    And score = -z + freshnessBoost + abs(dropPct) * 4
    And freshnessBoost = 0.4 if daysOnMkt < 1 day, 0.2 if < 7 days, else 0
    And items are sorted by score descending (best-buys first)

  # ── Analytics: Price Drops ──
  Scenario: GET /api/analytics/price-drops returns drops ≥3% in period
    When I send GET /api/analytics/price-drops?period=30d
    Then response status is 200
    And response is an array of drops ≥3% over the last 30 days
    And each item has id, url, title, priceWas, priceEur, dropPct, dropEur, when (relative time)

  Scenario: GET /api/analytics/price-drops accepts periods 7d, 30d, 90d
    When I send GET /api/analytics/price-drops?period=90d
    Then response status is 200
    And drop calculation uses 90 days

  Scenario: GET /api/analytics/price-drops rejects invalid period with 400
    When I send GET /api/analytics/price-drops?period=1000d
    Then response status is 400
    And response.error is 'invalid period'

  # ── Settings ──
  Scenario: GET /api/settings returns all setting keys with values, defaults, schemas
    When I send GET /api/settings
    Then response status is 200
    And response is an array of {key, value, default, group, kind, [unit], [options], [label], [hint]}
    And includes keys like 'politeness.baseDelayMs', 'sweep.maxPagesPerSweep', 'filter.generic'

  Scenario: PATCH /api/settings/:key validates and persists
    Given the setting 'politeness.baseDelayMs' has current value 8000
    When I send PATCH /api/settings/politeness.baseDelayMs with {"value":12000}
    Then response status is 200
    And response.success is true
    And Postgres Setting row is updated with valueJson=12000

  Scenario: PATCH /api/settings/:key rejects invalid value with 400
    When I send PATCH /api/settings/politeness.baseDelayMs with {"value":-1000}
    Then response status is 400
    And response.error is 'Validation failed'
    And response.details has validation issues

  Scenario: PATCH /api/settings/:key rejects unknown key with 400
    When I send PATCH /api/settings/unknown.setting with {"value":123}
    Then response status is 400
    And response.error contains 'Unknown setting key'

  Scenario: PATCH /api/settings/:key with a malformed JSON body is not guarded
    When I send PATCH /api/settings/politeness.baseDelayMs with a malformed JSON body
    Then the c.req.json() parse (outside the try/catch, settings.ts:29) throws
    And the request falls through to Hono's catch-all 500 (no 400 for bad JSON here)

  # ── Filter Management ──
  Scenario: GET /api/filter returns active filter state and resolution
    When I send GET /api/filter
    Then response status is 200
    And response has generic (GenericFilter), sources (array), resolved, sourceSlug

  Scenario: PUT /api/filter validates and stores filter
    When I send PUT /api/filter with {"generic":{"category":"house","deal":"sale","location":["Chisinau"]}}
    Then response status is 200
    And response has generic, sources, resolved, sourceSlug
    And Postgres Setting('filter.generic') is updated

  Scenario: PUT /api/filter rejects invalid category with 400
    When I send PUT /api/filter with {"generic":{"category":"invalid"}}
    Then response status is 400
    And response has error 'Validation failed' and details (path, message)

  Scenario: PUT /api/filter rejects a non-JSON body with 400
    When I send PUT /api/filter with a malformed JSON body
    Then response status is 400
    And response.error is 'Invalid JSON body'

  Scenario: PUT /api/filter rejects a value not present in the source mapping with 400
    Given resolveActiveFilter throws UnknownGenericFilterValueError for the chosen value
    When I send PUT /api/filter with that generic filter
    Then response status is 400
    And response.error contains 'not in source mapping'
    And response.details[0] has path, message, value

  Scenario: GET /api/filter/taxonomy rejects an unknown category with 400
    When I send GET /api/filter/taxonomy?category=spaceship
    Then response status is 400
    And response.error is 'Unknown category "spaceship"'

  Scenario: GET /api/filter/sources lists available data sources
    When I send GET /api/filter/sources
    Then response status is 200
    And response is an array of {slug, name, active}

  Scenario: GET /api/filter/taxonomy returns filter options for category
    When I send GET /api/filter/taxonomy?category=house
    Then response status is 200
    And response contains taxonomy nodes for houses (rooms, area, land, heating, year-built, etc.)

  Scenario: GET /api/filter/taxonomy defaults to active filter's category
    When I send GET /api/filter/taxonomy (no ?category param)
    Then response status is 200
    And taxonomy is for the currently-resolved filter's category

  # ── Filter Facets ──
  Scenario: GET /api/filters returns available filter options from MCP layer
    When I send GET /api/filters
    Then response status is 200
    And response has districts, features, options arrays

  # ── Sources ──
  Scenario: GET /api/sources returns source configurations
    When I send GET /api/sources
    Then response status is 200
    And response is an array of {id, slug, name, baseUrl, adapterKey, enabled, placeholder, politenessOverridesJson, filterOverridesJson, createdAt, updatedAt}
    And at least one source has slug '999md'

  Scenario: PATCH /api/sources/:id enables/disables a source
    Given a source with id 1 has enabled true
    When I send PATCH /api/sources/1 with {"enabled":false}
    Then response status is 200
    And response.enabled is false
    And Postgres Source row is updated

  Scenario: PATCH /api/sources/:id accepts politeness overrides
    When I send PATCH /api/sources/1 with {"politenessOverridesJson":{"baseDelayMs":10000,"jitterMs":3000}}
    Then response status is 200
    And Postgres Source.politenessOverridesJson is updated with validated JSON

  Scenario: PATCH /api/sources/:id rejects invalid overrides with 400
    When I send PATCH /api/sources/1 with {"politenessOverridesJson":{"baseDelayMs":"not_a_number"}}
    Then response status is 400
    And response has error 'Invalid politenessOverridesJson' and details

  Scenario: PATCH /api/sources/:id rejects unknown keys in politeness overrides (strict schema)
    When I send PATCH /api/sources/1 with {"politenessOverridesJson":{"__proto__":1}}
    Then response status is 400
    And response.error is 'Invalid politenessOverridesJson'

  Scenario: PATCH /api/sources/:id rejects a non-boolean enabled with 400
    When I send PATCH /api/sources/1 with {"enabled":"yes"}
    Then response status is 400
    And response.error is 'enabled must be a boolean'

  Scenario: PATCH /api/sources/:id returns 400 on a non-positive-int id
    When I send PATCH /api/sources/0 with {"enabled":false}
    Then response status is 400
    And response.error is 'Invalid source id'

  Scenario: PATCH /api/sources/:id returns 404 when the source does not exist
    When I send PATCH /api/sources/99999 with {"enabled":false}
    Then response status is 404
    And response.error is 'Source not found'

  Scenario: PATCH /api/sources/:id success returns only id, slug, enabled
    Given a source with id 1 exists
    When I send PATCH /api/sources/1 with {"enabled":true}
    Then response status is 200
    And response body is exactly {id, slug, enabled} (not the full row)

  # ── Circuit Breaker ──
  Scenario: GET /api/circuit reports circuit breaker status
    When I send GET /api/circuit
    Then response status is 200
    And response has open (boolean), [openedAt], sentinelPath
    And if data/.circuit_open exists, open=true and openedAt is the file's mtime

  Scenario: GET /api/circuit returns open=false when sentinel does not exist
    Given data/.circuit_open does not exist
    When I send GET /api/circuit
    Then response status is 200
    And response.open is false
    And response.openedAt is null

  Scenario: DELETE /api/circuit clears the circuit breaker
    Given data/.circuit_open exists
    When I send DELETE /api/circuit
    Then response status is 200
    And response.success is true
    And data/.circuit_open is deleted
    And subsequent GET /api/circuit returns open=false

  Scenario: DELETE /api/circuit is idempotent (already clear)
    Given data/.circuit_open does not exist
    When I send DELETE /api/circuit
    Then response status is 200
    And response.success is true
    And response.message is 'Circuit breaker was already closed'
    And no error is raised

  Scenario: DELETE /api/circuit returns 'Circuit breaker cleared' when it deletes the sentinel
    Given data/.circuit_open exists
    When I send DELETE /api/circuit
    Then response status is 200
    And response.message is 'Circuit breaker cleared'

  Scenario: GET /api/circuit keeps openedAt null if the sentinel vanishes mid-request
    Given data/.circuit_open exists at existsSync time but is removed before fs.stat
    When I send GET /api/circuit
    Then response status is 200
    And response.open is true
    And response.openedAt is null (stat race swallowed)

  # ── Error Handling & Edge Cases ──
  Scenario: Invalid numeric ID in path returns 400
    When I send GET /api/sweeps/not_a_number
    Then response status is 400
    And response.error is 'Invalid sweep id'

  Scenario: Concurrent setting writes race gracefully (last-write-wins)
    When I concurrently send PATCH /api/settings/key1 with value1 and PATCH /api/settings/key1 with value2
    Then response status is 200 for both requests
    And the final value in Postgres is either value1 or value2 (no corruption)


  # ── Static SPA hosting (single durable origin) ──
  Scenario: API server serves the built operator SPA from WEB_ROOT
    Given the operator SPA is built into web/dist
    When I send GET / 
    Then response status is 200
    And the body is the SPA index.html

  Scenario: Unknown non-API path falls back to index.html for client-side routing
    When I send GET /listings/123
    Then response status is 200
    And the body is the SPA index.html (SPA router handles the path)

  Scenario: Static hosting never shadows the API namespace
    When I send GET /api/does-not-exist
    Then response status is 404
    And response.error is 'not_found'
    And index.html is NOT returned for /api/* paths

  Scenario: Missing build degrades gracefully
    Given web/dist/index.html does not exist
    When I send GET /
    Then response status is 503
    And the body is 'operator UI not built'
