Feature: /api/listings envelope with sort/q/flags
  As an operator UI
  I want the /api/listings endpoint to return a structured envelope
  So that I can display total counts and apply advanced filters

  Scenario: Response returns envelope with listings and total count
    When I request GET /api/listings
    Then the response status is 200
    And the response is a JSON object with properties:
      | listings | Array of Listing objects |
      | total    | Integer count of filtered results |

  Scenario: Default sort is by newest (firstSeenAt desc)
    Given 3 listings created at different times
    When I request GET /api/listings?sort=newest
    Then listings are ordered by firstSeenAt descending

  Scenario: Sort by price (ascending)
    Given listings with prices 100000, 150000, 80000
    When I request GET /api/listings?sort=price
    Then listings are ordered by priceEur ascending

  Scenario: Sort by EUR per m² (ascending)
    Given listings with varying area and price
    When I request GET /api/listings?sort=eurm2
    Then listings are ordered by priceEur/areaSqm ascending (ignoring null area)

  Scenario: Filter by query string (title ILIKE)
    Given listings with titles "Apartment in Centru", "House in Buiucani", "Studio"
    When I request GET /api/listings?q=apartment
    Then results include only "Apartment in Centru" (case-insensitive match)

  Scenario: Price drop flag filters to ≥5% drops in 7 days
    Given listings with 7-day snapshots
      | listing | 7d_ago | current | drop% |
      | L1      | 100k   | 92k     | 8%    |
      | L2      | 100k   | 96k     | 4%    |
      | L3      | null   | 100k    | N/A   |
    When I request GET /api/listings?flags=priceDrop
    Then results include only L1 (drop >= 5%)

  Scenario: Total count reflects applied filters
    Given 100 listings, 30 in Centru, 15 with "apartment" in title, 8 matching price drop
    When I request GET /api/listings?q=apartment&district=Centru&flags=priceDrop
    Then total equals the count of results matching all three filters
    And listings array length equals total (respecting limit)

  Scenario: Combine multiple query parameters
    When I request GET /api/listings?sort=eurm2&q=apartment&district=Centru&flags=priceDrop&limit=25
    Then response envelope contains filtered, sorted results with accurate total
