Feature: Sweep API gaps
  Scenario: POST /api/sweeps triggers a manual sweep
    Given the circuit is closed
    When POST /api/sweeps is called with no body
    Then response status is 201
    And response contains { id, startedAt } with valid timestamps
    And a new SweepRun row is created in the database
    And runSweep is invoked non-blocking (returns immediately)

  Scenario: POST /api/sweeps/:id/cancel aborts an active sweep
    Given a sweep is running with an active AbortController
    When POST /api/sweeps/:id/cancel is called
    Then response status is 200
    And the AbortController.signal fires (sweep sees abort)
    And the Fetcher stops making new requests
    And in-flight HTTP connections are dropped without leaks

  Scenario: SweepRun schema includes source and trigger columns
    Given a SweepRun exists
    When the schema is queried
    Then SweepRun.source exists (String, default '999.md')
    And SweepRun.trigger exists (String, default 'cron')

  Scenario: GET /api/sweeps includes durationMs in list response
    Given finished sweeps exist with startedAt and finishedAt set
    When GET /api/sweeps is called
    Then each sweep in response contains durationMs
    And durationMs = finishedAt - startedAt (milliseconds)
    And for running sweeps (finishedAt is null), durationMs is null

  Scenario: GET /api/sweeps/:id returns structured progress shape
    Given a sweep has completed with populated pagesDetail and detailsDetail
    When GET /api/sweeps/:id is called
    Then response.progress contains { phase, pagesDone, pagesTotal, queued }
    And response.currentlyFetching is null for finished sweeps
    And progress.phase matches the sweep's status

  Scenario: GET /api/sweeps/:id for running sweep returns active fetching URL
    Given a sweep is currently running
    When GET /api/sweeps/:id is called
    Then response.currentlyFetching contains the active URL (or null if idle)
    And response.progress.phase is 'fetching' or 'parsing'
