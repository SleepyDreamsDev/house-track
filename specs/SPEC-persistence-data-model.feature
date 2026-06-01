Feature: Persistence, snapshots & data model
  In order to maintain an authoritative, traceable inventory of observed listings
  As the crawler
  I want listings upserted atomically, snapshots captured only on real change,
  inactive listings flagged with delist events, and duplicate cross-posts collapsed
  into canonical lineages

  Background:
    Given a fresh Postgres database with the Prisma schema applied
    And a Persistence instance with a test PrismaClient

  # ============================================================================
  # DIFFING & PARTITIONING
  # ============================================================================

  Scenario: diffAgainstDb partitions stubs into new vs seen
    Given listings with ids "A", "B", "C" already exist in the database
    When diffAgainstDb(stubs for "B", "D", "E") is called
    Then result.new contains only stub "D"
    And result.new contains only stub "E"
    And result.seen contains only stub "B"

  Scenario: diffAgainstDb returns empty result for empty input
    When diffAgainstDb([]) is called
    Then result.new is empty
    And result.seen is empty
    And no database query is issued

  Scenario: diffAgainstDb excludes excluded IDs from seen
    Given listing "IGNORED" exists with excluded=true
    And listing "NORMAL" exists with excluded=false
    When diffAgainstDb(stubs for "IGNORED", "NORMAL") is called
    Then result.new is empty
    And result.seen contains only stub "NORMAL"
    And excluded IDs appear in neither result.new nor result.seen

  # ============================================================================
  # MARKING SEEN & REVIVING
  # ============================================================================

  Scenario: markSeen bumps lastSeenAt to current time
    Given listing "X" with lastSeenAt 2 days ago
    When markSeen([stub for "X"]) is called
    Then "X".lastSeenAt is within the last second
    And "X".lastFetchedAt is unchanged

  Scenario: markSeen re-activates an inactive listing
    Given listing "REVIVED" with active=false and delistedAt=<yesterday>
    When markSeen([stub for "REVIVED"]) is called
    Then "REVIVED".active is true
    And "REVIVED".delistedAt is null
    And "REVIVED".delistReason is null

  Scenario: markSeen silently ignores ids not in the database
    Given no listing "PHANTOM" exists
    When markSeen([stub for "PHANTOM"]) is called
    Then no row is created (updateMany matches zero rows)
    And no error is raised

  Scenario: markSeen leaves lastFetchedAt and filterValuesEnrichedAt untouched
    Given listing "X" with lastFetchedAt=<1 hour ago>, filterValuesEnrichedAt=<1 hour ago>
    When markSeen([stub for "X"]) is called
    Then "X".lastSeenAt is recent
    And "X".lastFetchedAt is unchanged (markSeen never touches it — only persistDetail does)
    And "X".filterValuesEnrichedAt is unchanged

  Scenario: markSeen does not run the unnest UPDATE when no stub carries images
    Given listing "X" exists with imageUrls=["old.jpg"]
    When markSeen([stub for "X" with imageUrls=[]]) is called
    Then "X".imageUrls is still ["old.jpg"] (the image bulk-update is skipped when no stub has images)

  Scenario: markSeen bulk-updates imageUrls from index payload
    Given listing "X" with imageUrls=[]
    And listing "Y" with imageUrls=["old.jpg"]
    When markSeen([
      stub for "X" with imageUrls=["new1.jpg", "new2.jpg"],
      stub for "Y" with imageUrls=["updated.jpg"]
    ]) is called
    Then "X".imageUrls equals ["new1.jpg", "new2.jpg"]
    And "Y".imageUrls equals ["updated.jpg"]
    And no extra UPDATE queries are issued (one unnest-based bulk update)

  # ============================================================================
  # MARKING INACTIVE / AGING
  # ============================================================================

  Scenario: markInactiveOlderThan flips stale active listings to inactive
    Given an active listing "STALE" with lastSeenAt 4 hours ago
    And an active listing "FRESH" with lastSeenAt 30 minutes ago
    When markInactiveOlderThan(3 hours) is called
    Then "STALE".active is false
    And "FRESH".active is true
    And result count is 1

  Scenario: markInactiveOlderThan stamps delist event
    Given an active listing "OLD" with lastSeenAt 6 hours ago
    When markInactiveOlderThan(3 hours) is called
    Then "OLD".delistedAt is set to a time within the last second
    And "OLD".delistReason is "stale_cutoff"

  Scenario: markInactiveOlderThan does not affect already-inactive listings
    Given listing "ALREADY_INACTIVE" with active=false and delistedAt=<2 weeks ago>
    When markInactiveOlderThan(3 hours) is called
    Then "ALREADY_INACTIVE".delistedAt is unchanged
    And result count is 0

  Scenario: backfillDelistedEstimate populates delistedAt for legacy rows
    Given listing "LEGACY" with active=false, delistedAt=null, lastSeenAt=<3 days ago>
    When backfillDelistedEstimate() is called
    Then "LEGACY".delistedAt equals "LEGACY".lastSeenAt
    And "LEGACY".delistReason is "backfill_estimate"
    And result count is 1

  Scenario: backfillDelistedEstimate is idempotent
    Given listing "LEGACY" with active=false, delistedAt=<3 days ago>, delistReason="backfill_estimate"
    When backfillDelistedEstimate() is called again
    Then result count is 0 (no rows updated)

  Scenario: backfillDelistedEstimate sets delistedAt to lastSeenAt (not now)
    Given listing "LEGACY" with active=false, delistedAt=null, lastSeenAt=<3 days ago>
    When backfillDelistedEstimate() is called
    Then "LEGACY".delistedAt equals "LEGACY".lastSeenAt exactly (a 3-day-old time, not the current time)
    And "LEGACY".delistReason is "backfill_estimate"

  Scenario: backfillDelistedEstimate does not touch active listings
    Given an active listing "LIVE" with delistedAt=null
    When backfillDelistedEstimate() is called
    Then "LIVE".delistedAt is still null
    And "LIVE" is not counted in the result

  # ============================================================================
  # PERSISTING DETAIL ATOMICALLY
  # ============================================================================

  Scenario: persistDetail creates a new listing on first fetch
    Given listing "NEW" does not exist
    When persistDetail(parsed detail for "NEW") is called
    Then "NEW" exists in the database
    And "NEW".title, priceEur, rooms, areaSqm, etc. match the parsed detail
    And "NEW".lastSeenAt, lastFetchedAt, filterValuesEnrichedAt are all set to recent times
    And exactly one snapshot exists for "NEW"

  Scenario: persistDetail updates an existing listing
    Given listing "OLD" with title="Old title", priceEur=100000
    When persistDetail(parsed detail with title="New title", priceEur=95000) is called
    Then "OLD".title is "New title"
    And "OLD".priceEur is 95000
    And "OLD".lastSeenAt is recent
    And "OLD".lastFetchedAt is recent
    And "OLD".filterValuesEnrichedAt is recent

  Scenario: persistDetail inserts snapshot only when rawHtmlHash changed
    Given listing "X" with one snapshot at rawHtmlHash="abc"
    When persistDetail(parsed detail with rawHtmlHash="abc") is called
    Then exactly one snapshot exists for "X"
    And no new snapshot row was inserted

  Scenario: persistDetail inserts new snapshot when rawHtmlHash changed
    Given listing "X" with one snapshot at rawHtmlHash="abc"
    When persistDetail(parsed detail with rawHtmlHash="xyz") is called
    Then exactly two snapshots exist for "X"
    And the latest snapshot has rawHtmlHash="xyz"
    And the latest snapshot.priceEur and description match the parsed detail

  Scenario: persistDetail revives an inactive listing
    Given listing "REVIVED" with active=false, delistedAt=<2 hours ago>
    When persistDetail(parsed detail for "REVIVED") is called
    Then "REVIVED".active is true
    And "REVIVED".delistedAt is null
    And "REVIVED".delistReason is null

  Scenario: persistDetail replaces filter-values, not merges
    Given listing "X" with filter-values {featureId: 1, optionId: 10}, {featureId: 2, optionId: 20}
    When persistDetail(parsed detail with filter-values {featureId: 2, optionId: 20}, {featureId: 3, optionId: 30}) is called
    Then "X" has exactly two filter-value rows
    And the rows are {featureId: 2, optionId: 20}, {featureId: 3, optionId: 30}
    And the old {featureId: 1, optionId: 10} row is gone

  Scenario: persistDetail atomicity — partial write is impossible
    Given listing "X" does not exist
    When persistDetail(parsed detail for "X") is called in a transaction
    And a crash occurs mid-transaction
    Then either X exists with all fields + all filter-values + all snapshots, or not at all
    And no half-enriched state (filterValuesEnrichedAt set but no filter-values) ever occurs

  Scenario: persistDetail prefers structured zone over heuristic sector
    Given parsed detail with zone="Centru" (from feature 9) and a street name that would match other sector
    When persistDetail(detail) is called
    Then "X".sector is "Centru"

  Scenario: persistDetail falls back to sector heuristic when zone is null
    Given parsed detail with zone=null but street="Strada Pushkin" which heuristic maps to "Centru"
    When persistDetail(detail) is called
    Then "X".sector is "Centru" (from heuristic)

  Scenario: persistDetail handles heuristic sector failure gracefully
    Given parsed detail with zone=null and a generic street name with no Chișinău markers
    When persistDetail(detail) is called
    Then "X".sector is null
    And the listing is still persisted
    And no error is raised

  # ============================================================================
  # SWEEP BOOKKEEPING
  # ============================================================================

  Scenario: startSweep creates a SweepRun row in progress
    When startSweep(source="999.md", trigger="cron") is called
    Then a SweepRun row is created with id > 0
    And SweepRun.status is "in_progress"
    And SweepRun.startedAt is recent
    And SweepRun.finishedAt is null
    And SweepRun.source is "999.md"
    And SweepRun.trigger is "cron"
    # NOTE: "in_progress" is intentionally NOT a member of the SweepStatus union
    # (ok|partial|failed|circuit_open|cancelled). The status column is a plain
    # String, so this is legal; consumers treat any non-union value as "running".

  Scenario: startSweep with no opts falls back to schema defaults
    When startSweep() is called with no arguments
    Then SweepRun.source is "999.md" (schema default)
    And SweepRun.trigger is "cron" (schema default)
    And SweepRun.status is "in_progress"

  Scenario: recordSweepProgress writes an explicit zero counter
    Given a SweepRun in progress with detailsFetched=5
    When recordSweepProgress(id, {detailsFetched: 0}) is called
    Then SweepRun.detailsFetched is 0 (explicit 0 is written, not skipped)

  Scenario: recordSweepProgress clears errors to null when empty
    Given a SweepRun in progress with errors=[{url:"...",status:500,msg:"x"}]
    When recordSweepProgress(id, {errors: []}) is called
    Then SweepRun.errors is SQL NULL (empty array → Prisma.DbNull)

  Scenario: recordSweepProgress never clears pagesDetail/detailsDetail/eventLog
    Given a SweepRun in progress with pagesDetail=[{...}]
    When recordSweepProgress(id, {pagesDetail: [], detailsDetail: []}) is called
    Then SweepRun.pagesDetail is unchanged (empty arrays are NOT written and do NOT clear)
    And eventLog is never touched by recordSweepProgress at all

  Scenario: recordSweepProgress increments counters without finalizing
    Given a SweepRun in progress
    When recordSweepProgress(id, {pagesFetched: 5, detailsFetched: 3, newListings: 2}) is called
    Then SweepRun.pagesFetched is 5
    And SweepRun.detailsFetched is 3
    And SweepRun.newListings is 2
    And SweepRun.finishedAt is still null

  Scenario: recordSweepProgress flushes errors and JSON detail columns
    Given a SweepRun in progress
    When recordSweepProgress(id, {
      errors: [{url: "...", status: 500, msg: "boom"}],
      pagesDetail: [{n: 1, url: "...", parseMs: 100, found: 10, took: 5000}]
    }) is called
    Then SweepRun.errors is the JSON array with the error object
    And SweepRun.pagesDetail is the JSON array with the page detail object

  Scenario: finishSweep finalizes the SweepRun with result
    Given a SweepRun in progress
    When finishSweep(id, {
      status: "ok",
      pagesFetched: 12,
      detailsFetched: 7,
      newListings: 3,
      updatedListings: 2,
      errors: [],
      configSnapshot: {politeness.baseDelayMs: 8000}
    }) is called
    Then SweepRun.finishedAt is set to a recent time
    And SweepRun.status is "ok"
    And SweepRun.pagesFetched is 12
    And SweepRun.detailsFetched is 7
    And SweepRun.newListings is 3
    And SweepRun.updatedListings is 2
    And SweepRun.errors is null (empty array → null in Prisma)
    And SweepRun.configSnapshot is the JSON object

  Scenario: finishSweep handles partial or failed status
    Given a SweepRun in progress
    When finishSweep(id, {status: "partial", errors: [{url: "...", status: 404, msg: "not found"}]}) is called
    Then SweepRun.status is "partial"
    And SweepRun.errors is a JSON array with one error object

  Scenario: finishSweep nulls every empty/absent JSON column
    Given a SweepRun in progress
    When finishSweep(id, {
      status: "ok",
      errors: [],
      configSnapshot: null,
      pagesDetail: [],
      detailsDetail: [],
      eventLog: []
    }) is called
    Then SweepRun.errors is SQL NULL (not [])
    And SweepRun.configSnapshot is SQL NULL
    And SweepRun.pagesDetail is SQL NULL
    And SweepRun.detailsDetail is SQL NULL
    And SweepRun.eventLog is SQL NULL

  Scenario: finishSweep persists a non-empty eventLog
    Given a SweepRun in progress
    When finishSweep(id, {status: "ok", eventLog: [{t: 1, msg: "page 1"}]}) is called
    Then SweepRun.eventLog is the JSON array with one entry

  # ============================================================================
  # STALE LISTING QUERIES
  # ============================================================================

  Scenario: findUnenrichedListings returns active rows with null filterValuesEnrichedAt
    Given listing "ENRICHED" with filterValuesEnrichedAt=<5 minutes ago>
    And listing "UNENRICHED_1" with filterValuesEnrichedAt=null, active=true
    And listing "UNENRICHED_2" with filterValuesEnrichedAt=null, active=true
    And listing "UNENRICHED_INACTIVE" with filterValuesEnrichedAt=null, active=false
    When findUnenrichedListings(limit=10) is called
    Then result contains "UNENRICHED_1" and "UNENRICHED_2"
    And result does not contain "ENRICHED" or "UNENRICHED_INACTIVE"

  Scenario: findUnenrichedListings skips excluded rows
    Given listing "EXCLUDED_UNENRICHED" with filterValuesEnrichedAt=null, active=true, excluded=true
    And listing "NORMAL_UNENRICHED" with filterValuesEnrichedAt=null, active=true, excluded=false
    When findUnenrichedListings(limit=10) is called
    Then result contains "NORMAL_UNENRICHED"
    And result does not contain "EXCLUDED_UNENRICHED"

  Scenario: findUnenrichedListings returns empty for non-positive limit
    Given several active unenriched listings exist
    When findUnenrichedListings(limit=0) is called
    Then result is empty and no query is issued

  Scenario: findUnenrichedListings returns oldest lastFetchedAt first
    Given listing "OLD" with filterValuesEnrichedAt=null, lastFetchedAt=<1 hour ago>
    And listing "NEWER" with filterValuesEnrichedAt=null, lastFetchedAt=<10 minutes ago>
    When findUnenrichedListings(limit=10) is called
    Then result order is ["OLD", "NEWER"]

  Scenario: findStaleListings prioritizes watchlist
    Given listing "WATCHLIST_1" with watchlist=true, lastFetchedAt=<2 hours ago>
    And listing "WATCHLIST_2" with watchlist=true, lastFetchedAt=<3 hours ago>
    And listing "STALE_1" with watchlist=false, lastFetchedAt=<2 hours ago>
    And listing "STALE_2" with watchlist=false, lastFetchedAt=<1 hour ago>
    When findStaleListings(limit=2, sinceFetched=<1 hour ago>) is called
    Then result contains exactly "WATCHLIST_1" and "WATCHLIST_2"
    And "STALE_1", "STALE_2" are not included (watchlist takes all slots)

  Scenario: findStaleListings drains watchlist first, then stale
    Given listing "WATCHLIST" with watchlist=true, lastFetchedAt=<2 hours ago>
    And listing "STALE_A" with watchlist=false, lastFetchedAt=<2 hours ago>
    And listing "STALE_B" with watchlist=false, lastFetchedAt=<1 hour ago>
    When findStaleListings(limit=2, sinceFetched=<1 hour ago>) is called
    Then result is ["WATCHLIST", "STALE_A"] (watchlist first, then oldest stale)

  Scenario: findStaleListings excludes excluded listings
    Given listing "EXCLUDED" with watchlist=true, excluded=true, lastFetchedAt=<2 hours ago>
    And listing "NORMAL" with watchlist=false, lastFetchedAt=<2 hours ago>
    When findStaleListings(limit=2, sinceFetched=<1 hour ago>) is called
    Then result does not contain "EXCLUDED"

  Scenario: findStaleListings excludes rows fetched at or after sinceFetched
    Given listing "RECENT" with watchlist=false, lastFetchedAt=<30 minutes ago>
    And listing "OLD" with watchlist=false, lastFetchedAt=<2 hours ago>
    When findStaleListings(limit=10, sinceFetched=<1 hour ago>) is called
    Then result contains "OLD"
    And result does not contain "RECENT" (lastFetchedAt >= sinceFetched, current-sweep touched)

  Scenario: findStaleListings skips inactive listings
    Given listing "INACTIVE" with active=false, watchlist=true, lastFetchedAt=<2 hours ago>
    When findStaleListings(limit=10, sinceFetched=<1 hour ago>) is called
    Then result does not contain "INACTIVE"

  Scenario: findStaleListings returns empty for non-positive limit
    Given several stale active listings exist
    When findStaleListings(limit=0, sinceFetched=<1 hour ago>) is called
    Then result is empty and no query is issued

  Scenario: findStaleListings skips a watchlist row touched this sweep
    Given listing "WATCH_RECENT" with watchlist=true, lastFetchedAt=<10 minutes ago>
    And listing "STALE_OLD" with watchlist=false, lastFetchedAt=<2 hours ago>
    When findStaleListings(limit=2, sinceFetched=<1 hour ago>) is called
    Then result contains "STALE_OLD"
    And result does not contain "WATCH_RECENT" (watchlist priority does not bypass the sinceFetched cutoff)

  # ============================================================================
  # WATCHLIST & EXCLUSION FLAGS
  # ============================================================================

  Scenario: setWatchlist toggles the watchlist flag
    Given listing "X" with watchlist=false
    When setWatchlist("X", true) is called
    Then "X".watchlist is true

  Scenario: setExcluded toggles the excluded flag
    Given listing "Y" with excluded=false
    When setExcluded("Y", true) is called
    Then "Y".excluded is true
    And "Y" is now invisible to diffAgainstDb and findStaleListings queries

  Scenario: setWatchlist throws on a missing listing id
    Given no listing "GHOST" exists
    When setWatchlist("GHOST", true) is called
    Then a Prisma P2025 (record-not-found) error is thrown
    And no row is created (update, not upsert)

  Scenario: setExcluded throws on a missing listing id
    Given no listing "GHOST" exists
    When setExcluded("GHOST", true) is called
    Then a Prisma P2025 (record-not-found) error is thrown

  # ============================================================================
  # DEDUP CLUSTERING
  # ============================================================================

  Scenario: recomputeClusters identifies multi-member clusters via shared images
    Given listing "A" with imageUrls=["photo1.jpg", "photo2.jpg"], firstSeenAt=<1 day ago>
    And listing "B" with imageUrls=["photo1.jpg", "photo3.jpg"], firstSeenAt=<now>
    When recomputeClusters() is called
    Then one cluster is found with canonicalId="A", memberIds=["A", "B"]
    And "B".canonicalId is "A"
    And "A".canonicalId is null (canonical members point nowhere)

  Scenario: recomputeClusters identifies clusters via geo proximity
    Given listing "X" at lat=47.160, lon=27.560, rooms=3, areaSqm=150, firstSeenAt=<2 days ago>
    And listing "Y" at lat=47.160001, lon=27.560001, rooms=3, areaSqm=152, firstSeenAt=<1 day ago>
    When recomputeClusters() is called
    Then one cluster is found linking "X" and "Y"
    And the cluster.reasons array contains "geo"

  Scenario: recomputeClusters identifies clusters via address match
    Given listing "P" with street="Strada Pushkin", sector="Centru", rooms=2, areaSqm=100, firstSeenAt=<3 days ago>
    And listing "Q" with street="Strada Pushkin", sector="Centru", rooms=2, areaSqm=101, firstSeenAt=<2 days ago>
    When recomputeClusters() is called
    Then one cluster is found linking "P" and "Q"
    And the cluster.reasons array contains "address"

  Scenario: recomputeClusters requires area within tolerance
    Given listing "L1" with areaSqm=100, street="Pushkin", sector="Centru", rooms=2, firstSeenAt=<now>
    And listing "L2" with areaSqm=200, street="Pushkin", sector="Centru", rooms=2, firstSeenAt=<now>
    When recomputeClusters() is called
    Then no cluster links "L1" and "L2" (area differs > 10%)

  Scenario: recomputeClusters honors 180-day window
    Given listing "DELISTED" with active=false, delistedAt=<190 days ago>
    And listing "RELISTED" with active=true, firstSeenAt=<now>, imageUrls match "DELISTED"
    When recomputeClusters() is called
    Then "DELISTED" is not included in clustering (outside 180-day window)
    And "RELISTED" is not clustered with anything

  Scenario: recomputeClusters includes delisted rows within 180 days
    Given listing "ORIGINAL" with active=false, delistedAt=<50 days ago>, imageUrls=["photo.jpg"]
    And listing "RELISTED" with active=true, imageUrls=["photo.jpg"], firstSeenAt=<now>
    When recomputeClusters() is called
    Then one cluster is found with canonicalId="ORIGINAL", memberIds=["ORIGINAL", "RELISTED"]
    And "RELISTED".canonicalId is "ORIGINAL"

  Scenario: recomputeClusters clears stale canonicalId assignments
    Given listing "A" with canonicalId="Z"
    And listing "B" with canonicalId="Z"
    When recomputeClusters() is called and no cluster links A or B
    Then "A".canonicalId is null
    And "B".canonicalId is null

  Scenario: recomputeClusters is atomic
    Given 50 listings with various cluster edges
    When recomputeClusters() is called
    And a crash occurs mid-transaction
    Then either all canonicalId assignments are old state, or all are new state
    And no half-updated rows are visible

  Scenario: recomputeClusters respects custom dedup options
    Given listing "X" at lat=47.160, lon=27.560
    And listing "Y" at lat=47.165, lon=27.565 (about 600m away)
    When recomputeClusters({geoMetersThreshold: 1000}) is called
    Then "X" and "Y" are clustered (600m < 1000m threshold)

  Scenario: recomputeClusters returns count of multi-member clusters
    Given 10 listings with 3 multi-member clusters and 7 singletons
    When recomputeClusters() is called
    Then result is 3

  Scenario: geoMatch fails when rooms bucket differs
    Given listing "X" at lat=47.160, lon=27.560, rooms=2, areaSqm=100, firstSeenAt=<now>
    And listing "Y" at lat=47.160001, lon=27.560001, rooms=4, areaSqm=100, firstSeenAt=<now>
    When recomputeClusters() is called
    Then "X" and "Y" are NOT clustered (rooms buckets "1–2" vs "4" differ despite identical coords)

  Scenario: geoMatch fails when area is zero or null
    Given listing "X" at lat=47.160, lon=27.560, rooms=3, areaSqm=0, firstSeenAt=<now>
    And listing "Y" at lat=47.160001, lon=27.560001, rooms=3, areaSqm=150, firstSeenAt=<now>
    When recomputeClusters() is called
    Then "X" and "Y" are NOT clustered (areaWithin rejects area <= 0)

  Scenario: addressMatch normalizes street before comparing
    Given listing "P" with street="Str. Pușkin", sector="Centru", rooms=2, areaSqm=100, firstSeenAt=<now>
    And listing "Q" with street="  STRADA   PUSKIN ", sector="Centru", rooms=2, areaSqm=100, firstSeenAt=<later>
    When recomputeClusters() is called
    # normalizeStreet strips case, diacritics, punctuation, collapses whitespace
    Then whether "P" and "Q" cluster depends solely on the normalized token equality
    And a street that normalizes to empty string never address-matches

  Scenario: clusters via transitive edges across mixed signals
    Given listing "A" and "B" share an image
    And listing "B" and "C" are a geo match (but A and C share no signal)
    When recomputeClusters() is called
    Then one cluster {A, B, C} is formed (Union-Find transitivity)
    And cluster.reasons contains both "image" and "geo"

  Scenario: canonical tie-break on equal firstSeenAt uses id ordering
    Given listing "ZZZ" and listing "AAA" both with firstSeenAt=<exact same instant>, sharing an image
    When recomputeClusters() is called
    Then cluster.canonicalId is "AAA" (localeCompare tie-break, lexicographically smallest)
    And "ZZZ".canonicalId is "AAA"

  Scenario: recomputeClusters clears a stale canonicalId on a row outside the 180-day window
    Given listing "ANCIENT" with active=false, delistedAt=<200 days ago>, canonicalId="SOMEONE"
    When recomputeClusters() is called
    Then "ANCIENT".canonicalId is null
    # The clear step touches ALL non-null canonicalId rows, even those not loaded
    # as candidates (the candidate WHERE only bounds which rows can be RE-assigned).

  Scenario: recomputeClusters coerces malformed imageUrls to empty
    Given listing "BAD_JSON" with imageUrls stored as a non-array JSON value
    And listing "GOOD" with imageUrls=["photo.jpg"]
    When recomputeClusters() is called
    Then no error is raised
    And "BAD_JSON" image-matches nothing (treated as empty image set)

  Scenario: canonicalMap maps singletons to themselves
    Given listing "SOLO" matches no other listing
    When canonicalMap([...]) is computed
    Then canonicalMap.get("SOLO") equals "SOLO"
    # Contrast with clusterListings(), which omits singletons entirely.

  # ============================================================================
  # CONFIG SNAPSHOTTING
  # ============================================================================

  Scenario: snapshotConfig returns all current settings as a flat object
    Given setting "politeness.baseDelayMs" = 8000
    And setting "politeness.jitterMs" = 2000
    And setting "sweep.maxPagesPerSweep" = 20
    When snapshotConfig() is called
    Then result is {
      "politeness.baseDelayMs": 8000,
      "politeness.jitterMs": 2000,
      "sweep.maxPagesPerSweep": 20
    }
    And it reads from the instance's injected PrismaClient, not the getPrisma() singleton (no split-brain)

  Scenario: snapshotConfig returns every Setting row unfiltered
    Given settings exist for both known keys and an unknown "experimental.flag"
    When snapshotConfig() is called
    Then result includes "experimental.flag" (no namespacing or allow-list filter is applied)

  Scenario: snapshotConfig returns empty object when no settings exist
    Given the Setting table is empty
    When snapshotConfig() is called
    Then result is {}

  # ============================================================================
  # CLIENT BOOTSTRAP (db.ts)
  # ============================================================================

  Scenario: getPrisma throws when DATABASE_URL is unset
    Given the DATABASE_URL environment variable is not set
    When getPrisma() is called for the first time
    Then it throws Error("DATABASE_URL environment variable is not set")

  Scenario: getPrisma returns the same singleton across calls
    Given DATABASE_URL is set
    When getPrisma() is called twice
    Then both calls return the same PrismaClient instance

  Scenario: disconnectPrisma allows re-instantiation
    Given getPrisma() has created a client
    When disconnectPrisma() is called
    And getPrisma() is called again
    Then a fresh PrismaClient is constructed (the cached singleton was cleared)

  # ============================================================================
  # EDGE CASES & ERROR HANDLING
  # ============================================================================

  Scenario: persistDetail with empty filter-values list
    Given listing "X" does not exist
    When persistDetail(parsed detail with filterValues=[]) is called
    Then "X" exists
    And "X" has zero ListingFilterValue rows
    And no error is raised

  Scenario: markSeen with empty stubs list
    When markSeen([]) is called
    Then no database updates occur
    And no error is raised

  Scenario: persistDetail with null imageUrls
    Given listing "X" does not exist
    When persistDetail(parsed detail with imageUrls=[]) is called
    Then "X".imageUrls is empty or null
    And listing is persisted successfully

  Scenario: Dedup over sparse data — only image signal
    Given 100 listings with 50 having images, 0 with geo, 0 with full address
    When recomputeClusters() is called
    Then only image-based clusters are formed
    And multi-member clusters < 5 (sparse matching)

  Scenario: markInactiveOlderThan with future cutoff
    Given an active listing "X" with lastSeenAt=<now>
    When markInactiveOlderThan(-1000) is called (cutoff in the future)
    Then "X".active is false (even though lastSeenAt is recent)
    And result count is 1

  Scenario: persistDetail normalizes priceRaw to null if unparseable
    Given parsed detail with priceRaw="invalid"
    When persistDetail(detail) is called
    Then "X".priceRaw is "invalid"
    And "X".priceEur is null
    And listing is persisted (no parse error is fatal)

  Scenario: Multiple snapshots over time record price history
    Given listing "X" exists
    When persistDetail(detail with priceEur=100000, hash="a") is called
    And persistDetail(detail with priceEur=95000, hash="b") is called
    And persistDetail(detail with priceEur=90000, hash="c") is called
    Then "X" has three snapshots
    And snapshot[0].priceEur is 100000
    And snapshot[1].priceEur is 95000
    And snapshot[2].priceEur is 90000

