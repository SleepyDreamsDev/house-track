Feature: Vite SPA scaffold + 4 pages
  As an operator
  I want a web UI to monitor crawler status, browse listings, review sweeps, and tune settings
  So that I can operate the crawler without SSH or manual config edits

  Scenario: Dashboard page renders with last sweep tile and circuit state
    Given the Hono API at /api/sweeps/latest returns a SweepRun
    When I navigate to the Dashboard page
    Then I see a "Last Sweep" tile showing startedAt, durationMs, status
    And I see a "Circuit State" tile showing open/closed status
    And I see an "Open in Grafana" button with href to localhost:3001

  Scenario: Dashboard page loads when API is unavailable
    Given the Hono API is unreachable
    When I navigate to the Dashboard page
    Then the page renders with an error state
    And the TanStack Query error is displayed gracefully

  Scenario: Listings page displays TanStack Table of properties
    Given the Hono API at /api/listings returns 50 properties
    When I navigate to the Listings page
    Then I see a table with columns: title, priceEur, areaSqm, rooms, district, firstSeenAt
    And pagination controls show page 1 of N

  Scenario: Listings page filters by price range
    Given the Listings page is loaded with 50 properties
    When I adjust the price filter slider to max 200000 EUR
    Then TanStack Query refetches /api/listings?maxPrice=200000
    And the table updates with filtered results

  Scenario: Listings page sorts by column
    Given the Listings page is loaded
    When I click the "Price" column header
    Then TanStack Query refetches /api/listings?sort=priceEur
    And the table re-renders in sort order

  Scenario: Listings table row click opens detail drawer
    Given the Listings page is loaded
    When I click on a property row
    Then a slide-over drawer opens on the right
    And I see full property details and image carousel

  Scenario: Sweeps page displays TanStack Table of recent runs
    Given the Hono API at /api/sweeps returns 20 SweepRun rows
    When I navigate to the Sweeps page
    Then I see a table with columns: startedAt, durationMs, status, pagesFetched, newListings, errorCount
    And "Reset circuit breaker" button is visible at the top

  Scenario: Sweeps page expands row to show errors
    Given the Sweeps page is loaded
    When I click the expand arrow on a SweepRun row with errors > 0
    Then an error detail section appears below the row
    And JSON errors are displayed (collapsed by default)

  Scenario: Reset circuit breaker confirms and deletes sentinel
    Given the Sweeps page is loaded
    And the circuit is currently open
    When I click "Reset circuit breaker"
    Then a confirmation dialog appears
    And after confirming, DELETE /api/circuit is called
    And the circuit state updates to closed

  Scenario: Settings page displays three card sections
    Given the Hono API at /api/settings returns setting keys
    When I navigate to the Settings page
    Then I see "Crawler Tuning" card with form fields
    And I see "Sources" card with the 999md source
    And I see "Global Filter" card

  Scenario: Settings page saves tuning via PATCH /api/settings/:key
    Given the Settings page is loaded
    When I change politeness.baseDelayMs to 12000 and click Save
    Then TanStack Query calls PATCH /api/settings/politeness.baseDelayMs
    And the form shows optimistic update
    And success toast is displayed on response

  Scenario: Settings page validates input against zod schemas
    Given the Settings page is loaded
    When I enter an invalid value (e.g., negative number where positive expected)
    Then the input shows validation error
    And the Save button is disabled

  Scenario: AppShell navigation links all four pages
    Given I am on any page
    When I look at the left sidebar
    Then I see links to Dashboard, Listings, Sweeps, and Settings
    And the current page link is highlighted
