# Task 3 — Real Prisma queries for dashboard stats and listing feeds

Feature: Real Prisma queries for stats and listing feeds
  As an operator
  I want the dashboard stats and listing feeds to display real data from the database
  So that the UI shows accurate information about listings and crawl trends

  Scenario: /api/stats/by-district returns active listings grouped by district
    Given active listings exist in multiple districts:
      | district | count | avgPriceEur | avgEurPerSqm |
      | Buiucani | 89    | 118000      | 1320         |
      | Botanica | 64    | 98000       | 1180         |
      | Centru   | 42    | 155000      | 1850         |
    When I call GET /api/stats/by-district
    Then the response is a JSON array sorted by count descending
    And each row has fields: name, count, eurPerSqm
    And deleted listings are excluded

  Scenario: /api/stats/new-per-day returns last 7 days of new listing counts
    Given listings were created with firstSeenAt over the last 7 days:
      | daysAgo | count |
      | 6       | 8     |
      | 5       | 12    |
      | 4       | 5     |
      | 3       | 9     |
      | 2       | 14    |
      | 1       | 7     |
      | 0       | 11    |
    When I call GET /api/stats/new-per-day
    Then the response is a JSON array of 7 numbers
    And the array is ordered oldest first (6 days ago) to today
    And missing days are padded with 0

  Scenario: /api/listings/new-today returns listings created in last 24h
    Given listings were created with firstSeenAt:
      | id      | firstSeenAt | active |
      | h-91445 | 12 mins ago | true   |
      | h-91442 | 47 mins ago | true   |
      | h-90000 | 25h ago     | true   |
    When I call GET /api/listings/new-today
    Then the response is a JSON array
    And it includes h-91445 and h-91442 (created in last 24h)
    And it excludes h-90000 (created >24h ago)
    And each listing has fields: id, title, priceEur, areaSqm, district, firstSeenAt, isNew
    And listing is sorted by firstSeenAt descending
    And response is limited to 10 listings
    And inactive listings are excluded

  Scenario: /api/listings/price-drops returns listings with ≥5% price drop over 7 days
    Given listings with historical snapshots:
      | id      | priceWas | priceNow | dropPct | inLast7d |
      | h-91204 | 148000   | 132000   | 10.8%   | true     |
      | h-91205 | 120000   | 118000   | 1.7%    | true     |
      | h-91206 | 100000   | 95000    | 5.0%    | true     |
    When I call GET /api/listings/price-drops
    Then the response is a JSON array
    And it includes h-91204 (>5% drop) and h-91206 (=5% drop)
    And it excludes h-91205 (<5% drop)
    And each listing has fields: id, title, priceEur, priceWas, areaSqm, district, priceDrop
    And priceWas is the earliest snapshot price in the 7d window
    And priceEur is the latest snapshot price
    And only inactive=true listings are checked
