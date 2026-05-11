Feature: Sortable column tables for Listings and Analytics Best Buys
  As a buyer scanning candidate properties
  I want to sort tabular data by any column with a click
  And switch the Listings view between cards and a table
  So I can rapidly re-rank the same dataset without round-tripping the server

  Background:
    Given the Listings page and the Analytics Best Buys panel are loaded with mocked data

  # ── useSortableTable hook ─────────────────────────────────────
  Scenario: hook sorts by initial key descending when configured
    Given a list of rows with numeric "price" and string "title"
    When I initialize the hook with key "price" and dir "desc"
    Then sortedRows are ordered by price from highest to lowest

  Scenario: hook flips direction when same column is requested again
    Given the hook is sorted by "price" ascending
    When I requestSort("price")
    Then sortedRows are ordered by price from highest to lowest
    And sortDir is "desc"

  Scenario: hook switches column and defaults to ascending
    Given the hook is sorted by "price" desc
    When I requestSort("title")
    Then sortKey is "title" and sortDir is "asc"
    And sortedRows are ordered alphabetically A-Z by title

  Scenario: hook places nullish values at the end regardless of direction
    Given a row with priceEur = null and a row with priceEur = 100000
    When I sort by "priceEur" ascending
    Then the null row appears after the 100000 row
    When I sort by "priceEur" descending
    Then the null row still appears after the 100000 row

  Scenario: hook returns rows unchanged when no sort key is active
    Given the hook is created with initial sort null
    Then sortedRows equal the input rows in original order

  # ── Analytics: Best Buys column sorting ───────────────────────
  Scenario: best buys table renders a sort indicator on the active column header
    Given the Best Buys table is sorted by "score" desc
    Then the "Score" header shows a descending indicator
    And the other headers show a neutral indicator

  Scenario: clicking a header sorts the rows and updates the indicator
    Given the Best Buys table has rows with different €/m² values
    When I click the "€/m²" header
    Then the rows are sorted by €/m² ascending
    And the "€/m²" header shows an ascending indicator

  Scenario: clicking the active header again flips the direction
    Given the Best Buys table is sorted by "Price" ascending
    When I click the "Price" header
    Then the rows are sorted by Price descending
    And the "Price" header shows a descending indicator

  Scenario: segmented sort buttons and header clicks share the same state
    Given the Best Buys table is rendered with the "Score" segmented preset
    When I click the "€/m²" segmented button
    Then the "€/m²" column header shows an ascending indicator

  # ── Listings: view toggle ─────────────────────────────────────
  Scenario: Listings page exposes a Cards/Table view toggle
    When the Listings page renders
    Then I see a view toggle with options "Cards" and "Table"
    And "Cards" is selected by default

  Scenario: switching to Table view replaces the card grid with a sortable table
    Given the Listings page is in Cards view with at least one listing
    When I click the "Table" toggle
    Then the table is rendered with column headers: Title, District, Price, €/m², Area, Rooms, First seen
    And the listing rows are visible inside the table

  Scenario: clicking a Listings table column header sorts rows client-side
    Given the Listings page is in Table view with rows of varying prices
    When I click the "Price" column header
    Then the rows are sorted by Price ascending
    When I click the "Price" column header again
    Then the rows are sorted by Price descending

  Scenario: switching back to Cards view restores the card layout
    Given the Listings page is in Table view
    When I click the "Cards" toggle
    Then the card grid is visible again and the table is removed
