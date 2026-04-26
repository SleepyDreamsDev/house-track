Feature: Sweep orchestration
  In order to keep the database honest without melting under transient errors
  As the crawler
  I want one sweep tick to: pre-flight the circuit, paginate the index, diff
  against the DB, fetch+parse+persist details for new ids, age out stale
  listings, and ALWAYS close the SweepRun row with the truthful status

  Background:
    Given mock fetcher, persistence, circuit, and parser deps
    And a buildIndexUrl that maps page N to "https://test/index?page=N"

  Scenario: Pre-flight short-circuits when the breaker is already open
    Given circuit.isOpen() returns true
    When runSweep() runs
    Then the fetcher is never called
    And exactly one SweepRun is opened and closed with status="circuit_open"

  Scenario: Happy path: 1 page with 2 stubs, both new and persisted
    Given the index page has 2 stubs A and B (both new in the DB)
    And both detail pages return 200 OK
    When runSweep() runs
    Then persistDetail was called for A and B
    And finishSweep was called with status="ok", newListings=2

  Scenario: Empty index page stops pagination
    Given page 1 yields 0 stubs
    When runSweep() runs
    Then the fetcher was called exactly once

  Scenario: A CircuitTrippingError mid-sweep aborts and marks status circuit_open
    Given page 1 yields stubs A
    And fetching detail A throws CircuitTrippingError(429)
    When runSweep() runs
    Then finishSweep was called with status="circuit_open"

  Scenario: parseDetail throwing on one listing does not kill the sweep
    Given page 1 yields stubs A and B (both new)
    And parseDetail throws on A and succeeds on B
    When runSweep() runs
    Then persistDetail was called for B only
    And the SweepRun has status="partial" with one error referencing A

  Scenario: 404 on a detail is not a failure (listing was delisted between index and detail)
    Given page 1 yields stub A
    And the detail page returns 404
    When runSweep() runs
    Then persistDetail was NOT called
    And the SweepRun has status="ok" and zero errors

  Scenario: Seen ids get markSeen and stale ids get aged out
    Given page 1 yields stubs A (already in DB) and B (new, 200 OK)
    When runSweep() runs
    Then markSeen was called with [A]
    And markInactiveOlderThan was called with the configured threshold
