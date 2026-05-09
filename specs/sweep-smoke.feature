Feature: Operator UI smoke test
  As an operator
  I want a one-click smoke test in the Sweeps page
  So that I can verify the crawler still works against live 999.md
  without running a full multi-minute sweep

  Background:
    Given the crawler is configured normally
    And the operator UI is running

  Scenario: Smoke route refuses with 409 when circuit breaker is open
    Given the circuit breaker sentinel file exists
    When the operator POSTs to /api/sweeps/smoke
    Then the response status is 409
    And the response body has error="circuit_open"
    And no SweepRun row is created

  Scenario: Smoke route creates a SweepRun tagged trigger=smoke
    Given the circuit breaker is closed
    When the operator POSTs to /api/sweeps/smoke
    Then a SweepRun row is created with source="999.md" and trigger="smoke"

  Scenario: GET /api/sweeps surfaces the trigger field
    Given a SweepRun exists with trigger="smoke"
    When the operator GETs /api/sweeps
    Then the response includes trigger="smoke" for that run

  Scenario: runSmokeAssertions reports all-pass for a healthy sweep
    Given a SweepRun finished with status="ok" and no rate-limit errors
    And at least 1 listing was touched after the sweep started
    And at least 1 ListingFilterValue was created after the sweep started
    And at least 1 listing has filterValuesEnrichedAt set after the sweep started
    When runSmokeAssertions runs with minListingsTouched=1
    Then all 5 assertions pass

  Scenario: runSmokeAssertions flags a sweep that finished with status=failed
    Given a SweepRun finished with status="failed"
    When runSmokeAssertions runs
    Then the "sweep status=ok" assertion fails with detail "actual: failed"

  Scenario: runSmokeAssertions counts 403 errors as rate-limit failures
    Given a SweepRun whose errors array contains a 403 entry
    When runSmokeAssertions runs
    Then the "no 403/429 in errors" assertion fails

  Scenario: runSmokeAssertions threshold is configurable
    Given a SweepRun touched exactly 5 listings
    When runSmokeAssertions runs with minListingsTouched=30
    Then the "≥30 listings touched" assertion fails with detail "actual: 5"
    But when runSmokeAssertions runs with minListingsTouched=1
    Then the "≥1 listings touched" assertion passes
