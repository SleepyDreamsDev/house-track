Feature: Operator SPA (React + Tailwind) — Property browsing & analysis interface
  As an operator managing a property dataset
  I want a unified web interface to browse, filter, and analyze listings
  With persistent filter state, sortable tables, and real-time sweep status
  So I can identify market opportunities without manual database queries

  Background:
    Given the Operator SPA is running at http://localhost:5173 (dev) or served from the main Hono API
    And Postgres is populated with test fixtures (200+ listings, at least 5 sweeps)
    And the Hono API is healthy at http://localhost:3000/api

  # ──────────────────────────────────────────────────────────────────
  # DASHBOARD PAGE — Overview & KPIs
  # ──────────────────────────────────────────────────────────────────

  Scenario: Dashboard loads KPI cards and circuit state
    When the operator navigates to the root path "/"
    Then the Dashboard page loads without error
    And displays "Total inventory" KPI with a numeric count
    And displays "New today" card with recent listings
    And displays "Price drops" card with flag-marked rows
    And shows sweep status (running|success|failed|cancelled)
    And displays circuit-breaker state (open|closed)

  Scenario: Latest sweep status updates in real time
    Given a sweep is running in the crawler
    When the operator views the Dashboard
    Then the latest sweep section shows "status: running"
    And displays duration in milliseconds

  Scenario: Dashboard warns when sweep data is stale
    Given the latest sweep finished more than 24 hours ago
    And its status is not "running"
    When the operator loads the Dashboard
    Then a warning banner appears above the KPI strip
    And it says the data may be stale, showing the relative time of the last sweep
    And it links to the Sweeps page

  Scenario: Dashboard shows a failure banner when the latest sweep failed
    Given the latest sweep has status "failed"
    When the operator loads the Dashboard
    Then an error banner appears above the KPI strip
    And it links to the Sweeps page

  Scenario: No staleness banner on fresh, running, or empty sweep state
    Given the latest sweep finished less than 24 hours ago with status "success",
      or a sweep is currently running, or no sweep exists yet (fresh database)
    When the operator loads the Dashboard
    Then no staleness or failure banner is rendered

  Scenario: Dashboard API errors degrade gracefully
    Given the API endpoint GET /listings/new-today fails with 500
    When the operator loads the Dashboard
    Then the "New today" card shows an error state (skeleton or error message)
    And the page remains interactive (other cards are not blocked)

  # ──────────────────────────────────────────────────────────────────
  # LISTINGS PAGE — Browse, Filter, Sort
  # ──────────────────────────────────────────────────────────────────

  Scenario: Listings page renders cards view by default
    When the operator navigates to /listings
    Then the page loads with a grid of property cards
    And each card shows title, price (€), district, area (m²)
    And a "Cards" toggle button is visible and selected
    And a "Table" toggle button is also visible

  Scenario: Operator switches to table view
    Given the Listings page is in Cards view
    When the operator clicks the "Table" toggle
    Then the table is rendered with columns: Title, Locality, Price, €/m², Area, Rooms, Land, First seen
    And the card grid is hidden

  Scenario: FilterRail populates from facets data
    When the Listings page mounts
    Then GET /api/listings/facets is called once
    And the FilterRail shows District options from facets.districts
    And the Price range slider shows min/max from facets.price
    And Property type options come from facets.types

  Scenario: Operator searches by title
    Given the Listings page is open
    When the operator types "Centru" in the Search input
    Then GET /api/listings?q=Centru&page=0 is called (debounced ~300ms)
    And table rows with titles matching "Centru" are displayed
    And page resets to 0

  Scenario: Operator filters by price range
    Given the Listings page with price facets min=50000, max=500000
    When the operator sets the price range min=100000, max=250000
    Then GET /api/listings?minPrice=100000&maxPrice=250000&page=0 is called
    And rows outside the range are removed from the view
    And the page resets to 0

  Scenario: Operator toggles district multi-select
    Given the district options are ["Centru", "Botanica", "Durlesti"]
    When the operator clicks "Centru" and "Botanica"
    Then GET /api/listings?district=Centru&district=Botanica&page=0 is called
    And the "Chișinău (municipality)" convenience group is shown only when facets.municipality is non-empty
    And clicking it sets the selection to exactly facets.municipality (one click)
    And the group button shows active only when every member is currently selected

  Scenario: Operator filters by property type
    Given the property types are ["House", "Villa", "Townhouse"]
    When the operator selects type=Villa
    Then GET /api/listings?type=Villa&page=0 is called
    And only rows with derivedType="Villa" are displayed

  Scenario: Operator filters by rooms bucket
    Given listings with rooms counts [1, 2, 3, 4, 5, 6]
    When the operator selects rooms="3"
    Then GET /api/listings?rooms=3&page=0 is called
    And rooms options show exactly ["1–2", "3", "4", "5+"] (buckets from observed data)
    And only rows with rooms in [3] are displayed

  Scenario: Filter rail hides empty filter groups
    Given the catalog has zero districts (all listings are out-of-region)
    When the FilterRail renders
    Then the District (Locality) group is not shown
    And the Search input is shown (the only always-on control)

  Scenario: Price range group hides when the catalog is single-valued
    Given facets.price has min == max (every listing has the same price)
    When the FilterRail renders
    Then the Price group is NOT shown (hasRange requires max > min)

  Scenario: Property type group hides when only one type exists
    Given facets.types == ["House"] (exactly one observed type)
    When the FilterRail renders
    Then the Property type group is NOT shown (gated on types.length > 1)
    When facets.types == ["House", "Villa"]
    Then the Property type group IS shown

  Scenario: Favorite/excluded/mislabeled toggles are count-gated
    Given facets.favoritesCount == 0
    Then the "Favorites only" toggle is not shown
    Given facets.excludedCount > 0
    Then the "Show excluded" toggle is shown
    Given facets.mislabeledCount == 0
    Then the "Hide mislabeled" toggle is not shown (also requires setHideMislabeled prop)

  Scenario: RangeField rejects blank, NaN, and negative input
    Given the operator focuses the price min input
    When the operator clears it or types "-5" or "abc"
    Then the parsed value is null (unbounded), not -5 or NaN
    And no minPrice param is sent

  Scenario: Clear-all resets every browse filter
    Given the operator has q="Vila", minPrice=100000, and districts=["Centru"]
    And the FilterRail received an onClearAll callback
    Then a "Clear all" button is visible (because at least one filter is active)
    When the operator clicks "Clear all"
    Then q="", all ranges=null, districts=[], type="all", rooms="all", all toggles=false
    And the cleared snapshot is written to sessionStorage

  Scenario: District/sector selection is de-duplicated at the setter
    Given a convenience group and an individual chip both reference "Centru"
    When the operator selects the group then the chip
    Then setDistricts wraps the value in Array.from(new Set(...))
    And "Centru" appears exactly once (no duplicate IN-clause member)

  Scenario: Range filters are unbounded by default
    Given the Listings page fresh load
    When the operator views the price range inputs
    Then both inputs are empty
    And the URL has no minPrice or maxPrice query params

  Scenario: Operator toggles "Favorites only" checkbox
    When the operator enables "Favorites only"
    Then GET /api/listings?favoritesOnly=true&page=0 is called
    And only rows with watchlist=true are displayed

  Scenario: Operator toggles "Show excluded" checkbox
    When the operator enables "Show excluded"
    Then GET /api/listings?showExcluded=true&page=0 is called
    And rows with excluded=true are now visible

  Scenario: Operator toggles "Hide mislabeled"
    When the operator enables "Hide mislabeled"
    Then GET /api/listings?hideMislabeled=true&page=0 is called
    And rows with typeMismatch=true are removed from display

  Scenario: Table column click sorts client-side
    Given the Listings table is loaded with 20 rows
    When the operator clicks the "Price" column header
    Then sortedRows are ordered by price ascending (nulls at end)
    And the "Price" header shows an ascending indicator (↑)
    And no API call is made (client-side sort)

  Scenario: Table column flip direction on second click
    Given the table is sorted by Price ascending
    When the operator clicks the "Price" header again
    Then sortedRows are ordered by price descending
    And the "Price" header shows a descending indicator (↓)

  Scenario: Table default sort is firstSeenAt descending
    When the Listings table renders
    Then sortKey is "firstSeenAt" and sortDir is "desc"
    And newest listings appear at the top

  Scenario: First click on a fresh column always sorts ascending
    Given the table is sorted by firstSeenAt desc
    When the operator clicks the "Title" header (a different column)
    Then the new sort is { key: 'title', dir: 'asc' } (asc-first, not inheriting desc)

  Scenario: String columns sort with natural, case-insensitive ordering
    Given a Title column with values ["Casa 2", "casa 10", "Casa 1"]
    When sorted ascending
    Then order is ["Casa 1", "Casa 2", "casa 10"] (localeCompare numeric + base sensitivity)

  Scenario: Analytics tables sort in controlled mode
    Given a BestBuysTable rendered with a controlled `sort` prop
    When the operator clicks a column header
    Then the hook does not mutate internal state
    And it calls onSortChange(next) so the parent owns the sort state

  Scenario: Listings table renders inline status badges
    Given a row with isNew=true, priceWas set above priceEur, and regionMismatch=true
    When the row renders
    Then a "NEW" badge is shown
    And a "−{drop}%" badge is shown (drop computed as round((1 - priceEur/priceWas)*100), only when > 0)
    And an "Out-of-region: {district}" warning badge is shown
    And a typeMismatch row instead shows the derivedType warning badge with mismatchReasons as the title tooltip

  Scenario: Nullish values always appear at the end, regardless of sort direction
    Given a table with rows: { priceEur: null }, { priceEur: 100000 }, { priceEur: 50000 }
    When sorted by priceEur ascending
    Then order is [50000, 100000, null]
    When sorted by priceEur descending
    Then order is [100000, 50000, null]

  Scenario: Operator toggles favorite on a row
    Given a row with watchlist=false and a favorite button (☆)
    When the operator clicks the favorite button
    Then PUT /api/listings/{id}/watchlist with { watchlist: true } is called
    And the button changes to ★ (optimistic update)
    And watchlist changes to true

  Scenario: Operator toggles exclude on a row
    Given a row with excluded=false and an exclude button (✕)
    When the operator clicks the exclude button
    Then PUT /api/listings/{id}/excluded with { excluded: true } is called
    And the button background changes to error color (optimistic update)
    And excluded changes to true

  Scenario: Favorite toggle fails and rolls back
    Given a favorite button is clicked
    And the API call fails with 500
    Then the button reverts to ☆ (rollback)
    And an error message is shown
    And the user can retry

  Scenario: Operator clicks "Open" button
    When the operator clicks the "Open ↗" button on a row
    Then a new browser tab opens to the listing's URL (999.md)
    And the current page is not affected

  Scenario: Operator expands a row to view price history
    When the operator clicks on a row (not on an action button)
    Then the row is selected (highlighted background)
    And a price-history panel expands below the row
    And GET /api/listings/{id}/price-history is called

  Scenario: Price history panel shows price changes
    Given a listing with multiple snapshots at different prices
    When the price-history panel renders
    Then it shows rows: priceEur, direction (▲ for up, ▼ for down), deltaPct, date
    And newest prices are at the top (reversed chronological via [...points].reverse())
    And the first (baseline) price shows "first seen" (direction === 'baseline')
    And up rows render in error color, down rows in success color

  Scenario: Price history with a single baseline point shows empty message
    Given a listing whose price-history has points.length <= 1
    When the price-history panel renders
    Then it shows "No price changes recorded yet."
    And no per-point list is rendered
    And the baseline point's null deltaPct is never dereferenced

  Scenario: Price history caches for 5 minutes
    Given the price-history panel fetches and caches data
    When the operator collapses the row and re-expands within 5 minutes
    Then no new API call is made (cached data is used)
    When 5+ minutes pass and the operator re-expands
    Then a fresh fetch occurs

  Scenario: Pagination: operator navigates pages
    Given page 0 is loaded with 50 rows
    When the operator clicks "Next" button
    Then GET /api/listings?...&page=1 is called
    And new rows (51–100) are rendered
    And the current page indicator shows "Page 2 of X"

  Scenario: Pagination resets on filter change
    Given the operator is on page 3 of search results
    When the operator adjusts the price filter
    Then page resets to 0
    And GET /api/listings?...&page=0 is called (not page=3)

  # ──────────────────────────────────────────────────────────────────
  # ANALYTICS PAGE — Multi-Tab Analysis
  # ──────────────────────────────────────────────────────────────────

  Scenario: Analytics page loads with four tabs
    When the operator navigates to /analytics
    Then four tabs are visible: "Overview", "Best Buys", "Price Drops", "Motivated Sellers"
    And "Overview" tab is selected by default
    And FilterRail is shown on the left with all filter controls
    And the rail state is restored from sessionStorage

  Scenario: FilterRail is shared across all tabs
    When the operator sets a filter (e.g., maxPrice=200000) on the Overview tab
    And switches to the Best Buys tab
    Then the maxPrice filter is still 200000
    And the filter rail shows the same state

  Scenario: Overview tab renders KPI cards and charts
    When the Overview tab is selected
    Then GET /api/analytics/overview?... is called with current filters
    And KPI cards are displayed: medianEurPerSqm, activeInventory, medianDomDays, bestDealsCount, recentDropsCount
    And charts render from the response: MultiLineChart (trendByDistrict/months), Heatmap, DOMHistogram (domBuckets), FlowChart (inventory12w/newPerWeek/gonePerWeek), Scatter
    And a district color Legend keys the charts (DIST_COLORS, fallback "#0f766e" for unknown districts)

  Scenario: Best Buys tab renders ranked table
    When the Best Buys tab is selected
    Then GET /api/analytics/best-buys?... is called with current filters
    And a table appears with base columns: Rank, Listing, Type, District, Price, €/m², vs median, Score
    And rows are sorted by Score descending by default
    And a ScoreBar visualization is shown for each score (fill = clamp(score,0,3)/3)
    And the "Type" column is hidden when compact=true
    And Year, DOM, and Drop columns appear only when fullCols=true
    And DOM is rendered in hours when daysOnMkt < 24 (e.g. "6h"), else as days ("3d")
    And a "drop" badge appears next to the title when priceDrop=true

  Scenario: Best Buys table supports sortable columns
    When the operator clicks the "Price" column header
    Then the rows are sorted by price ascending
    And the "Price" header shows an ascending indicator
    When the operator clicks "Price" again
    Then the rows are sorted by price descending

  Scenario: Best Buys segmented buttons provide sort presets
    When the Best Buys tab is open
    Then buttons are shown: "Score" (default), "€/m²", "Discount"
    When the operator clicks "€/m²"
    Then the table is sorted by €/m² ascending
    And the "€/m²" column header shows an ascending indicator

  Scenario: Price Drops tab shows drop-event listings
    When the Price Drops tab is selected
    Then GET /api/analytics/price-drops?... is called with current filters
    And a table appears with columns: Rank, Listing, District, Was, Now, Drop
    And a "Period" segmented selector is shown (7d, 30d, all)
    And rows are sorted by drop % descending by default

  Scenario: Price Drops period selector filters by time window
    When the operator selects "7d"
    Then GET /api/analytics/price-drops?...&period=7d is called
    And only drops within the last 7 days are shown

  Scenario: Motivated Sellers tab renders ranked table
    When the Motivated Sellers tab is selected (?tab=motivated-sellers)
    Then GET /api/analytics/motivated-sellers?... is called with current filters (lazy: only when the tab is active)
    And a table appears with columns: Rank, Listing, District, Price, DOM vs median, Cuts, Total cut, vs model, Score
    And rows are sorted by Score descending by default
    And residualPct renders as "—" when null (hedonic floor not met)
    And each row has watchlist/exclude actions and a jump to the listing (/listings?highlight=<id>&from=motivated-sellers)

  Scenario: Analytics filters apply to all endpoints uniformly
    Given the operator has set: q="Centru", minPrice=100000, type="Villa"
    When viewing Overview, Best Buys, and Price Drops tabs
    Then all tab endpoints receive the same query string: q=Centru&minPrice=100000&type=Villa

  Scenario: Analytics facets remain union-of-catalog
    Given the operator has filtered to district="Centru" only
    When viewing the FilterRail
    Then the District options still show all districts ["Centru", "Botanica", "Durlesti"]
    And not just the filtered slice

  Scenario: Empty analytics dataset
    Given the catalog has zero listings or all are excluded by filter
    When the analytics tabs render
    Then empty tables are shown with "No results" message
    And KPI cards are visible but show 0 or "–"
    And the page does not crash

  # ──────────────────────────────────────────────────────────────────
  # FILTER EDITOR PAGE — Dynamic Taxonomy
  # ──────────────────────────────────────────────────────────────────

  Scenario: Filter page fetches source and taxonomy
    When the operator navigates to /filter
    Then GET /api/sources is called (returns Source[] array)
    And for each source with adapterKey="999md":
      GET /api/sources/{id}/taxonomy is called
    And the taxonomy data is rendered as a form

  Scenario: FilterForm renders dynamic sections from taxonomy
    Given a TaxonomyEntry with kind="options" and 3 options
    When FilterForm mounts
    Then a FilterSection is rendered with label and selection count
    And three OptionsField checkboxes are shown (unchecked by default)

  Scenario: GenericFilter draft uses category, not name/description
    Given the Filter editor builds a draft GenericFilter
    Then the draft shape is { category: 'house' | 'apartment', filters: FilterSelection[] }
    And there are NO name or description fields
    And on save the draft is parsed by genericFilterSchema before PUT

  Scenario: Operator toggles options in FilterForm
    Given the FilterForm with options ["For sale", "For rent", "Swap"]
    When the operator checks "For sale" and "Swap"
    Then the draft state updates to:
      filters: [{ kind: 'options', filterId: 1, featureId: 1, optionIds: [1, 3] }]
    And the selection count badge shows "2"
    And the FilterSection defaults to open because its selection count > 0

  Scenario: Unchecking the last option removes the options selection
    Given an options selection with optionIds: [1]
    When the operator unchecks option 1
    Then the entire options FilterSelection is removed from filters (not left as optionIds: [])

  Scenario: Clearing both range bounds removes the range selection
    Given a range selection with min: '100000', max: undefined
    When the operator clears the min input
    Then the range FilterSelection is removed from filters

  Scenario: Saving an invalid GenericFilter is rejected by Zod
    Given a draft with a range selection that has neither min nor max
    When the operator clicks "Save"
    Then genericFilterSchema.parse raises a ZodError ("range must have at least one of min or max")
    And the PUT is not sent (or returns a 4xx)
    Given a range with min > max
    Then parse raises a ZodError ("min must be ≤ max")
    Given an options selection with optionIds: []
    Then parse raises a ZodError (optionIds.min(1))

  Scenario: FilterForm renders range fields
    Given a TaxonomyEntry with kind="range" for "Price"
    And units=["EUR", "USD", "MDL"]
    When the operator enters min=100000, max=250000
    And selects unit="EUR"
    Then the draft state updates to:
      filters: [{ kind: 'range', filterId: 2, featureId: 9441, min: '100000', max: '250000', unit: 'EUR' }]

  Scenario: Operator saves filter changes
    Given the FilterForm has unsaved edits
    When the operator clicks "Save"
    Then PUT /api/sources/{sourceId}/filter with the GenericFilter JSON is called
    And a success message is displayed
    And the crawler reads the new filter on next sweep-start

  Scenario: Filter editor supports boolean toggles
    Given a TaxonomyEntry with kind="boolean" and features [{ featureId: 100, label: "Has parking" }]
    When the operator checks the "Has parking" toggle
    Then the draft state updates to:
      filters: [{ kind: 'boolean', filterId: 3, featureId: 100 }]

  Scenario: Multi-unit range field tracks pending unit
    Given a price range field with units=["EUR", "USD", "MDL"]
    When the operator clicks the unit dropdown (before entering any value)
    Then the unit is stored in local pendingUnits state (not in FilterSelection yet)
    When the operator enters min=100000
    Then the FilterSelection is created with the pending unit applied

  # ──────────────────────────────────────────────────────────────────
  # SETTINGS PAGE — Configuration
  # ──────────────────────────────────────────────────────────────────

  Scenario: Settings page loads configuration
    When the operator navigates to /settings
    Then GET /api/settings is called (returns Setting[] KV array)
    And GET /api/sources is called
    And politeness settings are displayed (baseDelayMs, jitterMs, detailDelayMs)
    And cron schedule input is shown
    And source enable/disable toggles are rendered

  Scenario: Operator edits politeness settings
    Given the current politeness.baseDelayMs is 8000
    When the operator changes it to 10000
    And clicks "Save"
    Then PUT /api/settings with [{ key: 'politeness.baseDelayMs', valueJson: 10000 }] is called
    And a success message is displayed
    And the crawler reads the new value on next sweep-start

  Scenario: Operator edits cron schedule
    Given the current schedule is "0 9,21 * * *"
    When the operator edits it to "0 */6 * * *"
    And clicks "Save"
    Then PUT /api/settings with { key: 'sweep.cronSchedule', valueJson: '0 */6 * * *' } is called
    And a note is shown: "Restart the crawler container for changes to take effect"

  Scenario: Operator toggles source enable/disable
    When the operator clicks the "999md" source toggle to disable
    Then PATCH /api/sources/999md with { enabled: false } is called
    And the crawler skips this source on next sweep-start

  Scenario: Circuit breaker status and reset
    When the Settings page loads
    Then GET /api/circuit returns { open: boolean, lastTriggeredAt?: string }
    And the circuit state is displayed (e.g., "Open: triggered 2 hours ago")
    When the operator clicks "Clear"
    Then DELETE /api/circuit is called
    And the state changes to "Closed"

  # ──────────────────────────────────────────────────────────────────
  # SWEEPS PAGE — Sweep History & Status
  # ──────────────────────────────────────────────────────────────────

  Scenario: Sweeps page lists recent sweep runs
    When the operator navigates to /sweeps
    Then GET /api/sweeps?limit=20&offset=0 is called
    And a table of SweepRun rows is displayed:
      Columns: Start time, Duration, Status, Pages fetched, Details fetched, New listings, Errors
    And rows are sorted by start time descending (newest first)

  Scenario: Sweeps page filters by source
    Given multiple sources (999md, makler.md)
    When the operator selects source="999md"
    Then GET /api/sweeps?limit=20&offset=0&source=999md is called
    And only 999md sweeps are shown

  Scenario: Operator clicks on a sweep to view details
    Given a sweep row with id=123
    When the operator clicks on it
    Then navigation to /sweeps/123 occurs
    And GET /api/sweeps/123 is called

  Scenario: Sweeps page auto-refreshes
    When the Sweeps page is open
    Then GET /api/sweeps is called every 5–10 seconds
    And new/finished sweeps appear without user action (optional feature)

  Scenario: SweepDetail streams live events via SSE while running
    Given the operator opens /sweeps/123 and that sweep status is "running"
    Then useSse opens an EventSource to /api/sweeps/123/stream
    And each message event (JSON) is appended to the live event list
    And malformed payloads are ignored (not appended)
    And on transient error EventSource auto-reconnects (no crash)
    When the sweep finishes (status != "running") or the page unmounts
    Then the EventSource is closed

  Scenario: SweepDetail does not stream for a finished sweep
    Given the operator opens /sweeps/123 and that sweep status is "success"
    Then useSse is disabled and no EventSource is opened
    And the page renders the stored eventLog instead of a live stream

  Scenario: SweepDetail page expands sweep data
    Given a sweep with configSnapshot, pagesDetail, detailsDetail, eventLog
    When the SweepDetail page loads for sweep 123
    Then all fields are displayed:
      - configSnapshot: { filter, politeness } JSON
      - pagesDetail: array of { url, status, duration }
      - detailsDetail: array of { listingId, status, duration }
      - eventLog: array of { timestamp, level, message }

  Scenario: SweepDetail shows error summary
    Given a sweep with status="partial" and errors array with 3 items
    When the SweepDetail page renders
    Then an "Errors" section shows:
      { url: "...", status: 500, msg: "..." }

  # ──────────────────────────────────────────────────────────────────
  # FILTER PERSISTENCE — Session State
  # ──────────────────────────────────────────────────────────────────

  Scenario: Browse filters persist across page switches
    Given the operator is on Listings with filters: q="Centru", minPrice=100000
    When the operator switches to Analytics
    And then back to Listings
    Then the filters are restored: q="Centru", minPrice=100000
    And GET /api/listings?q=Centru&minPrice=100000 is called

  Scenario: Browse filters persist across page reload
    Given the operator has set filters on Listings: q="Vila"
    When the operator reloads the page (F5)
    Then the filters are restored from sessionStorage: q="Vila"
    And GET /api/listings?q=Vila is called

  Scenario: Filters are cleared when the tab closes
    Given the operator has set filters in a tab
    When the operator closes the tab
    And reopens a fresh tab to /listings
    Then filters are empty (q="", minPrice=null, etc.)
    And GET /api/listings (no query params beyond page) is called

  Scenario: Filter state survives Analytics tab switches
    Given the operator sets filters on Overview tab
    When switching between Best Buys → Price Drops → Overview
    Then all tabs read the same persisted filter state
    And switching is instant (no re-filtering needed)

  Scenario: useBrowseFilters hook reads sessionStorage at mount
    When a page component with useBrowseFilters mounts
    Then sessionStorage is read exactly once (lazy init)
    And subsequent setState calls update both state and sessionStorage
    And no re-parsing of storage occurs on re-render

  # ──────────────────────────────────────────────────────────────────
  # APPSHELL NAV — Sidebar Collapse
  # ──────────────────────────────────────────────────────────────────

  Scenario: Sidebar is expanded by default
    When the operator opens the SPA for the first time
    Then the sidebar shows nav labels: Dashboard, Listings, Sweeps, Filter, Analytics, Settings
    And the sidebar width is 256px (w-64)

  Scenario: Operator collapses sidebar
    When the operator clicks the collapse button (chevron)
    Then the sidebar width becomes 64px (w-16)
    And nav labels are hidden; only icons remain
    And the state is saved to localStorage['appshell:nav-collapsed'] = '1'
    When the operator expands again
    Then localStorage['appshell:nav-collapsed'] is set to '0' (not removed)

  Scenario: AppShell degrades when localStorage is unavailable
    Given localStorage throws on read/write (private mode / disabled)
    When the operator toggles the sidebar
    Then the collapse state is kept in memory only (no crash)
    And it does not persist across reload

  Scenario: Sidebar state persists across reload
    Given the sidebar was collapsed
    When the operator reloads the page
    Then the sidebar is still collapsed
    And navigation is still functional

  Scenario: Sidebar toggle responds to route changes
    Given the sidebar is collapsed
    When the operator clicks the Dashboard link
    Then the Dashboard page loads (sidebar state unchanged)
    And the Dashboard nav item is highlighted

  # ──────────────────────────────────────────────────────────────────
  # NETWORK & ERROR HANDLING
  # ──────────────────────────────────────────────────────────────────

  Scenario: API error on listings fetch shows retry UI
    Given GET /api/listings returns 500
    When the Listings page loads
    Then an error message is displayed
    And a "Retry" button is shown
    When the operator clicks "Retry"
    Then GET /api/listings is called again

  Scenario: Network timeout on facets degrades gracefully
    Given GET /api/listings/facets times out
    When the FilterRail renders
    Then the Search input is shown (always available)
    And all filter groups except Search are hidden
    And a "Loading filters…" spinner is shown

  Scenario: Missing optional facet fields don't crash
    Given facets response lacks "sectors" field
    When the FilterRail renders
    Then no Sector filter group is shown
    And the page remains interactive

  Scenario: TanStack Query auto-retries failed queries
    Given GET /api/listings returns 500 on first two attempts
    And succeeds on the third attempt
    When the page is loaded
    Then after exponential backoff, the data eventually loads
    And the page shows the data (no error state)

  # ──────────────────────────────────────────────────────────────────
  # ACCEPTANCE CRITERIA SUMMARY
  # ──────────────────────────────────────────────────────────────────

  Scenario: All six main pages are accessible
    When the operator clicks each nav item
    Then each page loads without error:
      ✓ Dashboard (/)
      ✓ Listings (/listings)
      ✓ Sweeps (/sweeps)
      ✓ Filter (/filter)
      ✓ Analytics (/analytics)
      ✓ Settings (/settings)

  Scenario: Listings and Analytics share the same browse-filter state
    When browsing Listings with filters (q, price, district, type, rooms)
    And switching to Analytics
    And switching back to Listings
    Then the same filters are applied across all three pages without refetch

  Scenario: Table sorting is instant (client-side)
    When sorting any table column
    Then the rows are reordered immediately (< 100ms)
    And no API call is made
    And nullish values always appear at the end

  Scenario: Filter rail visibility is data-driven
    When the catalog has no data for a dimension (e.g., zero types)
    Then that filter group is not shown
    And the rail adapts to the actual catalog state

  Scenario: Favorite/exclude toggles are independent
    When a row is marked favorite AND excluded
    Then both flags are true
    And toggling one doesn't affect the other

  Scenario: Circuit breaker state is readable and resettable
    When viewing the Settings page
    Then the circuit state is displayed (open/closed, lastTriggered)
    And clicking "Clear" resets it (DELETE /api/circuit)

  Scenario: Settings changes are persisted to database
    When editing any setting (politeness, cron, source toggle)
    And saving
    Then the change is written to Postgres
    And the crawler reads the new value on next sweep-start

  Scenario: Browser storage is compatible with session model
    When using sessionStorage for filter state
    Then filters survive reload within the same tab
    And filters are cleared when the tab closes
    And AppShell nav state uses localStorage (persists across tabs)
