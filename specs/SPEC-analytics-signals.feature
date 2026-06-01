Feature: Classification, hedonic pricing, and market signals analytics
  As a house-track operator
  I want listings classified by type and city sector, priced via hedonic regression,
  and market conditions analyzed through DOM, absorption, and inventory signals
  So that I can identify best buys, spot market shifts, and rank neighborhoods by heat

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 0: Type Detection & Classification
  # ──────────────────────────────────────────────────────────────────────────
  # Spec: src/lib/listing-classification.ts + src/lib/listing-type.ts

  Background:
    Given the type detection engine has priority: Duplex > Townhouse > Villa > House
    And negation patterns ("nu este", "fără", "lângă") cancel a match within 40 chars
    And word boundaries use ASCII \b and trailing lookahead (?![a-zăâîșț]) for diacritics

  Scenario: Plain house title defaults to House type
    Given a listing titled "Casă 140 m², Colonița"
    When I detect its type from title alone
    Then the type is "House"

  Scenario: Duplex mention anywhere wins priority over Townhouse
    Given a listing whose text contains "duplex în ansamblu de townhouse"
    When I detect its type
    Then the type is "Duplex"

  Scenario: Townhouse with space is detected as Townhouse
    Given a listing titled "Casa tip Town House, Chișinău"
    When I detect its type
    Then the type is "Townhouse"

  Scenario: Cyrillic таунхаус is detected as Townhouse
    Given a listing whose text contains "таунхаус новый"
    When I detect its type
    Then the type is "Townhouse"

  Scenario: Villa (vilă/vilă) is detected as Villa
    Given a listing titled "Vilă de lux, 300 m², Centru"
    When I detect its type
    Then the type is "Villa"

  Scenario: Negation "nu este duplex" cancels the Duplex match
    Given a listing whose text contains "Casă individuală, nu este duplex"
    When I detect its type
    Then the type is "House"

  Scenario: Proximity "lângă un townhouse" does not trigger Townhouse
    Given a listing whose text contains "Casă amplasată lângă un townhouse"
    When I detect its type
    Then the type is "House"

  Scenario: Keyword inside a larger word (acoperiș duplexat) does not match
    Given a listing whose text contains "acoperiș duplexat oarecare"
    When I detect its type
    Then the type is "House"

  Scenario: Rooms bucket correctly partitions by count
    When I bucket rooms:
      | rooms | bucket |
      | null  | 1–2    |
      | 0     | 1–2    |
      | -1    | 1–2    |
      | 1     | 1–2    |
      | 2     | 1–2    |
      | 3     | 3      |
      | 4     | 4      |
      | 5     | 5+     |
      | 10    | 5+     |
    Then all buckets match expected

  Scenario: Negated higher-priority keyword falls through to a real lower-priority match
    Given a listing whose text contains "nu este duplex, dar este townhouse"
    When I detect its type
    Then the type is "Townhouse"

  Scenario: Villa lookahead does not match a longer word
    Given a listing titled "Casă cu finisaj vilante exotic"
    When I detect its type
    Then the type is "House"

  Scenario: deriveType reads title only, ignoring description cues
    Given a listing titled "Casă 120 m²" with description "de fapt este un duplex"
    When I call deriveType on the title alone
    Then the type is "House"

  Scenario: classifyListing reads description so the same cue is detected
    Given a listing titled "Casă 120 m²" with description "de fapt este un duplex"
    When I classify it
    Then the type is "Duplex"

  Scenario: Negation cue beyond 40 chars does not cancel the match
    Given a listing whose text places "fără" more than 40 chars before "duplex"
    When I detect its type
    Then the type is "Duplex"

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 0: Region Classification
  # ──────────────────────────────────────────────────────────────────────────

  Background:
    Given the municipality allowlist has exactly 33 folded locality strings (city + towns + communes + dependent villages)
    And fold() normalizes diacritics: â/î → i, ă→a, ș→s, ț→t, then collapses non-alphanumeric runs
    And any district whose fold is not in the allowlist is a region mismatch
    And a null district and an empty-fold district are both NOT a mismatch

  Scenario: Ialoveni (outside municipality) is a region mismatch
    Given a listing with district "Ialoveni"
    When I check for region mismatch
    Then it is a region mismatch

  Scenario: Durlești (municipality town) is not a region mismatch
    Given a listing with district "Durlești"
    When I check for region mismatch
    Then it is not a region mismatch

  Scenario: Bîc (municipality commune) is not a region mismatch
    Given a listing with district "Bîc"
    When I check for region mismatch
    Then it is not a region mismatch

  Scenario: Spelling variant Sângera folds to same as Sîngera
    Given listings with district "Sîngera" and "Sângera"
    When I check both for region mismatch
    Then both pass (not a mismatch)

  Scenario: Null district is not a mismatch
    Given a listing with no district
    When I check for region mismatch
    Then it is not a region mismatch

  Scenario: Case and diacritics are folded uniformly
    When I fold these strings:
      | input       | output  |
      | "CHIȘINĂU"  | "chisinau" |
      | "Băcioi"    | "bacioi"   |
      | "Vadul lui Vodă" | "vadul lui voda" |
    Then all fold correctly

  Scenario: fold() is idempotent
    Given any locality string s
    When I compute fold(fold(s))
    Then it equals fold(s)

  Scenario: Punctuation-only district folds to empty and is not a mismatch
    Given a listing with district "-- ,"
    When I check for region mismatch
    Then it is not a region mismatch (empty fold)

  Scenario: isMunicipalityLocality is false for null and empty, true only for allowlist members
    When I check membership for these districts:
      | district  | isMunicipalityLocality |
      | null      | false                  |
      | ""        | false                  |
      | "Durlești"| true                   |
      | "Ialoveni"| false                  |
    Then all match expected

  Scenario: Region reason carries the raw unfolded district string
    Given a listing titled "Casă" with district "Ialoveni"
    When I classify it
    Then reasons include "region: Ialoveni"
    And the reason string is the raw district, not its folded form

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 0: Sector Inference
  # ──────────────────────────────────────────────────────────────────────────
  # Spec: src/lib/chisinau-sector.ts

  Background:
    Given sector keywords are tested in order: Telecentru before Centru (specificity)
    And three fallback levels: explicit "sectorul X", bare keywords, gazetteer neighborhoods
    And sector inference returns null for non-Chișinău districts

  Scenario: Explicit "sectorul Botanica" in text
    Given a listing with title "Casă, sectorul Botanica, 200 m²"
    When I infer its sector
    Then the sector is "Botanica"

  Scenario: Bare keyword "Telecentru" matches before "Centru"
    Given a listing with description "Aproape de Telecentru, lângă Centru"
    When I infer its sector
    Then the sector is "Telecentru"

  Scenario: Sector "Centru" matches when Telecentru is absent
    Given a listing with street "Bulevardul Centru"
    When I infer its sector
    Then the sector is "Centru"

  Scenario: Gazetteer neighborhood "Valea Morilor" maps to Centru
    Given a listing with description "Valea Morilor, Chișinău"
    When I infer its sector
    Then the sector is "Centru"

  Scenario: Cyrillic "аэропорт" maps to Aeroport
    Given a listing with Russian title containing "аэропорт"
    When I infer its sector
    Then the sector is "Aeroport"

  Scenario: Durlești district returns null sector
    Given a listing with district "Durlești" and title "Sector Centru mentioned"
    When I infer its sector
    Then the sector is null

  Scenario: Out-of-city district returns null
    Given a listing with district "Ialoveni"
    When I infer its sector
    Then the sector is null

  Scenario: No keywords anywhere returns null
    Given a listing titled "Casă 120 m²" with no sector cues
    When I infer its sector
    Then the sector is null

  Scenario: District without diacritics fails the exact gate
    Given a listing with district "Chisinau" (no diacritics) and title "sectorul Botanica"
    When I infer its sector
    Then the sector is null (gate is strict equality to "Chișinău", not folded)

  Scenario: Empty haystack with valid district returns null
    Given a listing with district "Chișinău" and null street, title, and description
    When I infer its sector
    Then the sector is null

  Scenario: Gazetteer neighborhood "schinoasa" maps to Centru
    Given a listing with district "Chișinău" and description "zona Schinoasa"
    When I infer its sector
    Then the sector is "Centru"

  Scenario: Explicit "sectorul X" pattern resolves via KEYWORDS
    Given a listing with district "Chișinău" and title "sect. Râșcani, 3 camere"
    When I infer its sector
    Then the sector is "Râșcani"

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 0: Combined Classification
  # ──────────────────────────────────────────────────────────────────────────

  Scenario: Type mismatch detected from description only
    Given a listing titled "Casă, 200 m², Chișinău" with description "Tip duplex"
    When I classify it
    Then it has a type mismatch (derivedType != House)
    And it has no region mismatch
    And reasons include "type: duplex"

  Scenario: Region mismatch only
    Given a listing titled "Casă, 120 m²" with district "Ialoveni"
    When I classify it
    Then it has no type mismatch
    And it has a region mismatch
    And reasons include "region: Ialoveni"

  Scenario: Clean Durlești house has no flags
    Given a listing titled "Casă, 90 m², Durlești" with district "Durlești"
    When I classify it
    Then it has no flags
    And reasons is empty

  Scenario: Both mismatches flagged
    Given a listing titled "Vilă 250 m²" with district "Botoșani"
    When I classify it
    Then it has a type mismatch
    And it has a region mismatch
    And reasons include "type: villa"
    And reasons include "region: Botoșani"

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 2: Hedonic Pricing Model
  # ──────────────────────────────────────────────────────────────────────────
  # Spec: src/lib/hedonic.ts

  Background:
    Given hedonic regression fits log(price) ~ area + rooms + yearBuilt + one-hot(sector, heating, type)
    And missing rooms/yearBuilt are mean-imputed; missing categoricals → "∅"
    And λ (ridge regularization) escalates on singular matrix: [1e-6, 1e-4, 1e-2, 1]
    And minimum usable samples = 2 (both with priceEur > 0 and areaSqm > 0)

  Scenario: Hedonic model fits successfully on usable samples
    Given a dataset of 50 listings with prices ∈ [€40k–€150k], areas ∈ [100–180 m²]
    When I fit a hedonic model
    Then the model is not null
    And the model.n = 50 (or fewer if some rows are invalid)
    And model.rSquared is between 0.6 and 0.9 (reasonable fit)
    And model.coefficients.length = 1 + 3 (intercept, area, rooms, year) + categories

  Scenario: Hedonic predict() returns reasonable price
    Given a fitted hedonic model on Chișinău data
    When I predict price for a 140 m², 3-room, 2005-built house in Centru
    Then the predicted price is within ±30% of actual market median

  Scenario: Residual percent correctly computes mispricing
    Given a prediction of €100k and actual price of €85k
    When I compute residual percent
    Then residual = (85k − 100k) / 100k = −0.15 (−15% underpriced)

  Scenario: Singular matrix escalates λ and retries
    Given a sparse dataset with many collinear categorical dummies
    When I fit a hedonic model with lambda=1e-6
    Then the fitter escalates to 1e-4, 1e-2, 1 until successful
    And returns a valid model (or null if all fail)

  Scenario: Insufficient usable samples return null
    Given a dataset of only 1 valid listing
    When I fit a hedonic model
    Then the result is null

  Scenario: Missing numeric columns are mean-imputed
    Given listings with some null rooms and null yearBuilt
    When I fit the model
    Then missing values are replaced by their column mean
    And the model trains without error

  Scenario: predict() returns null when area is missing or non-positive
    Given a fitted hedonic model
    When I predict for a sample with areaSqm = null
    Then the result is null
    And predicting for areaSqm = 0 also returns null

  Scenario: residualPct returns 0 when predicted price is non-positive
    Given a predicted price of 0 and an actual price of 85000
    When I compute residual percent
    Then the result is 0 (not NaN or -Infinity)

  Scenario: Blank and null categoricals collapse to the same "∅" level
    Given listings with sector = null, sector = "" and sector = "  "
    When I fit the model
    Then all three share the single "∅" sector level

  Scenario: Caller-supplied lambda is the first escalation step
    Given fitHedonic called with lambda = 0.5
    When the first fit succeeds
    Then 0.5 is used (escalation would otherwise be [0.5, 1e-4, 1e-2, 1], which can decrease)

  Scenario: All-null numeric column imputes to mean 0
    Given every usable listing has rooms = null
    When I fit the model
    Then means.rooms = 0 and the model still trains

  Scenario: predict() with an unseen sector behaves as the dropped reference level
    Given a fitted model whose training sectors are [Botanica, Centru]
    When I predict for a sample with sector = "Telecentru" (unseen)
    Then no sector dummy fires and it is priced as the reference (Botanica)

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 1: Market Signals – DOM & Absorption
  # ──────────────────────────────────────────────────────────────────────────
  # Spec: src/lib/market-signals.ts

  Background:
    Given realized DOM = (delistedAt − firstSeenAt) for closed listings only
    And absorption = activeInventory ÷ delistsTrailing4wk (null when no recent delists)
    And snapshots are written only when 999.md HTML hash changes (no-change → no row)

  Scenario: Realized DOM computed for delisted listings only
    Given a closed listing: firstSeenAt=2026-05-01, delistedAt=2026-05-15
    When I compute its realized DOM
    Then DOM = 14 days
    And null DOM is returned for active listings (delistedAt=null)

  Scenario: Median DOM across a segment
    Given 3 closed listings with DOMs [10, 14, 18] days
    When I compute median DOM
    Then median = 14 days

  Scenario: Absorption computes months of supply
    Given 40 active listings and 8 delists in trailing 4 weeks
    When I compute absorption months
    Then absorption = 40 ÷ 8 = 5 months

  Scenario: Absorption returns null when no recent delists
    Given 40 active listings and 0 delists in trailing 4 weeks
    When I compute absorption months
    Then result is null

  Scenario: Price-drop detection finds first observed cut
    Given snapshots: [€100k (May 1), €100k (May 3, hash same → no row), €95k (May 5)]
    When I compute timeToFirstCutDays from May 1
    Then result = 4 days (May 1 → May 5, first observed cut)

  Scenario: No price cuts observed returns null
    Given all snapshots have stable prices
    When I compute timeToFirstCutDays
    Then result is null

  Scenario: Realized DOM clamps clock-skew (delisted before firstSeen) to 0
    Given a closed listing: firstSeenAt=2026-05-15, delistedAt=2026-05-01
    When I compute its realized DOM
    Then DOM = 0 (Math.max(0, ...) clamp, never negative)

  Scenario: medianDomClosed returns 0 when no listing has closed
    Given only active listings (all delistedAt = null)
    When I compute median DOM closed
    Then result is 0 (not null)

  Scenario: Re-list at the same price is not counted as a cut
    Given snapshots: [€100k (May 1), €100k (May 5)]
    When I compute timeToFirstCutDays from May 1
    Then result is null (strict < comparison, equal is not a cut)

  Scenario: Null-price snapshots are skipped without breaking the comparison
    Given snapshots: [€100k (May 1), null (May 3), €95k (May 5)]
    When I compute timeToFirstCutDays from May 1
    Then result = 4 days (null row skipped, May 1 vs May 5 still compared)

  Scenario: Turnover ratio is delists over average inventory
    Given 12 delists and average inventory 48
    When I compute turnover ratio
    Then result = 0.25

  Scenario: Turnover ratio returns null when average inventory is non-positive
    Given 5 delists and average inventory 0
    When I compute turnover ratio
    Then result is null

  Scenario: Repricing velocity of a single price is 0
    Given prices [€100k]
    When I compute repricing velocity
    Then result is 0 (fewer than 2 points)

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 1: Market Signals – Repricing & Premium
  # ──────────────────────────────────────────────────────────────────────────

  Scenario: Repricing velocity is mean of consecutive deltas
    Given prices over time: [€100k, €95k, €90k, €92k]
    When I compute repricing velocity
    Then velocity = (−5k − 5k + 2k) ÷ 3 = −2.67k EUR/interval (cutting on average)

  Scenario: New-listing premium compares fresh vs standing
    Given fresh listings (< 2 weeks): median €/m² = 800
    And standing inventory: median €/m² = 750
    When I compute new-listing premium
    Then premium = 800 ÷ 750 = 1.067 (fresh asks 6.7% higher)

  Scenario: New-listing premium returns null when standing median is zero
    Given standing €/m² = 0
    When I compute new-listing premium
    Then result is null

  Scenario: Seller mix classifies listing sources
    Given 10 listings: 3 agency, 5 private, 2 untagged
    When I compute seller mix
    Then { agency: 0.3, private: 0.5, unknown: 0.2 }

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 1: Segmentation & Statistics
  # ──────────────────────────────────────────────────────────────────────────

  Background:
    Given price bands are fixed: <40k, 40–70k, 70–100k, 100–150k, 150k+
    And segments with < 5 valid listings (priceEur != null, areaSqm != null, areaSqm > 0 — NOTE priceEur is not required positive) are suppressed
    And segments group by (sector, rooms, priceBand, month)

  Scenario: Listings are bucketed by price band
    When I compute price bands for prices:
      | price   | band      |
      | €30k    | <40k      |
      | €50k    | 40-70k    |
      | €85k    | 70-100k   |
      | €120k   | 100-150k  |
      | €200k   | 150k+     |
      | null    | unknown   |
    Then all match expected bands

  Scenario: Segment stats suppress noise (< 5 listings)
    Given 3 valid listings in Centru + 3-rooms + 70-100k
    When I compute segment stats
    Then that segment is omitted from results (too small)

  Scenario: Segment stats compute median €/m² and IQR
    Given 5 Centru-3room-70-100k listings with €/m²: [650, 700, 750, 800, 850]
    When I compute segment stats
    Then median €/m² = 750
    And IQR (Q3 − Q1) = 850 − 700 = 150

  Scenario: Segment stats include seller mix
    Given a segment with 40% agency, 50% private, 10% unknown
    When I compute segment stats
    Then the row includes sellerMix { agency: 0.4, private: 0.5, unknown: 0.1 }

  Scenario: Segments span four dimensions
    When I segment listings by (sector, rooms, priceBand, month)
    Then each row has keys: { sector: "Centru", rooms: "3", priceBand: "70-100k", month: "2026-05" }

  Scenario: segmentStats counts a zero or negative priceEur as a valid sample
    Given 5 listings with valid areaSqm where one has priceEur = 0
    When I compute segment stats
    Then count = 5 (validity requires priceEur != null and areaSqm > 0, NOT priceEur > 0)
    And that row's €/m² for the zero-price listing is 0, pulling the median down

  Scenario: Listing with null areaSqm is excluded from a segment count
    Given 5 listings, one with areaSqm = null
    When I compute segment stats
    Then count = 4 and the segment is suppressed (below floor of 5)

  Scenario: medianDomClosed is null for a segment with no closed listings
    Given a 5-listing segment where all are still active
    When I compute segment stats
    Then the row's medianDomClosed is null

  Scenario: month dimension uses UTC year-month
    Given a listing firstSeenAt = 2026-05-31T23:30:00Z
    When I segment by month
    Then the month key is "2026-05" (UTC, not local Chișinău time)

  # ──────────────────────────────────────────────────────────────────────────
  # ── PHASE 6: Market Temperature Index
  # ──────────────────────────────────────────────────────────────────────────
  # Spec: src/lib/market-index.ts

  Background:
    Given market temperature z-blends 5 components with directional signs:
    Given components: medianDomClosed, absorptionMonths, distressShare, inventory, newListingPremium
    Given directions: lower DOM/absorption/distress/inventory → hotter (−z), higher premium → hotter (+z)
    Given power classification: score > +0.5 → sellers, score < −0.5 → buyers, else balanced

  Scenario: Temperature score is mean of signed z-scores
    Given 5 segments with z-scores: [-1, -0.5, 0, 0.5, 1] per component
    When I compute mean signed z-score
    Then temperatureScore = 0 (balanced market)

  Scenario: Lower DOM pulls temperature down (hotter)
    Given segment with medianDomClosed = 10 days (z = -1 lower than peer median)
    When I apply sign (-1) to DOM component
    Then contribution = -1 × -1 = +1 (hotter)

  Scenario: Higher new-listing premium pulls temperature up (hotter)
    Given segment with newListingPremium = 1.15 (z = +0.8 higher)
    When I apply sign (+1) to premium component
    Then contribution = +1 × +0.8 = +0.8 (hotter)

  Scenario: Null components are imputed to mean (neutral)
    Given some segments with null absorptionMonths
    When I compute z-scores for absorption
    Then missing values are replaced by the non-null mean
    And those segments' z = 0 (neutral impact)

  Scenario: Segments sorted by temperature descending (hottest first)
    Given temperatures: [+0.8 (Centru), -0.3 (Botanica), +0.1 (Râșcani)]
    When I sort
    Then order = [Centru, Râșcani, Botanica]

  Scenario: Power is classified by threshold
    Given powerThreshold = 0.5
    When scores are [+0.8, +0.2, -0.3, -0.7]:
    Then power = [sellers, balanced, balanced, buyers]

  Scenario: Summary counts segments by power
    Given 8 segments: 3 sellers, 2 balanced, 3 buyers
    When I compute summary
    Then result = { sellers: 3, balanced: 2, buyers: 3 }

  Scenario: Empty segment set returns empty result without throwing
    Given an empty segments array
    When I compute market temperature
    Then result = { segments: [], summary: { buyers: 0, balanced: 0, sellers: 0 } }

  Scenario: temperatureScore is rounded to 3 decimals
    Given a segment whose blended score is 0.123456
    When I read its temperatureScore
    Then it equals 0.123

  Scenario: Power boundary is strict at exactly the threshold
    Given powerThreshold = 0.5 and a segment score of exactly 0.5
    When I classify power
    Then power is "balanced" (strict > / < comparison, equal is balanced)

  Scenario: Nulls impute to the mean of present values, not a global constant
    Given absorptionMonths across segments = [2, 4, null]
    When I compute the imputed series
    Then the null is replaced by 3 (mean of [2, 4]), then z-scored

  Scenario: distressShare and inventory are never imputed
    Given segments with numeric distressShare and inventory and some null DOM
    When I compute component z-scores
    Then only medianDomClosed, absorptionMonths, newListingPremium can be imputed
    And distressShare and inventory use their raw values directly

  # ──────────────────────────────────────────────────────────────────────────
  # ── Integration: Analytics Routes
  # ──────────────────────────────────────────────────────────────────────────
  # Spec: src/web/routes/analytics.ts (HTTP adapter)

  Scenario: Analytics overview computes KPI panel
    Given a filtered dataset (price, area, sector, rooms)
    When I call GET /api/analytics/overview
    Then response includes:
      | kpi                | type          |
      | medianEurPerSqm    | number        |
      | activeInventory    | number        |
      | medianDomDays      | number        |
      | bestDealsCount     | number        |
      | absorptionMonths   | number \| null |
      | repriceVelocity    | number        |
      | newListingPremium  | number \| null |
      | sellerMix          | SellerMix     |

  Scenario: Best-buys route scores listings via hedonic + DOM + drop signals
    Given a dataset with fitted hedonic model
    When I call GET /api/analytics/best-buys
    Then each listing has:
      | field      | source                                    |
      | discount   | residual pct (actual − predicted) / predicted |
      | z          | z-score within cohort                     |
      | daysOnMkt  | from firstSeenAt                          |
      | priceDrop  | boolean (first cut observed?)              |
      | score      | composite of discount + DOM + drop        |

  Scenario: Price-drops route returns recent cut transactions
    Given snapshots with observed price cuts
    When I call GET /api/analytics/price-drops
    Then each row shows:
      | field   | value                                |
      | dropPct | (priceWas − priceEur) / priceWas    |
      | when    | capturedAt of the drop observation  |

  Scenario: Market-index route returns temperature + power per segment
    Given fitted market signals per segment
    When I call GET /api/analytics/market-index
    Then result includes:
      | field              | type                  |
      | segments[]         | TemperatureRow[]      |
      | segments[].power   | 'sellers' \| 'balanced' \| 'buyers' |
      | summary            | { sellers, balanced, buyers } |

  # ──────────────────────────────────────────────────────────────────────────
  # ── Error Handling & Degradation
  # ──────────────────────────────────────────────────────────────────────────

  Scenario: Hedonic singularity is gracefully degraded
    Given a dataset that produces a singular XᵀX matrix at λ=1e-6
    When I fit the model with λ escalation
    Then either a valid model is returned or null (not an exception)

  Scenario: Route returns partial results on missing hedonic
    Given /best-buys called but hedonic fit returns null
    When I return the response
    Then listings are ranked by alternate signals (DOM, price drop)
    And residual-based scoring is omitted

  Scenario: Null snapshots don't break price-drop logic
    Given a listing with no snapshots or only one snapshot
    When I call /price-drops
    Then that listing is omitted (no drop observed)

  Scenario: Segment < 5 listings is silently dropped
    Given a segment with 3 valid listings
    When I compute segment stats
    Then that segment is not included in the response (noise)

  Scenario: Zero variance in a z-score component is neutral
    Given all segments have identical medianDomClosed (no spread)
    When I compute z-scores for that component
    Then all z = 0 (component contributes nothing to temperature)
