Feature: Persistence
  In order to keep an honest, queryable history of every listing we observe
  As the crawler
  I want listings upserted, snapshots created only on real change, and
  the sweep bookkeeping to round-trip cleanly

  Background:
    Given a fresh SQLite database with the Prisma schema applied

  Scenario: Diffing returns ids that are new vs already known
    Given listings with ids "A" and "B" already exist
    And the current sweep produced stubs for "B" and "C"
    When diffAgainstDb(stubs) is called
    Then result.new contains only the stub for "C"
    And result.seen contains only the stub for "B"

  Scenario: markSeen bumps lastSeenAt on every passed stub
    Given a listing "X" with lastSeenAt 2 days ago
    When markSeen([stub for "X"]) is called
    Then "X".lastSeenAt is within the last second
    And "X".active is true

  Scenario: markInactiveOlderThan flips listings whose lastSeenAt is older than the cutoff
    Given an active listing "OLD" with lastSeenAt 4 hours ago
    And an active listing "FRESH" with lastSeenAt 30 minutes ago
    When markInactiveOlderThan(3 hours) is called
    Then "OLD".active is false
    And "FRESH".active is true
    And the returned count is 1

  Scenario: persistDetail creates a new Listing on first sight
    Given listing "NEW" does not exist
    When persistDetail(parsed for "NEW") is called
    Then "NEW" exists with all parsed fields populated
    And exactly one snapshot exists for "NEW"

  Scenario: persistDetail updates an existing Listing on re-fetch
    Given listing "OLD" exists with title "Old title" and priceEur 100000
    When persistDetail(parsed with title "New title" and priceEur 95000) is called
    Then "OLD".title is "New title"
    And "OLD".priceEur is 95000
    And "OLD".lastFetchedAt is recent

  Scenario: persistDetail inserts a snapshot only when rawHtmlHash changed
    Given listing "X" exists with one snapshot at rawHtmlHash "abc"
    When persistDetail(parsed with rawHtmlHash "abc") is called
    Then there is still exactly one snapshot for "X"

  Scenario: persistDetail inserts a new snapshot when rawHtmlHash changed
    Given listing "X" exists with one snapshot at rawHtmlHash "abc"
    When persistDetail(parsed with rawHtmlHash "xyz") is called
    Then there are exactly two snapshots for "X"
    And the latest snapshot has rawHtmlHash "xyz"

  Scenario: persistDetail re-activates a previously inactive listing
    Given listing "REVIVED" exists with active=false
    When persistDetail(parsed for "REVIVED") is called
    Then "REVIVED".active is true

  Scenario: startSweep + finishSweep round-trip
    When startSweep() returns id N
    And finishSweep(N, ok, 5 pages, 7 details, 3 new, 2 updated, no errors) is called
    Then SweepRun N has status="ok", finishedAt set, all counters matching, errors null

  Scenario: finishSweep serializes errors as JSON when present
    When startSweep() + finishSweep with one {url, status:500, msg:"boom"} error
    Then SweepRun.errors is the JSON string "[{\"url\":...,\"status\":500,\"msg\":\"boom\"}]"
