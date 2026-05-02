Feature: Hono API web service for operator UI
  As an operator
  I want to query crawl data, sweeps, listings, and settings via HTTP
  So that the web UI can display real-time crawler status and allow runtime tuning

  Scenario: Hono server starts on localhost:3000
    When the server initializes
    Then it listens on 127.0.0.1:3000
    And health check responds with 200

  Scenario: GET /api/sweeps returns paginated sweep runs
    Given there are 25 SweepRun records in the database
    When I request GET /api/sweeps?limit=10
    Then I receive a JSON array of 10 SweepRun objects
    And each object has startedAt, durationMs, status, pagesFetched, detailsFetched, newListings, updatedListings, errorCount

  Scenario: GET /api/sweeps/latest returns most recent sweep
    Given there are 3 SweepRun records
    When I request GET /api/sweeps/latest
    Then I receive the sweep with the latest startedAt timestamp

  Scenario: GET /api/sweeps/:id/errors returns parsed error JSON
    Given a SweepRun with id "sweep-123" has errors JSON: [{"page": 1, "message": "timeout"}]
    When I request GET /api/sweeps/sweep-123/errors
    Then I receive the parsed errors array

  Scenario: GET /api/listings delegates to searchListings query
    Given the database has 5 listings
    When I request GET /api/listings?priceMax=300000
    Then I receive filtered listings from the query helper
    And response includes title, priceEur, areaSqm, firstSeenAt

  Scenario: GET /api/listings/:id delegates to getListing query
    Given a listing with id "lst-456" exists
    When I request GET /api/listings/lst-456
    Then I receive full listing detail including images, description, filters

  Scenario: GET /api/filters returns available filter options
    When I request GET /api/filters
    Then I receive an object with district, features, options arrays

  Scenario: GET /api/settings returns current settings with defaults
    When I request GET /api/settings
    Then I receive an array of {key, value, default, schema} objects
    And includes keys like politeness.baseDelayMs, sweep.maxPagesPerSweep, etc.

  Scenario: PATCH /api/settings/:key validates and writes settings
    Given the setting politeness.baseDelayMs has default 8000
    When I PATCH /api/settings/politeness.baseDelayMs with value 12000
    Then the setting is persisted to the database
    And GET /api/settings returns the new value
    And invalid values (e.g., negative number) return 400

  Scenario: GET /api/sources returns source configurations
    When I request GET /api/sources
    Then I receive an array of Source objects with id, slug, baseUrl, enabled, adapterKey

  Scenario: PATCH /api/sources/:id updates source configuration
    Given a source with id "src-789" exists
    When I PATCH /api/sources/src-789 with enabled=false
    Then the source is updated in the database
    And GET /api/sources reflects the change

  Scenario: GET /api/circuit returns circuit breaker status
    When I request GET /api/circuit
    Then I receive {open: boolean, openedAt?: string, sentinelPath: string}
    And when sentinel file exists, open is true

  Scenario: DELETE /api/circuit clears the circuit breaker sentinel
    Given the sentinel file data/.circuit_open exists
    When I DELETE /api/circuit
    Then the file is deleted
    And subsequent GET /api/circuit returns open=false

  Scenario: Server integrates with Postgres via Prisma singleton
    When multiple route handlers execute concurrently
    Then they share a single PrismaClient connection pool
    And all database queries succeed without connection exhaustion
