Feature: Priority 1.6 — UI polish from finalization audit
  As an operator using the house-track operator UI
  I want the redesigned pages to render real data instead of stubs
  So that the dashboard, listings, and sweep-detail screens are honest

  Scenario: Dashboard success-rate KPI reflects recent sweep outcomes
    Given the database contains 3 finished SweepRuns with statuses [ok, ok, failed]
    And the stats.successRateWindow setting defaults to 100
    When I GET /api/stats/success-rate
    Then the response includes rate=0.6666… (2 of 3), ok=2, total=3, window=100

  Scenario: Dashboard avg-price KPI reflects active listings only
    Given the database contains 4 listings with priceEur [100000, 150000, 200000, 50000]
    And only the first 3 are active
    When I GET /api/stats/avg-price
    Then the response includes avgPrice=150000 and count=3

  Scenario: SweepDetail.currentlyFetching reflects the in-flight URL during a sweep
    Given a sweep is in_progress
    And fetchAndPersistDetails has just started fetching listing https://999.md/ro/123
    When I GET /api/sweeps/<active-id>
    Then the response includes currentlyFetching with url=https://999.md/ro/123 and a numeric startedAt

  Scenario: SweepDetail.currentlyFetching is null for finished sweeps
    Given a SweepRun with status=ok and finishedAt set
    When I GET /api/sweeps/<finished-id>
    Then the response includes currentlyFetching=null

  Scenario: setCurrentlyFetching is cleared after fetchAndPersistDetails completes
    Given a sweep ran and finished without errors
    When I call getCurrentlyFetching()
    Then the result is null

  Scenario: Listings page Refresh button invalidates the query cache
    Given the Listings page is rendered with 5 listings
    When I click "Refresh"
    Then the listings query refetches (invalidateQueries called with key 'listings')

  Scenario: Listings page no longer exposes Export CSV
    Given the Listings page is rendered
    Then the "Export CSV" button is absent from the header

  Scenario: sweeps.detail.ts has no stale stub comment header
    Given src/web/routes/sweeps.detail.ts
    Then lines 1-7 do not contain "STATUS: stub" or "TODO (Claude Code, Task 1)"
