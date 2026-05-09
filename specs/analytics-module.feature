Feature: Analytics module
  In order to spot best buys, price drops, and market trends across districts
  As an operator using house-track
  I want a dedicated /analytics page with three tabs and three Hono endpoints
  backed by Listing + ListingSnapshot data

  Background:
    Given the SPA router is mounted with QueryClient and the API base URL is configured

  # ─── Sidebar nav ────────────────────────────────────────────────────────────
  Scenario: Sidebar exposes the Analytics nav item
    Given the AppShell renders its left navigation
    Then it lists "Dashboard", "Listings", "Sweeps", "Filter", "Analytics", "Settings" in that order
    And clicking "Analytics" navigates to "/analytics"

  # ─── Page shell ─────────────────────────────────────────────────────────────
  Scenario: Analytics page renders the header and three tabs
    When the user opens "/analytics"
    Then the page shows a PageHeader titled "Analytics"
    And the tab strip lists "Overview", "Best buys", "Price drops"
    And the "Overview" tab is selected by default

  Scenario: Tab switching swaps panels without route change
    Given the user is on "/analytics"
    When the user clicks the "Best buys" tab
    Then the URL stays "/analytics"
    And the Best buys panel is visible
    And the Overview panel is hidden

  # ─── Loading + empty states ─────────────────────────────────────────────────
  Scenario: Page tolerates pending queries without crashing
    Given the GET /api/analytics/overview request is pending
    When the user opens "/analytics"
    Then the PageHeader and tabs are still rendered
    And no chart errors are thrown

  Scenario: Empty arrays render without error
    Given GET /api/analytics/overview returns kpis with zero counts and empty arrays
    When the user opens "/analytics"
    Then the KPI tiles render with "0" or "—"
    And the chart cards render their headers without throwing

  # ─── Backend: overview ──────────────────────────────────────────────────────
  Scenario: GET /api/analytics/overview returns the OverviewResponse shape
    Given seeded Listing rows across at least 3 districts with ListingSnapshot history
    When the client calls GET /api/analytics/overview
    Then the response status is 200
    And the body contains keys: kpis, trendByDistrict, months, heatmap, domBuckets, inventory12w, newPerWeek, gonePerWeek, scatter
    And kpis contains numeric: medianEurPerSqm, activeInventory, medianDomDays, bestDealsCount, recentDropsCount

  Scenario: Overview KPIs reflect only active listings
    Given two active listings and one inactive listing
    When GET /api/analytics/overview is called
    Then kpis.activeInventory equals 2

  # ─── Backend: best buys ─────────────────────────────────────────────────────
  Scenario: GET /api/analytics/best-buys returns ranked rows capped at 50
    Given 60 active listings spread across districts
    When the client calls GET /api/analytics/best-buys
    Then the response status is 200
    And the body is an array of length 50
    And each row has keys: id, title, district, type, priceEur, areaSqm, yearBuilt, daysOnMkt, eurPerSqm, medianEurPerSqm, discount, z, score, priceDrop, dropPct
    And rows are sorted by score descending

  Scenario: Best buys filters by region and rooms
    Given listings across districts "Centru" and "Botanica" with rooms 2, 3, 4
    When the client calls GET /api/analytics/best-buys?region=Centru&rooms=3
    Then every returned row has district "Centru" and rooms 3

  # ─── Backend: price drops ───────────────────────────────────────────────────
  Scenario: GET /api/analytics/price-drops?period=7d returns drops in window
    Given a listing with snapshots showing a 10% price decrease 3 days ago
    And another listing with snapshots showing a 10% decrease 30 days ago
    When the client calls GET /api/analytics/price-drops?period=7d
    Then the response includes the 3-day-old drop
    And does not include the 30-day-old drop
    And each row contains: id, title, district, type, priceWas, priceEur, dropPct, dropEur, when

  Scenario: Price drops period defaults to 30d when omitted
    When the client calls GET /api/analytics/price-drops
    Then the implicit window is the last 30 days
    And drops older than 30 days are excluded

  # ─── Backend: validation ────────────────────────────────────────────────────
  Scenario: Invalid period returns 400
    When the client calls GET /api/analytics/price-drops?period=bogus
    Then the response status is 400
