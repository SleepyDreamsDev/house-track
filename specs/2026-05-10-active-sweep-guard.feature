Feature: Single-active-sweep invariant
  Only one sweep can be in_progress at a time. Manual full sweeps,
  manual smoke sweeps, and the cron tick must all refuse to start a
  new sweep while another is in_progress. The only way to start a
  fresh sweep while one is in_progress is to cancel the running one.

  Background:
    Given the SweepRun table is empty

  Scenario: Manual sweep is rejected when another sweep is in_progress
    Given a SweepRun row with status "in_progress" exists
    When the operator POSTs to /api/sweeps
    Then the response is 409
    And the body contains error "sweep_in_progress"
    And the body contains the active sweep id
    And no new SweepRun row is created

  Scenario: Manual smoke is rejected when another sweep is in_progress
    Given a SweepRun row with status "in_progress" exists
    When the operator POSTs to /api/sweeps/smoke
    Then the response is 409
    And the body contains error "sweep_in_progress"
    And no new SweepRun row is created

  Scenario: Manual sweep is allowed after the in_progress sweep is cancelled
    Given a SweepRun row with status "in_progress" exists
    When the operator POSTs to /api/sweeps/:id/cancel for that row
    And the operator POSTs to /api/sweeps
    Then the response is 201
    And a new SweepRun row is created
