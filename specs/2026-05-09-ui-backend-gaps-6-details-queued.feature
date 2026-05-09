Feature: SweepDetail surfaces live detailsQueued count

  As an operator watching a running sweep
  I want the "Queued" KStat to show real queue depth
  So that I can see how much detail-fetch work remains

  Scenario: Queue depth increments when details are enqueued
    Given a sweep is running
    And the crawler enqueues 5 detail-fetch tasks
    When I GET /api/sweeps/:id while the sweep is the active one
    Then progress.detailsQueued = 5

  Scenario: Queue depth decrements as fetches complete
    Given a sweep is running with 5 queued details
    And the crawler completes 3 of them
    When I GET /api/sweeps/:id
    Then progress.detailsQueued = 2

  Scenario: Queue depth is 0 for a non-active sweep
    Given a sweep finished previously (status not in_progress, or active sweep id differs)
    When I GET /api/sweeps/:id
    Then progress.detailsQueued = 0

  Scenario: getQueueDepth is exposed from src/sweep.ts
    Then a top-level export getQueueDepth() exists in src/sweep.ts
    And it returns the current in-memory detail-fetch queue depth as a number
