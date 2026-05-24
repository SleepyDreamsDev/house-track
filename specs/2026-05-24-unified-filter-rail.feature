Feature: Unified browse-filter rail across Listings and Analytics

  As an operator who browses the catalog on both the Listings and Analytics pages
  I want one consistent set of filter controls on both views
  So that I am not surprised by filters that exist on one page but not the other,
  and so that filters with no backing data are hidden instead of dead-ending.

  Background:
    Given the catalog has been crawled and contains active listings
    And both pages source their filter options from GET /api/listings/facets

  # ── Backend: facets endpoint reports counts for the boolean toggles ──

  Scenario: Facets reports favoritesCount over active non-excluded watchlisted listings
    Given 3 active non-excluded listings are on the watchlist
    And 2 active non-excluded listings are not on the watchlist
    When I GET /api/listings/facets
    Then the response field favoritesCount equals 3

  Scenario: Facets reports excludedCount over active excluded listings
    Given 4 active listings are marked excluded
    And 10 active listings are not excluded
    When I GET /api/listings/facets
    Then the response field excludedCount equals 4

  Scenario: Facets reports mislabeledCount via classifyListing over active non-excluded listings
    Given 2 active non-excluded listings classify as type- or region-mismatched
    And the remaining active non-excluded listings classify as clean
    When I GET /api/listings/facets
    Then the response field mislabeledCount equals 2

  Scenario: Existing facet fields remain unchanged
    When I GET /api/listings/facets
    Then the response still includes total, districts, price, rooms, areaSqm, types, roomsValues
    And sectors is still present only when at least one sector exists

  # ── Backend: analytics honors the cheap toggles (favorite + includeExcluded) ──

  Scenario: Analytics excludes excluded listings by default
    Given 1 active excluded listing and 5 active non-excluded listings match the slice
    When I GET /api/analytics/overview with no includeExcluded param
    Then activeInventory counts only the 5 non-excluded listings

  Scenario: Analytics includes excluded listings when includeExcluded=true
    Given 1 active excluded listing and 5 active non-excluded listings match the slice
    When I GET /api/analytics/overview?includeExcluded=true
    Then activeInventory counts all 6 listings

  Scenario: Analytics restricts to watchlisted listings when favorite=true
    Given 2 active watchlisted listings and 5 active non-watchlisted listings match the slice
    When I GET /api/analytics/overview?favorite=true
    Then activeInventory counts only the 2 watchlisted listings

  Scenario: best-buys and price-drops honor favorite and includeExcluded identically
    Given the same filter params are sent to overview, best-buys, and price-drops
    When favorite=true or includeExcluded=true is applied
    Then all three endpoints resolve the same active-listing universe before ranking

  Scenario: A present-but-empty district param is still rejected on analytics
    When I GET /api/analytics/overview?district= with the new params present
    Then the response status is 400

  # ── Frontend: one shared FilterRail used by both pages ──

  Scenario: Listings and Analytics render the same FilterRail component
    Given the Listings page and the Analytics page are mounted with identical facets
    Then both render a single shared FilterRail
    And the rendered filter groups are identical except for Listings-only toggles

  Scenario: Filter selections are per-page and reset on navigation
    Given I narrow the District filter on Listings
    When I navigate to Analytics and back to Listings
    Then each page started from its own default filter state

  # ── Frontend: facet-gated visibility ("hide filters with no data") ──

  Scenario Outline: A filter group is hidden when its facet has no data
    Given facets where <facet_condition>
    When the FilterRail renders
    Then the <group> group is not shown

    Examples:
      | group         | facet_condition                          |
      | Max price     | price.max equals price.min               |
      | District      | districts is empty                       |
      | Sector        | sectors is absent or empty               |
      | Property type | types has one or zero entries            |
      | Rooms         | no rooms buckets are backed by data      |
      | Favorites     | favoritesCount equals 0                  |
      | Show excluded | excludedCount equals 0                   |
      | Hide mislabeled | mislabeledCount equals 0               |

  Scenario: Search is always shown regardless of facets
    Given facets with every other group empty
    When the FilterRail renders
    Then the Search input is still shown

  Scenario: A filter group is shown when its facet has data
    Given facets where favoritesCount is 5 and excludedCount is 2
    When the FilterRail renders on Listings
    Then the Favorites only toggle is shown
    And the Show excluded toggle is shown

  # ── Frontend: Hide mislabeled is Listings-only ──

  Scenario: Hide mislabeled appears on Listings when mislabeled data exists
    Given facets where mislabeledCount is greater than 0
    When the FilterRail renders on Listings
    Then the Hide mislabeled toggle is shown

  Scenario: Hide mislabeled never appears on Analytics
    Given facets where mislabeledCount is greater than 0
    When the FilterRail renders on Analytics
    Then the Hide mislabeled toggle is not shown

  # ── Frontend: shared maxPrice/facet clamp logic via useBrowseFilters ──

  Scenario: maxPrice tracks the catalog max until the user moves the slider
    Given facets report a price max of 300000 and the slider is untouched
    When facets later report a price max of 180000
    Then the slider value follows down to 180000

  Scenario: maxPrice is locked to the user's choice once moved
    Given the user has dragged the slider to 120000
    When facets later report a different price max
    Then the slider stays at 120000

  Scenario: maxPrice is omitted from the query when at the catalog max
    Given the slider is at the catalog price max
    When the page builds its query params
    Then no maxPrice param is sent
