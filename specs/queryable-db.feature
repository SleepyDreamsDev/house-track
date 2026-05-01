Feature: Queryable listings DB + local MCP server for Claude Desktop
  As the user of the crawler
  I want to ask natural-language questions about Chișinău houses for sale
  So that I can shortlist candidates from Claude Desktop and click through to 999.md

  Background:
    Given the crawler has populated the local SQLite DB
    And the query layer reads only the local DB (no live 999.md traffic at query time)

  # ─── Schema ──────────────────────────────────────────────────────────────

  Scenario: Schema exposes a relational filter-value table
    Given the Prisma schema has been migrated
    Then a "ListingFilterValue" model exists with columns listingId, filterId, featureId, optionId, textValue, numericValue
    And it has an index on (filterId, featureId, optionId) for fast facet queries
    And it has an index on (listingId) for per-listing lookups
    And the "Listing" model has a "filterValuesEnrichedAt" timestamp column (nullable)

  # ─── parseDetail filter extraction ───────────────────────────────────────

  Scenario: parseDetail extracts filter values from the advert response
    Given a captured GetAdvert response with FEATURE_OPTIONS, FEATURE_TEXT, FEATURE_INT entries
    When parseDetail runs
    Then the result includes a filterValues array
    And each FEATURE_OPTIONS entry produces a triple {featureId, optionId} with optionId from value.value
    And each FEATURE_TEXT entry produces a triple {featureId, textValue} with text from value
    And each FEATURE_INT entry produces a triple {featureId, numericValue}
    And FEATURE_PRICE entries produce a numericValue (the price.value.value)
    And FEATURE_BODY, FEATURE_IMAGES, FEATURE_MAP_POINT entries are NOT included as filter values

  Scenario: parseDetail tolerates an advert with no recognizable feature entries
    Given an advert response with only id, title, state
    When parseDetail runs
    Then filterValues is an empty array
    And no error is thrown

  # ─── Persistence ────────────────────────────────────────────────────────

  Scenario: persistDetail writes filter values atomically with the listing upsert
    Given a ParsedDetail with three filterValues
    When persistDetail runs
    Then a Listing row exists for the advert id
    And exactly three ListingFilterValue rows exist for that listingId
    And the listing's filterValuesEnrichedAt timestamp is set to now

  Scenario: persistDetail replaces filter values on re-fetch (no duplicates accumulate)
    Given persistDetail was already called with two filterValues for listing X
    When persistDetail runs again with three different filterValues for X
    Then exactly three ListingFilterValue rows exist for X
    And none of the previous two rows survive

  # ─── Sweep backfill ──────────────────────────────────────────────────────

  Scenario: Sweep backfills up to N listings whose filterValuesEnrichedAt is null
    Given the DB has 50 listings with NULL filterValuesEnrichedAt
    And SWEEP.backfillPerSweep is 30
    When the sweep finishes its new-listing detail fetches
    Then the sweep additionally re-fetches details for 30 listings
    And those 30 are the oldest by lastFetchedAt
    And persistDetail is called for each, populating filterValuesEnrichedAt

  Scenario: backfillPerSweep set to 0 disables backfill
    Given SWEEP.backfillPerSweep is 0
    When the sweep finishes its new-listing detail fetches
    Then no extra detail re-fetches happen

  Scenario: A backfill detail fetch failing does not abort the sweep
    Given backfill picks 3 listings
    And the second fetchAdvert call rejects with a network error
    When the sweep runs
    Then the third backfill attempt still runs
    And the sweep status is "partial"

  # ─── Politeness profile ─────────────────────────────────────────────────

  Scenario: GraphQL POSTs send Accept: application/json
    When fetchGraphQL is invoked
    Then the outgoing request's Accept header is "application/json, text/plain, */*"
    And GET requests still send the configured HTML Accept header

  Scenario: Every GraphQL request carries Origin, Referer, and Sec-Fetch-* headers
    When fetchGraphQL is invoked
    Then the request carries Origin "https://999.md"
    And the request carries Referer "https://999.md/ro/list/real-estate/houses-and-yards"
    And the request carries Sec-Fetch-Dest "empty", Sec-Fetch-Mode "cors", Sec-Fetch-Site "same-origin"

  Scenario: An HTML interstitial response on a GraphQL POST trips the breaker
    Given the server returns 200 with content-type "text/html" on a GraphQL POST
    When fetchGraphQL is invoked
    Then the circuit is tripped immediately
    And the call rejects with a CircuitTrippingError
    And no JSON.parse is attempted on the body

  Scenario: Detail fetches use the longer detailDelayMs between requests
    Given baseDelayMs is 8000 and detailDelayMs is 10000
    When the fetcher runs an index page (no override) followed by a detail call (delayMs override 10000)
    Then the inter-request sleep before the detail call is ≥ 10000 ms

  # ─── MCP query helpers ──────────────────────────────────────────────────

  Scenario: list_filters aggregates observed filter universe
    Given listings exist with filter values across (featureId 1, optionId 776) and (featureId 7, optionId 12900)
    When list_filters() is called
    Then the result includes both (featureId, optionIds) groups
    And each group has a listingCount > 0
    And each group has up to 3 sampleListingIds

  Scenario: search_listings filters by price, area, and rooms ranges
    Given 5 listings with varying price, area, and rooms
    When search_listings({minPrice: 80000, maxPrice: 120000, minRooms: 3}) is called
    Then only matching listings are returned
    And each returned object has a clickable url of the form "https://999.md/ro/<id>"
    And the result is structured JSON (no pre-formatted strings)

  Scenario: search_listings combines multiple feature filters with AND across groups, OR within
    Given listings with various feature values
    When search_listings({filters: [{featureId: 7, optionIds: [12900, 12901]}, {featureId: 1, optionIds: [776]}]}) is called
    Then only listings matching (feature 7 in {12900,12901}) AND (feature 1 = 776) are returned

  Scenario: search_listings supports sort and limit
    When search_listings({sort: "priceAsc", limit: 3}) is called
    Then up to 3 results are returned ordered by priceEur ascending

  Scenario: get_listing returns the full record including filter values
    Given a listing exists with 4 filter values
    When get_listing(id) is called
    Then the returned object has the listing core fields and a filterValues array of length 4
