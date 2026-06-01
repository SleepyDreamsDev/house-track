Feature: MCP Server (Read-Only SQL over the Catalog)
  In order for Claude Desktop to query the house-track listing catalog
  As an MCP server running as a local stdio process
  I want to expose curated search tools, an open-ended SQL runner, and the database schema
  So Claude can discover listings, ask questions, and analyze the data interactively

  Background:
    Given a fresh Postgres database with the house-track schema applied
    And at least one Listing with id "test-001" exists
    And at least one Listing with id "test-002" exists with a price drop snapshot
    And DATABASE_URL is set (rw role)
    And DATABASE_URL_RO is set (read-only role, SELECT-only) or tests are skipped
    And the MCP server is running locally (stdio transport)

  # ────────────────────────────────────────────────────────────────────────────
  # list_filters() tool
  # ────────────────────────────────────────────────────────────────────────────

  Scenario: list_filters returns the observed filter universe sorted by prevalence
    When I call the list_filters tool
    Then the response is a JSON array of FilterGroup objects
    And each FilterGroup has filterId, featureId, optionIds[], sampleListingIds[], listingCount
    And the array is sorted by listingCount descending
    And sampleListingIds contains at most 3 listing IDs per group

  Scenario: list_filters includes human-readable labels when taxonomy data is available
    Given the taxonomy-labels.ts file contains labels for filterId 1, featureId 100, optionId 776
    When I call the list_filters tool
    Then the response includes groups with filterLabel, featureLabel, and optionLabels populated
    And groups without taxonomy labels have filterLabel=null

  Scenario: list_filters returns an empty array when the database has no listings
    Given the database has no Listing rows
    When I call the list_filters tool
    Then the response is an empty array

  # ────────────────────────────────────────────────────────────────────────────
  # search_listings() tool
  # ────────────────────────────────────────────────────────────────────────────

  Scenario: search_listings with no filters returns all active listings
    Given the database has 10 active Listings
    When I call search_listings with no filters and limit=50
    Then the response contains 10 listings
    And the response total is 10
    And all listings have active=true

  Scenario: search_listings respects limit and offset pagination
    Given the database has 20 active Listings
    When I call search_listings with limit=5 and offset=10
    Then the response contains 5 listings
    And the response total is 20
    And the 5 listings are the 11th–15th items

  Scenario: search_listings with minPrice and maxPrice AND-s the range filters
    Given Listings with prices 50000, 100000, 150000, 200000 EUR exist
    When I call search_listings with minPrice=75000 and maxPrice=175000
    Then the response contains only listings priced between 75000 and 175000
    And the response includes the 100000 and 150000 EUR listings
    And the response excludes the 50000 and 200000 EUR listings

  Scenario: search_listings with minRooms and maxRooms filters on room count
    Given Listings with 2, 3, 4, 5 rooms exist
    When I call search_listings with minRooms=3 and maxRooms=4
    Then the response includes only the 3 and 4 room listings

  Scenario: search_listings with minAreaSqm and maxAreaSqm filters on area
    Given Listings with areas 60, 100, 150, 200 sqm exist
    When I call search_listings with minAreaSqm=80 and maxAreaSqm=160
    Then the response includes only the 100 and 150 sqm listings

  Scenario: search_listings with district filters on a single district
    Given Listings in districts "Botanica", "Centru", "Riscani" exist
    When I call search_listings with district="Botanica"
    Then the response includes only listings in Botanica
    And the response total equals the count of Botanica listings

  Scenario: search_listings with multiple district values OR-s them
    Given Listings in districts "Botanica", "Centru", "Riscani", "Ciocana" exist
    When I call search_listings with district=["Botanica", "Centru"]
    Then the response includes only listings in Botanica or Centru
    And the response excludes Riscani and Ciocana listings

  Scenario: search_listings with q filters on title substring (case-insensitive)
    Given a Listing with title "Modern House with Garden"
    And a Listing with title "Old Cottage on the Hill"
    When I call search_listings with q="house"
    Then the response includes only the "Modern House with Garden" listing

  Scenario: search_listings with filters array applies facet logic (AND across groups, OR within)
    Given Listings with multiple filter values:
      | id       | featureId | optionIds |
      | test-001 | 10        | [100]     |
      | test-002 | 10        | [101]     |
      | test-003 | 20        | [200]     |
      | test-004 | 20        | [200]     |
    When I call search_listings with filters=[
      {featureId: 10, optionIds: [100, 101]},
      {featureId: 20, optionIds: [200]}
    ]
    Then the response includes test-001, test-002, test-003, test-004
    And the response excludes listings without both feature 10 and feature 20

  Scenario: search_listings sort=priceAsc orders by price ascending
    Given Listings with prices 200000, 50000, 150000 EUR exist
    When I call search_listings with sort="priceAsc"
    Then the listings are ordered: 50000, 150000, 200000

  Scenario: search_listings sort=priceDesc orders by price descending
    Given Listings with prices 50000, 200000, 150000 EUR exist
    When I call search_listings with sort="priceDesc"
    Then the listings are ordered: 200000, 150000, 50000

  Scenario: search_listings sort=newest orders by firstSeenAt descending
    Given Listings first seen 10 days ago, 5 days ago, 1 day ago exist
    When I call search_listings with sort="newest"
    Then the listings are ordered by firstSeenAt descending (newest first)

  Scenario: search_listings flags=priceDrop filters by >= 5% price drop in past 7 days
    Given a Listing with first snapshot priceEur=100000 captured 10 days ago
    And a snapshot with priceEur=95000 captured 2 days ago (5% drop)
    And another Listing with two snapshots: 100000, 100500 (no drop)
    When I call search_listings with flags="priceDrop"
    Then the response includes only the first Listing
    And the response excludes the second Listing (no price drop)

  Scenario: search_listings flags=priceDrop ignores price changes outside the past 7 days
    Given a Listing with first snapshot priceEur=100000 captured 30 days ago
    And a snapshot with priceEur=94000 captured 29 days ago (6% drop, but older than 7 days)
    When I call search_listings with flags="priceDrop"
    Then the response excludes this Listing (drop is outside 7-day window)

  Scenario: search_listings type filter matches the capitalized DerivedType exactly
    Given Listings with titles:
      | id       | title                  |
      | test-001 | Casa cu 3 camere       |
      | test-002 | Vila moderna de lux    |
      | test-003 | Town house elegant     |
    When I call search_listings with type="Villa"
    Then the response includes only test-002 (deriveType == "Villa")
    And test-001 and test-003 are excluded

  Scenario: search_listings type filter is case-sensitive — lowercase matches nothing
    Given Listings with a title that classifies as "Villa"
    When I call search_listings with type="villa"
    Then the response is empty
    # deriveType returns the capitalized "Villa"; the post-filter is a strict === comparison

  Scenario: search_listings type filter default classification is "House" (no "other")
    Given a Listing with title "Apartament in Chisinau"
    When I call search_listings with type="House"
    Then the listing is included (no villa/townhouse/duplex regex matched, so derivedType defaults to "House")

  Scenario: search_listings type filter applies on top of priceDrop
    Given the priceDrop branch is active (flags="priceDrop")
    When I also pass type="House"
    Then only price-drop listings whose title classifies as "House" are returned
    # priceDrop wins the branch; type composes via matchesType()

  Scenario: search_listings returns derivedType, typeMismatch, regionMismatch, and mismatchReasons
    Given a Listing with title "Vila de lux in Orhei" (villa, non-Chisinau district)
    When I call search_listings
    Then the SearchListingsRow includes:
      - derivedType: "Villa" (capitalized)
      - typeMismatch: true (derivedType != "House")
      - regionMismatch: true (district outside Chisinau municipality)
      - mismatchReasons: ["type: villa", "region: Orhei"]

  Scenario: search_listings sort=pricePerSqmAsc falls back to newest (no price/sqm column)
    Given Listings with varied price-per-sqm values
    When I call search_listings with sort="pricePerSqmAsc"
    Then the listings are ordered by firstSeenAt descending (NOT by price per sqm)
    # orderBy() has no eur/m2 column, so it falls back to firstSeenAt desc; same for the "eurm2" alias

  Scenario: search_listings primaryImage expands a bare CDN filename to a full thumbnail URL
    Given a Listing with imageUrls=["d870abc.jpg"]
    When I call search_listings
    Then primaryImage="https://i.simpalsmedia.com/999.md/BoardImages/320x240/d870abc.jpg"
    # primaryThumb expands bare filenames; already-absolute http(s) URLs pass through unchanged

  Scenario: search_listings flags=priceDrop total is the pre-filter count (known inconsistency)
    Given 100 active Listings match the where clause but only 3 have a >=5% drop in the page
    When I call search_listings with flags="priceDrop"
    Then total reflects the pre-filter count (e.g. 100), not the number of drop matches returned
    And listings contains only the drop matches within the fetched page

  Scenario: search_listings flags=priceDrop needs >=2 snapshots inside the 7-day window
    Given a Listing with exactly one snapshot in the past 7 days
    When I call search_listings with flags="priceDrop"
    Then the Listing is excluded (need both an old and a new in-window snapshot)

  Scenario: search_listings exposes only a subset of SearchListingsInput via the MCP schema
    When Claude inspects the search_listings inputSchema
    Then the schema offers: minPrice, maxPrice, minRooms, maxRooms, minAreaSqm, maxAreaSqm, district, filters, sort, limit
    And it does NOT offer: sector, q, offset, flags, type, favorite, includeExcluded, minLandAre, maxLandAre, minFloors, maxFloors, firstSeenAfter, lastFetchedAfter
    And limit is constrained to a positive integer <= 500

  Scenario: search_listings returns primaryImage (first photo URL or null)
    Given a Listing with imageUrls=["https://cdn.example.com/photo1.jpg", "https://cdn.example.com/photo2.jpg"]
    When I call search_listings
    Then the SearchListingsRow includes primaryImage="https://cdn.example.com/photo1.jpg"

  Scenario: search_listings returns primaryImage=null when imageUrls is empty
    Given a Listing with imageUrls=[]
    When I call search_listings
    Then the SearchListingsRow includes primaryImage=null

  # ────────────────────────────────────────────────────────────────────────────
  # get_listing(id) tool
  # ────────────────────────────────────────────────────────────────────────────

  Scenario: get_listing returns the full record for a single listing
    Given a Listing with id "test-001" and all fields populated
    When I call get_listing with id="test-001"
    Then the response includes all Listing fields (title, priceEur, areaSqm, district, etc.)
    And all timestamps are ISO strings (not Date objects)

  Scenario: get_listing includes all filter-value triples (featureId, optionId, textValue, numericValue)
    Given a Listing with 3 ListingFilterValue rows
    When I call get_listing with the listing id
    Then the response includes filterValues array with 3 FilterValueRow objects
    And each FilterValueRow has filterId, featureId, optionId, textValue, numericValue

  Scenario: get_listing includes primaryImage derived from imageUrls
    Given a Listing with imageUrls=["https://cdn.example.com/photo.jpg"]
    When I call get_listing
    Then the response includes primaryImage="https://cdn.example.com/photo.jpg"

  Scenario: get_listing returns error and isError=true when listing id is not found
    When I call get_listing with id="nonexistent-id"
    Then the response has isError=true
    And the response contains error message "Listing not found: nonexistent-id"

  # ────────────────────────────────────────────────────────────────────────────
  # run_sql(sql) tool
  # ────────────────────────────────────────────────────────────────────────────

  Scenario: run_sql validates and accepts a simple SELECT query
    When I call run_sql with sql="SELECT id, priceEur FROM \"Listing\" WHERE active=true"
    Then the response includes rows, rowCount, truncated, cached, cachedAt, sqlExecuted
    And sqlExecuted is the wrapped form: SELECT * FROM (\n<original>\n) AS _q LIMIT 500

  Scenario: run_sql accepts a WITH (CTE) query
    When I call run_sql with sql="WITH prices AS (SELECT priceEur FROM \"Listing\") SELECT AVG(priceEur) FROM prices"
    Then the response includes the computed average price

  Scenario: run_sql rejects empty query
    When I call run_sql with sql=""
    Then the response has isError=true
    And the error message includes "Empty query."

  Scenario: run_sql rejects comment-only query
    When I call run_sql with sql="-- just a comment"
    Then the response has isError=true
    And the error message includes "Query is only comments/whitespace."

  Scenario: run_sql rejects non-SELECT query (INSERT, UPDATE, DELETE, DROP, etc.)
    When I call run_sql with sql="INSERT INTO \"Listing\" VALUES (...)"
    Then the response has isError=true
    And the error message includes "Only read-only SELECT (or WITH … SELECT) queries are allowed."

  Scenario: run_sql rejects multiple statements separated by semicolon
    When I call run_sql with sql="SELECT * FROM \"Listing\"; SELECT * FROM \"SweepRun\";"
    Then the response has isError=true
    And the error message includes "Only a single statement is allowed."

  Scenario: run_sql rejects unterminated string literal
    When I call run_sql with sql="SELECT * FROM \"Listing\" WHERE title = 'unclosed string"
    Then the response has isError=true
    And the error message is exactly "Unterminated string, comment, or quoted literal."

  Scenario: run_sql rejects unterminated block comment
    When I call run_sql with sql="SELECT * FROM \"Listing\" /* unclosed comment"
    Then the response has isError=true
    And the error message is exactly "Unterminated string, comment, or quoted literal."

  Scenario: run_sql rejects unterminated dollar-quote
    When I call run_sql with sql="SELECT * FROM \"Listing\" WHERE description = $tag$unclosed"
    Then the response has isError=true
    And the error message is exactly "Unterminated string, comment, or quoted literal."

  Scenario: run_sql rejects unterminated quoted identifier
    When I call run_sql with sql="SELECT * FROM \"Listing"
    Then the response has isError=true
    And the error message is exactly "Unterminated string, comment, or quoted literal."

  Scenario: run_sql accepts an anonymous dollar-quoted string ($$...$$)
    When I call run_sql with sql="SELECT $$plain text$$ AS note"
    Then the response does not return an error
    # The dollar-quote tag regex matches the anonymous $$ form

  Scenario: run_sql accepts a leading keyword case-insensitively
    When I call run_sql with sql="select 1 AS one"
    Then the response does not return an error

  Scenario: run_sql does NOT block a writable CTE at the app layer (DB role is the backstop)
    When I call run_sql with sql="WITH x AS (DELETE FROM \"Listing\" RETURNING id) SELECT * FROM x"
    Then app validation passes (leading keyword is WITH)
    And the query is rejected at the database by the read-only role / read-only transaction
    And the error message is scrubbed

  Scenario: run_sql strips comments and strings during validation
    When I call run_sql with sql="SELECT * /* DROP TABLE */ FROM \"Listing\" WHERE title = 'DROP TABLE'; -- no harm"
    Then the response does not return an error (the DROP is inside a comment/string)
    And the results are returned normally

  Scenario: run_sql caps results at 500 rows
    Given the database has 1000 active Listings
    When I call run_sql with sql="SELECT id FROM \"Listing\""
    Then the response includes rowCount <= 500
    And the response includes truncated=true
    And the response includes a note that results are capped

  Scenario: run_sql caps results at ~100 KB
    When I call run_sql with a query that would return > 100 KB of JSON
    Then the response includes truncated=true
    And rowCount reflects the actual rows returned (at least 1)

  Scenario: run_sql applies 5-second statement timeout
    When I call run_sql with a deliberately slow query (e.g., Cartesian product)
    Then the query is killed by the 5-second timeout
    And the response has isError=true
    And the error message reports a timeout or connection closed

  Scenario: run_sql caches results keyed to latest SweepRun.finishedAt
    Given a SweepRun with finishedAt at time T1
    When I call run_sql twice with the same SQL
    Then the first call has cached=false
    And the second call has cached=true and cachedAt matches first call's execution time
    And when a new SweepRun finishes at time T2 (T2 > T1)
    And I call run_sql with the same SQL again
    Then the cache is invalidated (cached=false, fresh query runs)

  Scenario: run_sql runs the SweepRun version probe on every call, even cache hits
    Given a query that is already cached
    When I call run_sql with the same SQL again
    Then the SELECT max("finishedAt") FROM "SweepRun" probe is executed against the RO pool
    And only the user query is skipped (served from cache), not the probe

  Scenario: run_sql version probe returns "none" when SweepRun is empty
    Given the SweepRun table has no rows
    When I call run_sql
    Then the cache key version segment is the literal "none"

  Scenario: run_sql truncated is true when the raw row cap is hit even if bytes are small
    Given a query returning exactly 500 small rows
    When I call run_sql
    Then rowCount is 500
    And truncated is true (rowCapHit: result.rows.length >= 500)

  Scenario: run_sql keeps at least one row even if that row alone exceeds 100 KB
    Given a query whose single row serializes to more than 100 KB
    When I call run_sql
    Then rowCount is 1
    And truncated is true
    And the envelope may exceed 100 KB for that one row

  Scenario: run_sql replays cached truncated and cachedAt on a hit
    Given a first call that returned truncated=true with cachedAt=T
    When I call run_sql with the same SQL (same sweep version)
    Then the second response has cached=true, truncated=true, cachedAt=T

  Scenario: run_sql NotConfiguredError message points to the docs
    Given DATABASE_URL_RO is unset
    When I call run_sql
    Then the error message is exactly "run_sql is not configured — set DATABASE_URL_RO (see docs/mcp-setup.md)"

  Scenario: run_sql scrub only redacts postgres-prefixed connection strings
    Given an error message containing "postgresql://user:p@ss@host/db" (unencoded @ in password)
    When run_sql surfaces the error
    Then the message becomes "postgresql://***@host/db" (greedy through the LAST @)
    And a non-postgres-prefixed secret in an error would NOT be scrubbed

  Scenario: run_sql wraps the query with the runner's configured rowLimit
    Given a SqlRunner constructed with rowLimit=10
    When I call run_sql with sql="SELECT id FROM \"Listing\""
    Then sqlExecuted ends with "AS _q LIMIT 10"

  Scenario: run_sql returns BigInt values serialized as strings
    When I call run_sql with a query that returns large integers (e.g., COUNT(*) > 2^32)
    Then the response rows contain the bigint as a JSON string, not a number
    And the JSON is valid and parseable

  Scenario: run_sql scrubs credentials from error messages
    Given DATABASE_URL_RO="postgresql://user:password@localhost/db"
    When I call run_sql with invalid SQL or a connection error occurs
    Then the error message does NOT contain "password"
    And the error message has credentials redacted as "postgresql://***@localhost/db"

  Scenario: run_sql reports NotConfiguredError when DATABASE_URL_RO is not set
    Given DATABASE_URL_RO is unset or null
    When I call run_sql
    Then the response has isError=true
    And the error message includes "run_sql is not configured — set DATABASE_URL_RO"
    And other tools (list_filters, search_listings, get_listing) still work

  # ────────────────────────────────────────────────────────────────────────────
  # schema://house-track resource
  # ────────────────────────────────────────────────────────────────────────────

  Scenario: schema resource reads the Prisma schema and returns it with a preamble
    When I read the schema://house-track resource
    Then the response is plain text (not JSON)
    And the response includes a preamble explaining:
      - Timezone is Europe/Chisinau (naive datetimes are local time)
      - priceEur is EUR-normalized (nullable, ~90% of rows)
      - priceRaw keeps the source price string for audit
      - filterId=0 means the taxonomy group is not yet captured
      - Table and column names are case-sensitive
    And the response includes the full Prisma schema from prisma/schema.prisma

  Scenario: schema resource is memoized (read from disk only once)
    When I read schema://house-track multiple times in the same process
    Then the schema is loaded from disk on the first read
    And subsequent reads return the cached copy without hitting the filesystem
    And schemaReadCount() returns 1 after any number of reads
    And resetSchemaCache() forces the next read back to disk (readCount resets to 0 then 1)

  Scenario: schema resource throws if prisma/schema.prisma is missing
    Given prisma/schema.prisma does not exist on disk
    When I read schema://house-track for the first time
    Then loadSchemaText() throws (readFileSync has no error handling, no cached fallback)

  Scenario: schema resource describes all tables, columns, and indexes
    When I read schema://house-track
    Then the schema includes definitions for:
      - Listing (with id, url, title, priceEur, priceRaw, areaSqm, landAre, rooms, district, sector, floors, yearBuilt, active, watchlist, excluded, firstSeenAt, lastSeenAt, lastFetchedAt, filterValuesEnrichedAt, delistedAt, delistReason, imageUrls, features, description, postedAt, bumpedAt, lat, lon, authorId, authorName, authorType, phone, canonicalId, etc.)
      - ListingFilterValue (filterId, featureId, optionId, textValue, numericValue, etc.)
      - ListingSnapshot (capturedAt, priceEur, description, rawHtmlHash, etc.)
      - SweepRun (startedAt, finishedAt, status, pagesFetched, detailsFetched, newListings, updatedListings, errors, source, trigger, kind, configSnapshot, pagesDetail, detailsDetail, eventLog, etc.)
      - Source (slug, name, baseUrl, adapterKey, enabled, politenessOverridesJson, filterOverridesJson, etc.)
      - Setting (key, valueJson, updatedAt)
      - FetchTask (listingId, priority, reason, enqueuedAt, attemptCount, lastError, scheduledFor, etc.)
      - ThrottleEvent (triggeredAt, trigger, durationMs, context, etc.)

  # ────────────────────────────────────────────────────────────────────────────
  # MCP Server Integration
  # ────────────────────────────────────────────────────────────────────────────

  Scenario: MCP server starts cleanly and connects to the database
    When the MCP server is launched (pnpm mcp or via Claude Desktop)
    Then the server initializes without error
    And Prisma client connects via DATABASE_URL
    And SqlRunner is instantiated (lazily, not connected until first run_sql call)

  Scenario: MCP server exposes all 4 tools and 1 resource via stdio JSON-RPC
    When Claude Desktop connects to the MCP server
    Then the server reports these available tools:
      - list_filters
      - search_listings
      - get_listing
      - run_sql
    And the server reports this available resource:
      - schema://house-track

  Scenario: MCP server handles concurrent requests from Claude Desktop
    When Claude makes 3 concurrent tool calls (e.g., list_filters, search_listings, get_listing)
    Then all requests are processed
    And Prisma connection pooling handles concurrency
    And results are returned for all 3 calls without interference

  Scenario: MCP server scrubs credentials only on the run_sql path
    When a run_sql call fails with a connection/auth error
    Then scrubError() redacts any postgres(ql):// credentials before returning to Claude
    But the curated Prisma tools (list_filters, search_listings, get_listing) do NOT route errors through scrubError
    # Prisma errors generally omit the password, but they are not explicitly scrubbed

  Scenario: SqlRunner pool is built lazily on the first run_sql, capped at max 2 connections
    Given DATABASE_URL_RO is set and no run_sql has been called yet
    Then no pg.Pool exists
    When the first run_sql is called
    Then a pg.Pool is built with max=2, statement_timeout=5000, options="-c default_transaction_read_only=on"
    And an injected pool (test seam) bypasses lazy construction and is never ended by SqlRunner.close()

  Scenario: MCP server fatal startup error goes to stderr and exits non-zero
    Given server.connect(transport) rejects
    Then the message is written to stderr (not stdout, which is reserved for JSON-RPC)
    And the process exits with code 1

  Scenario: MCP server runs on stdio transport (not TCP)
    When Claude Desktop launches the server process
    Then the server reads JSON-RPC requests from stdin
    And the server writes JSON-RPC responses to stdout
    And stderr is used for startup/fatal errors only
    And the server uses the StdioServerTransport from the MCP SDK

  Scenario: MCP server integrates with the operator UI's analytics layer
    Given the operator UI fetches listings from /api/listings
    When an MCP client runs the same search via search_listings()
    Then both queries read the same underlying database
    And results are consistent (same listings, same counts)
    And the MCP server does not bypass or modify DB state

  # ────────────────────────────────────────────────────────────────────────────
  # Error Resilience
  # ────────────────────────────────────────────────────────────────────────────

  Scenario: get_listing("nonexistent") does not crash the server
    When I call get_listing with an id that does not exist
    Then the server returns isError=true
    And the server remains running and can handle subsequent requests

  Scenario: run_sql with a syntax error does not crash the server
    When I call run_sql with invalid SQL
    Then the server returns isError=true with the parse/execution error
    And the server remains running and can handle subsequent requests

  Scenario: run_sql with a timeout does not leak a connection
    When I call run_sql with a slow query that hits the 5s timeout
    Then the connection is terminated by the DB
    And the next run_sql call acquires a fresh connection
    And the pool max (2 connections) is never exceeded

  # ────────────────────────────────────────────────────────────────────────────
  # Contracts & Types
  # ────────────────────────────────────────────────────────────────────────────

  Scenario: search_listings response adheres to SearchListingsEnvelope contract
    When I call search_listings
    Then the response is a JSON object with exactly:
      - listings: SearchListingsRow[] (array of listings)
      - total: number (total count across all pages)

  Scenario: SearchListingsRow has all required fields
    When I call search_listings
    And the response includes at least one listing
    Then each listing has:
      - id: string
      - url: string
      - title: string
      - priceEur: number | null
      - priceRaw: string | null
      - areaSqm: number | null
      - landAre: number | null
      - rooms: number | null
      - district: string | null
      - firstSeenAt: string (ISO)
      - lastSeenAt: string (ISO)
      - lastFetchedAt: string (ISO)
      - watchlist: boolean
      - excluded: boolean
      - derivedType: "house" | "villa" | "townhouse" | "other"
      - typeMismatch: boolean
      - regionMismatch: boolean
      - mismatchReasons: string[]
      - primaryImage: string | null

  Scenario: RunSqlResult has all required fields
    When I call run_sql with a valid SELECT
    Then the response has exactly:
      - rows: unknown[] (result set)
      - rowCount: number (rows in response, post-truncation)
      - truncated: boolean (true if 500-row or 100 KB cap hit)
      - cached: boolean (true if served from cache)
      - cachedAt: string | null (ISO timestamp if cached, null otherwise)
      - sqlExecuted: string (the wrapped SQL)

  Scenario: GetListingResult includes filterValues array
    When I call get_listing
    Then the response includes filterValues: FilterValueRow[]
    And each FilterValueRow has:
      - filterId: number
      - featureId: number
      - optionId: number | null
      - textValue: string | null
      - numericValue: number | null
