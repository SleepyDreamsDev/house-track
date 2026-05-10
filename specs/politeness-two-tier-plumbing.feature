Feature: Politeness two-tier plumbing
  As the crawler operator
  I want the schema and settings to support a two-tier cadence (index ticker + detail trickle) with adaptive throttle
  So that a follow-up PR can flip from the legacy twice-daily sweep without further migrations

  Background:
    Given a fresh test database with all migrations applied
    And the settings table is empty

  # FetchTask queue
  Scenario: FetchTask queue accepts a NEW-priority task
    Given a Listing with id "L1"
    When I insert a FetchTask for L1 with priority 0 and reason "new"
    Then a single FetchTask row exists for L1 with priority 0
    And the row's enqueuedAt and scheduledFor default to now
    And attemptCount defaults to 0

  Scenario: FetchTask is deduplicated by listingId + reason
    Given a Listing with id "L1"
    And a FetchTask row exists for (L1, "new")
    When I insert another FetchTask for (L1, "new")
    Then the second insert fails with a unique-constraint error
    And only one FetchTask row exists for L1

  Scenario: FetchTask popping order respects priority then scheduledFor
    Given Listings L1, L2, L3
    And FetchTask rows: (L1, BACKFILL=3, scheduled now), (L2, NEW=0, scheduled now+1s), (L3, STALE=2, scheduled now)
    When I query the next eligible task ordered by priority then scheduledFor
    Then the first row returned is L2 (NEW)
    And the second row returned is L3 (STALE)

  Scenario: FetchTask with future scheduledFor is not yet eligible
    Given a Listing with id "L1"
    And a FetchTask row for L1 with scheduledFor in the future
    When I query for tasks with scheduledFor <= now
    Then no rows are returned

  # ThrottleEvent
  Scenario: ThrottleEvent records a soft-throttle trigger
    When I insert a ThrottleEvent with trigger "5xx_rate" and durationMs 1800000
    Then a ThrottleEvent row exists with triggeredAt default-set to now
    And the row's trigger is "5xx_rate" and durationMs is 1800000

  # SweepRun.kind
  Scenario: New SweepRun rows default kind to "legacy"
    When I insert a SweepRun row without specifying kind
    Then the row's kind value is "legacy"

  Scenario: SweepRun.kind accepts "index" and "detail" labels
    When I insert a SweepRun with kind "index" and another with kind "detail"
    Then both rows are stored with the supplied kind values

  # New settings keys — schema validation
  Scenario: sweep.mode validates against the legacy/two_tier enum
    When I call setSetting("sweep.mode", "two_tier")
    Then getSetting("sweep.mode") returns "two_tier"
    And setSetting("sweep.mode", "bogus") rejects with a validation error

  Scenario: sweep.mode defaults to "legacy" when unset
    When I call getSetting("sweep.mode") without seeding the row
    Then the returned value is "legacy"

  Scenario: New index-ticker settings validate as positive integers
    When I write each of these keys to a positive integer:
      | key                                          | value |
      | sweep.indexTickIntervalMinutesMin            | 60    |
      | sweep.indexTickIntervalMinutesMax            | 120   |
      | sweep.indexTickTargetListings                | 100   |
    Then each write succeeds and getSetting returns the written value
    And writing a negative integer to any of these keys fails validation

  Scenario: New detail-trickle settings validate as positive integers
    When I write each of these keys to a positive integer:
      | key                                            | value |
      | sweep.detailTrickleIntervalSecondsMin          | 180   |
      | sweep.detailTrickleIntervalSecondsMax          | 360   |
      | sweep.detailTrickleQueueRefillThreshold        | 40    |
      | sweep.staleThresholdHours                      | 168   |
      | sweep.watchlistRefreshHours                    | 6     |
    Then each write succeeds and getSetting returns the written value

  Scenario: New soft-throttle politeness keys validate as positive integers
    When I write politeness.softThrottleMultiplier to 3
    And I write politeness.softThrottleDurationMinutes to 30
    Then getSetting returns 3 and 30 respectively
    And writing politeness.softThrottleMultiplier to 0 fails validation

  Scenario: listSettings exposes the new keys with grouping metadata
    When I call listSettings()
    Then the response includes "sweep.mode" in the Sweep group
    And it includes "sweep.indexTickTargetListings" in the Sweep group with unit "listings"
    And it includes "politeness.softThrottleMultiplier" in the Politeness group
    And every new key carries a non-empty label

  # No behavior change
  Scenario: Existing sweep.cronSchedule default is unchanged
    When I call getSetting("sweep.cronSchedule")
    Then the returned value is "0 9,21 * * *"

  Scenario: Existing politeness defaults are unchanged
    When I call getSetting for each existing politeness key
    Then politeness.baseDelayMs is 8000
    And politeness.jitterMs is 2000
    And politeness.detailDelayMs is 10000
