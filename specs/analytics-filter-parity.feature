Feature: Analytics filter parity with Listings (dynamic, data-driven)
  As an operator using both Listings and Analytics
  I want the Analytics filter rail to expose at least the same filters as Listings, sourced from observed data
  So that I can reproduce a Listings filter view in Analytics and trust that filter options reflect the actual catalog

  Background:
    Given the Analytics page is open

  Scenario: Filter rail offers Listings' filters plus analytics-specific ones
    Then the rail shows Search, Max price, District, Property type, and Rooms
    And on the Price drops tab a Period selector is also present

  Scenario: Filter options come from observed data, not hardcoded constants
    Given the active catalog has districts ["Centru", "Botanica"]
      And titles that derive types ["House", "Villa"]
      And rooms values [3, 4]
    When the rail mounts
    Then District options are exactly ["Centru", "Botanica"]
      And Property type options are exactly ["House", "Villa"]
      And Rooms options are exactly the buckets covering [3, 4]

  Scenario: /api/listings/facets exposes types and roomsValues
    Given active listings exist with mixed titles and rooms counts
    When the client requests /api/listings/facets
    Then the response includes "types" as a string array of derived types
      And "roomsValues" as an ascending integer array of distinct rooms counts

  Scenario: Search narrows Overview KPIs and tables
    Given listings include "Casa Centru" priced 200k and "Vila Botanica" priced 150k
    When I type "Centru" in Search
    Then /analytics/overview is called with q=Centru
      And the activeInventory KPI counts only matching listings

  Scenario: Max price filter applies to all three analytics endpoints
    Given listings range from 50k to 500k
    When I drag Max price to 200k
    Then /analytics/overview, /analytics/best-buys, and /analytics/price-drops are called with maxPrice=200000

  Scenario: Max price omits param when slider is at facets max
    Given facets.price.max is 500000
      And the user has not moved the slider
    When the analytics endpoints are called
    Then maxPrice is not present in the query string

  Scenario: Type filter narrows best-buys and price-drops by derived type
    Given listings include a "Vilă" titled house and a plain "Casă" titled house
    When type=Villa is selected
    Then /analytics/best-buys returns only the Vilă-titled row
      And /analytics/price-drops returns only the Vilă-titled row (when it has a qualifying drop)

  Scenario: Rooms filter is wired through to all analytics endpoints
    Given listings include rooms counts [3, 4]
    When rooms=3 is selected
    Then /analytics/best-buys is called with rooms=3
      And every returned best-buy row has rooms=3

  Scenario: District query parameter is named "district" everywhere
    When the UI requests /analytics/best-buys?district=Centru
    Then the response is filtered to district=Centru
      And the UI never sends ?region= for district filtering

  Scenario: Best Buys discount is computed within the filtered slice
    Given the active set has Centru priced near district median
      And maxPrice=150000 excludes the higher-priced Centru rows
    When best-buys is called with maxPrice=150000
    Then the district median used for discount is computed from the filtered slice only

  Scenario: Empty catalog renders the rail with safe fallbacks
    Given the database has zero active listings
    When the Analytics page mounts
    Then the rail still renders without throwing
      And District/Property type/Rooms show empty option lists
      And the Max price slider uses a sensible fallback range

  Scenario: A single shared rail component serves all three tabs
    When inspecting the rendered DOM
    Then the same AnalyticsFilterRail component appears on Overview, Best buys, and Price drops
      And the Period selector slot is filled only on the Price drops tab
