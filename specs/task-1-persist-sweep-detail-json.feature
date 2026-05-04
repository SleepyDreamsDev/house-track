Feature: Persist sweep detail JSON columns
  As an operator
  I want sweep runs to persist pages and details metadata
  So the UI can display rich detail views for completed sweeps

  Scenario: Capture pages detail during sweep
    Given a sweep is running
    When index pages are fetched and parsed
    Then pagesDetail is populated with {n, url, status, bytes, parseMs, found, took}

  Scenario: Capture details detail during sweep
    Given a sweep is running with new listings
    When detail pages are fetched and parsed
    Then detailsDetail is populated with {id, url, status, bytes, parseMs, action, priceEur}

  Scenario: Capture config snapshot at sweep start
    Given a sweep is started
    When settings are resolved via listSettings()
    Then configSnapshot is persisted in finishSweep

  Scenario: All JSON fields are nullable in schema
    Given a sweep fails early
    When finishSweep is called with empty arrays
    Then configSnapshot, pagesDetail, detailsDetail, eventLog are all nullable

  Scenario: sweeps detail route returns parsed JSON
    Given a completed sweep with populated JSON columns
    When GET /api/sweeps/:id is called
    Then the response includes parsed config, pages, details, errors

  Scenario: sweeps detail route parses id parameter as integer
    Given a SweepRun with numeric id
    When the route receives :id as a string
    Then it coerces via parseInt before querying
