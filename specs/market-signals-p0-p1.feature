Feature: Market signals P0 (delist events + absorption) and P1 (price analytics)
  As an operator assessing the housing market
  I want delist events and segmented price/absorption signals
  So that days-on-market, absorption, and pricing dispersion are real numbers

  # ── P0: delist events (persist layer) ──

  Scenario: Active listing past staleness cutoff records a delist event
    Given an active listing last seen 3 days ago
    When markInactiveOlderThan(2 days) runs
    Then the listing is inactive with delistedAt set and delistReason "stale_cutoff"

  Scenario: Revived listing clears delistedAt and delistReason
    Given a delisted listing with delistReason "stale_cutoff"
    When the listing is re-seen (markSeen) or re-fetched (persistDetail)
    Then it is active again with delistedAt and delistReason cleared to null

  Scenario: Legacy inactive row is backfilled from lastSeenAt
    Given an inactive listing with delistedAt null and a known lastSeenAt
    When backfillDelistedEstimate runs
    Then delistedAt equals lastSeenAt and delistReason is "backfill_estimate"

  Scenario: Backfill ignores active rows and already-set delist events
    Given an active listing and a delisted listing with delistReason "stale_cutoff"
    When backfillDelistedEstimate runs
    Then neither row is modified and the returned count is 0

  # ── P0: realized DOM + absorption (lib) ──

  Scenario: Realized DOM uses delistedAt over closed listings only
    Given a listing delisted 30 days after firstSeenAt and a still-active listing
    When realized DOM is computed
    Then the active listing is excluded and the closed listing yields 30 days

  Scenario: Absorption is active inventory divided by monthly delist rate
    Given 60 active listings and 12 delists in the trailing 4 weeks
    When absorptionMonths is computed
    Then it returns 5 months of supply

  Scenario: Absorption is null when there are no recent delists
    Given active inventory and zero delists in the trailing window
    When absorptionMonths is computed
    Then it returns null

  Scenario: gonePerWeek counts real delists per week bucket
    Given listings delisted in specific weeks
    When the overview gonePerWeek series is built
    Then each week bucket reflects its delist count and is not hardcoded to zero

  # ── P1: price analytics (lib) ──

  Scenario: Price band buckets a price into a fixed EUR band
    Given prices of 35000, 55000, 85000, 120000 and 200000
    When priceBand is applied
    Then the bands are "<40k", "40-70k", "70-100k", "100-150k" and "150k+"

  Scenario: Price band is "unknown" for a null price
    Given a listing with null priceEur
    When priceBand is applied
    Then the band is "unknown"

  Scenario: Euro-per-sqm IQR is the interquartile range
    Given a set of euro-per-sqm values
    When iqr is computed
    Then it returns the third quartile minus the first quartile

  Scenario: Repricing velocity averages consecutive snapshot deltas
    Given snapshot prices 100000, 95000, 90000
    When repricing velocity is computed
    Then it returns the mean consecutive delta of -5000

  Scenario: Time-to-first-cut measures days to the first observed price drop
    Given a listing first seen on day 0 with snapshots flat then dropping on day 10
    When timeToFirstCutDays is computed
    Then it returns 10

  Scenario: Time-to-first-cut is null when no drop is observed
    Given a listing whose snapshots never decrease
    When timeToFirstCutDays is computed
    Then it returns null

  Scenario: New-listing premium ratios fresh asks against standing median
    Given fresh (<2wk) euro-per-sqm values and standing-inventory values
    When newListingPremium is computed
    Then it returns median(fresh) divided by median(standing)

  Scenario: Seller mix splits agency vs private vs unknown shares
    Given listings tagged private, agency and untagged
    When sellerMix is computed
    Then it returns the fractional share of each seller type

  # ── P1: segmentation (lib + route) ──

  Scenario: Segment stats group by sector, rooms and price band
    Given listings across several sectors, room buckets and price bands
    When segment stats are computed
    Then each segment reports count, median and IQR of euro-per-sqm

  Scenario: Segment below the small-sample floor is suppressed
    Given a segment with fewer than 5 listings
    When segment stats are computed
    Then that segment is omitted from the result

  # ── API ──

  Scenario: Overview response includes the new P0/P1 KPIs
    Given seeded active and delisted listings with snapshots
    When GET /api/analytics/overview is called
    Then the response includes iqrEurPerSqm, medianDomClosed, absorptionMonths, repriceVelocity, timeToFirstCutDays, newListingPremium and sellerMix

  Scenario: Segments endpoint returns per-segment rows
    Given seeded listings spanning multiple segments
    When GET /api/analytics/segments?by=sector,rooms,priceBand is called
    Then it returns rows keyed by the requested dimensions with count, median and IQR
