Feature: Favorites and sweep exclusion
  As the single operator of house-track
  I want to mark listings as favorite and exclude uninteresting listings from future sweeps
  So that I save the politeness budget and keep my view focused on what matters

  # "Favorite" reuses the existing Listing.watchlist flag (relabeled in the UI).
  # "Excluded" is a new Listing.excluded flag: a full freeze — skipped by every
  # sweep path and hidden from the default Listings view, but the row is kept.

  Scenario: Exclude a listing via the API
    Given a listing "A" that is not excluded
    When I PUT /api/listings/A/excluded with { excluded: true }
    Then the response is 200 with { id: "A", excluded: true }
    And listing "A" has excluded = true in the database

  Scenario: Reject an exclude request with a non-boolean body
    When I PUT /api/listings/A/excluded with { excluded: "yes" }
    Then the response is 400

  Scenario: Return 404 when excluding a listing that does not exist
    When I PUT /api/listings/NOPE/excluded with { excluded: true }
    Then the response is 404

  Scenario: Excluded listings are skipped by the index-sweep diff
    Given a known listing "X" that is excluded
    And a known listing "Y" that is not excluded
    When I diff stubs for "X" and "Y" against the database
    Then "Y" is returned as seen
    And "X" is not returned as seen

  Scenario: Excluded listings are skipped by the stale-refresh picker
    Given an active excluded listing "X" whose lastFetchedAt is old
    And an active non-excluded listing "Y" whose lastFetchedAt is old
    When I pick stale listings to refresh
    Then "Y" is returned
    And "X" is not returned

  Scenario: Excluded listings are skipped by the backfill picker
    Given an active excluded listing "X" with no filter values enriched
    And an active non-excluded listing "Y" with no filter values enriched
    When I find unenriched listings
    Then "Y" is returned
    And "X" is not returned

  Scenario: Excluded listings are hidden from the default Listings search
    Given an excluded listing "X" and a normal listing "Y"
    When I GET /api/listings
    Then the response contains "Y" but not "X"

  Scenario: includeExcluded reveals excluded listings
    Given an excluded listing "X" and a normal listing "Y"
    When I GET /api/listings?includeExcluded=true
    Then the response contains both "X" and "Y"

  Scenario: favorite=true filters to favorited listings only
    Given a favorited listing "F" and a non-favorited listing "N"
    When I GET /api/listings?favorite=true
    Then the response contains "F" but not "N"

  Scenario: Un-excluding a listing restores it to the default view
    Given an excluded listing "X"
    When I PUT /api/listings/X/excluded with { excluded: false }
    And I GET /api/listings
    Then the response contains "X"

  Scenario: The listings table shows favorite and exclude toggles per row
    Given the Listings page rendered with one listing "A"
    Then the row for "A" shows a favorite toggle and an exclude toggle

  Scenario: Toggling favorite from the table calls the watchlist endpoint and refetches
    Given the Listings page rendered with one non-favorited listing "A"
    When I click the favorite toggle on row "A"
    Then a PUT to /api/listings/A/watchlist with { watchlist: true } is sent
    And the listings query is refetched

  Scenario: Toggling exclude from the table calls the excluded endpoint and refetches
    Given the Listings page rendered with one listing "A"
    When I click the exclude toggle on row "A"
    Then a PUT to /api/listings/A/excluded with { excluded: true } is sent
    And the listings query is refetched
