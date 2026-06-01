# Specification: Classification, Hedonic & Market Signals

## Purpose & Scope

The Classification, Hedonic & Market Signals subsystem enriches raw listing data with derived classification metadata (listing type, sector, type mismatches), computes statistical pricing models (hedonic regression of log-price on attributes), and derives market-assessment signals (days-on-market, price dynamics, absorption, inventory heat). These pure-function libraries (no I/O, no Prisma calls) form the backbone of the Operator UI's Analytics pages and power best-buy scoring and market-temperature visualization. The subsystem is designed for read-time classification (detectType, deriveSector) and batch analytics (fitHedonic, marketTemperature, segmentStats).

## Architecture & Key Modules

| File Path                           | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/listing-classification.ts` | Type detection (Duplex/Townhouse/Villa vs House), region-mismatch flagging (non-Chișinău municipality), negation/proximity filtering. Exports `detectType()`, `classifyListing()`, `isRegionMismatch()`, `isMunicipalityLocality()`.                                                                                                                                                                                                                                                    |
| `src/lib/listing-type.ts`           | Listing type alias and rooms bucketing (1–2, 3, 4, 5+). Thin wrapper over `listing-classification.ts::detectType`.                                                                                                                                                                                                                                                                                                                                                                      |
| `src/lib/chisinau-sector.ts`        | City-sector inference via keyword/gazetteer matching (Centru, Botanica, Râșcani, Ciocana, Buiucani, Telecentru, Sculeni, Poșta Veche, Aeroport — 9 values in `CHISINAU_SECTORS`). Exports `deriveSector()`, `CHISINAU_SECTORS`, `ChisinauSector`, ordered by specificity (Telecentru before Centru). Returns null for out-of-city or unclassifiable. **District gate is strict `=== 'Chișinău'`** (diacritic-sensitive, not folded), distinct from the folded `isMunicipalityLocality`. |
| `src/lib/hedonic.ts`                | Ridge OLS regression of log(price) on area + rooms + yearBuilt + one-hot(sector, heating, type). Exports pure linear algebra (matrix ops, Gauss-Jordan invert), `fitHedonic()` (trains model on usable samples), `residualPct()` (mispricing % = (actual−predicted)/predicted). Low-level validation: escalates λ on singular matrices.                                                                                                                                                 |
| `src/lib/market-signals.ts`         | Statistical helpers (median, stddev, percentile, IQR) and analytics (realizedDomDays, medianDomClosed, absorptionMonths, turnoverRatio, repricingVelocity, timeToFirstCutDays, newListingPremium, sellerMix, segmentStats). Exports price bands (<40k, 40–70k, 70–100k, 100–150k, 150k+). Core data: DomInput, SnapshotPoint, SegmentListing, SegmentRow.                                                                                                                               |
| `src/lib/market-index.ts`           | Market-temperature composite: z-blends DOM, absorption, distress-share, inventory, fresh-ask premium into one per-segment score. Exports `marketTemperature()` (returns sorted TemperatureRow[] + summary counts). Components are directional (lower medianDomClosed → hotter, higher newListingPremium → hotter).                                                                                                                                                                      |
| `src/web/routes/analytics.ts`       | HTTP adapter: binds Prisma queries to market-signals library, applies user filters (price, area, sector, rooms, favorites, excluded-toggle), computes KPI overview (kpis object) and specialized routes (/best-buys, /price-drops, /market-index).                                                                                                                                                                                                                                      |

## Data Flow / Control Flow

### Read-time Classification (per-listing, at sweep-persist time)

1. **Crawl step** (`src/persist.ts`, `src/web/routes/listings.ts`): Raw listing arrives with title, description, district.
2. **Classify** (`listing-classification.ts::classifyListing`):
   - Call `detectType(title + description)` → DerivedType (House|Villa|Townhouse|Duplex)
   - Check `isRegionMismatch(district)` → boolean
   - Return Classification { derivedType, typeMismatch, regionMismatch, reasons[] }
3. **Infer sector** (`chisinau-sector.ts::deriveSector`):
   - If district != "Chișinău", return null
   - Scan title, street, description for sector keywords (aeroport, botanica, rîșcani, etc.)
   - Gazetteer fallback for named neighborhoods (schinoasa → Centru)
   - Return ChisinauSector | null
4. **Persist** to Listing.{ sector, derivedType?, typeMismatch?, regionMismatch? } — today stored in classification-like columns; future phases will add db columns for these derived values.

**Ordering guarantee:** Telecentru keyword is tested before Centru so "Telecentru" doesn't match "Centru" first.

### Batch Analytics (per-query, on-demand in analytics routes)

1. **Fetch data** (`analytics.ts` routes): Query Prisma for active/dedup-collapsed listings, snapshots, filter by user input (price, area, sector, etc.).
2. **Compute market signals** (`market-signals.ts`):
   - Build SegmentListing[] from rows
   - Segment by (sector, rooms, priceBand, month) via `segmentStats()`
   - For each segment: compute median €/m², IQR, seller-mix, median-DOM-closed
3. **Fit hedonic model** (`hedonic.ts::fitHedonic`):
   - Filter to usable (priceEur > 0, areaSqm > 0)
   - Mean-impute missing rooms/yearBuilt; missing categoricals → "∅"
   - One-hot encode sectors, heating types, listing types; drop reference level (first sorted)
   - Ridge OLS fit: β = (XᵀX + λI)⁻¹ Xᵀy, escalate λ on singular matrix
   - Return HedonicModel with predict(), coefficients[], R²
4. **Score listings** (best-buys route):
   - For each listing: predict price via hedonic → residualPct = (actual−predicted)/predicted
   - Compute z-score within cohort (same sector/type/rooms)
   - Combine signals: residual z, daysOnMkt z, priceDropFlag → composite score
5. **Compute market temperature** (`market-index.ts::marketTemperature`):
   - Per segment: z-score (medianDomClosed, absorptionMonths, distressShare, inventory, newListingPremium)
   - Apply directional signs: lower DOM/absorption/distress/inventory → hotter; higher premiums → hotter
   - Mean the signed z-scores → single score per segment
   - Classify power (sellers/balanced/buyers) based on powerThreshold (default 0.5)
   - Sort segments by score (hottest first)

**Async concurrency:** No async I/O in the pure libraries; Prisma queries in analytics.ts run serially within a single route handler (Hono middleware enforces this).

### Error Handling & Degradation

- **Singular matrix on hedonic fit:** Escalate λ (1e-6 → 1e-4 → 1e-2 → 1). Null return if all fail.
- **Missing data in segments:** A row counts toward a segment's `count` (and €/m²) only when `priceEur != null && areaSqm != null && areaSqm > 0`. NOTE: unlike `fitHedonic`, `segmentStats` does **not** require `priceEur > 0` — a zero or negative `priceEur` still counts as a valid sample and produces a 0 or negative €/m² (`code: market-signals.ts:222-225`). Segments with fewer than `SMALL_SAMPLE_FLOOR` (5) valid samples are suppressed. `medianDomClosed` per segment is computed over `delistedAt != null` members and is `null` when none have closed.
- **Null snapshots on price history:** `timeToFirstCutDays` returns null if no drop observed (not a fetal error, expected for stable prices).
- **Unclassifiable sector:** Return null from `deriveSector()`; nullable sector field in Listing.
- **Out-of-municipality district:** `isRegionMismatch()` flags mismatch; `deriveSector()` returns null (no sector if not Chișinău proper).

## Contracts & Types

### Classification API

```typescript
// src/lib/listing-classification.ts
type DerivedType = 'House' | 'Villa' | 'Townhouse' | 'Duplex';

interface Classification {
  derivedType: DerivedType;
  typeMismatch: boolean; // derivedType !== 'House'
  regionMismatch: boolean; // district not in Chișinău municipality
  reasons: string[]; // e.g., ["type: duplex", "region: Ialoveni"]
}

function classifyListing(input: {
  title: string;
  description: string | null;
  district: string | null;
}): Classification;

function detectType(haystack: string): DerivedType;
function isRegionMismatch(district: string | null): boolean;
function isMunicipalityLocality(district: string | null): boolean;
```

### Sector Inference API

```typescript
// src/lib/chisinau-sector.ts
type ChisinauSector =
  | 'Centru'
  | 'Botanica'
  | 'Râșcani'
  | 'Ciocana'
  | 'Buiucani'
  | 'Telecentru'
  | 'Sculeni'
  | 'Poșta Veche'
  | 'Aeroport';

function deriveSector(input: {
  district: string | null;
  street: string | null;
  title: string | null;
  description: string | null;
}): ChisinauSector | null;
```

### Listing Type API

```typescript
// src/lib/listing-type.ts
type ListingType = DerivedType; // alias
type RoomsBucket = '1–2' | '3' | '4' | '5+';

function deriveType(title: string): ListingType;
function roomsBucket(rooms: number | null): RoomsBucket;
```

### Hedonic API

```typescript
// src/lib/hedonic.ts
interface HedonicSample {
  priceEur: number | null;
  areaSqm: number | null;
  rooms: number | null;
  yearBuilt: number | null;
  sector: string | null;
  heatingType: string | null;
  type: string | null;
}

interface HedonicModel {
  featureNames: string[]; // ['intercept', 'areaSqm', 'rooms', ...]
  coefficients: number[]; // fitted β
  sectors: string[]; // sorted unique; first is reference (dropped from X)
  heatingTypes: string[]; // sorted unique
  types: string[]; // sorted unique
  means: { rooms: number; yearBuilt: number };
  n: number; // usable sample count
  rSquared: number; // 0–1
  predict(sample: HedonicSample): number | null; // EUR (exp of log-pred) or null if areaSqm == null || areaSqm <= 0
}

function fitHedonic(samples: HedonicSample[], lambda?: number): HedonicModel | null; // lambda default 1e-6, is the 1st escalation step
function residualPct(actual: number, predicted: number): number; // (actual−pred)/pred; returns 0 when predicted <= 0
```

### Market Signals API

```typescript
// src/lib/market-signals.ts
const PRICE_BANDS = ['<40k', '40-70k', '70-100k', '100-150k', '150k+'];
type PriceBand = (typeof PRICE_BANDS)[number] | 'unknown';

interface DomInput {
  firstSeenAt: Date;
  delistedAt: Date | null;
}

interface SegmentListing {
  sector: string | null;
  rooms: number | null;
  priceEur: number | null;
  areaSqm: number | null;
  sellerType: string | null;
  firstSeenAt: Date;
  delistedAt: Date | null;
}

interface SegmentRow {
  key: Record<string, string>; // e.g., { sector: 'Centru', rooms: '3' }
  count: number; // sample size (€/m² valid listings)
  medianEurPerSqm: number;
  iqrEurPerSqm: number;
  sellerMix: SellerMix;
  medianDomClosed: number | null;
}

// Core stats
function realizedDomDays(l: DomInput): number | null; // floor((delisted-firstSeen)/day), clamped >= 0; null while active
function medianDomClosed(listings: DomInput[]): number; // Math.round(median(...)); 0 when no closed listings
function absorptionMonths(activeInventory: number, delistsTrailing4wk: number): number | null;
function turnoverRatio(delists: number, avgInventory: number): number | null; // delists/avgInventory; null when avgInventory <= 0
function repricingVelocity(prices: number[]): number; // 0 when prices.length < 2
function timeToFirstCutDays(firstSeenAt: Date, snapshots: SnapshotPoint[]): number | null;
function newListingPremium(freshEurPerSqm: number[], standingEurPerSqm: number[]): number | null;
function segmentStats(listings: SegmentListing[], dims: SegmentDim[]): SegmentRow[];

// Seller classification
interface SellerMix {
  agency: number;
  private: number;
  unknown: number;
} // fractions
function sellerMix(sellerTypes: (string | null)[]): SellerMix;
```

### Market Index API

```typescript
// src/lib/market-index.ts
interface SegmentComponents {
  key: string;
  inventory: number;
  medianDomClosed: number | null;
  absorptionMonths: number | null;
  distressShare: number;
  newListingPremium: number | null;
}

type MarketPower = 'buyers' | 'balanced' | 'sellers';

interface TemperatureRow {
  key: string;
  temperatureScore: number; // mean of signed z-scores; >0 hotter
  power: MarketPower;
  inventory: number;
}

interface MarketIndexResult {
  segments: TemperatureRow[]; // sorted by score desc
  summary: Record<MarketPower, number>;
}

function marketTemperature(
  segments: SegmentComponents[],
  opts?: MarketIndexOptions,
): MarketIndexResult;

function zScores(values: number[]): number[];
```

## Invariants & Business Rules

### Type Detection

- **Priority ordering:** Duplex > Townhouse > Villa > (default House). If a listing mentions both "duplex" and "townhouse", report Duplex (more specific).
- **Negation filtering:** A phrase like "nu este duplex" or "lângă un townhouse" cancels the match. The negation cue set is exactly `(nu\s+e(?:ste)?|f[ăa]r[ăa]|l[âaî]ng[ăa]|vecin[ăa]tate|al[ăa]turi|aproape\s+de)(?![a-zăâîșț])` (`code: listing-classification.ts:19-20`) and must appear in the **last 40 chars before** the matched keyword (`textBeforeMatch.slice(-40)`, `code: listing-classification.ts:25`). Only the _first_ matching type rule is negation-checked: if Duplex matches but is negated, detection `continue`s to the next rule (Townhouse, …), so a negated higher-priority keyword does not block a genuine lower-priority match (`code: listing-classification.ts:29-35`).
- **Word boundary:** Duplex/Townhouse use `\b` (ASCII). `Townhouse` regex is `\btown\s?house\b|таунхаус` — optional single space, plus the Cyrillic alias. `Villa` uses `\bvil[aă]` with trailing lookahead `(?![a-zăâîșț])` instead of `\b` (ASCII `\b` does not fire after `ă`), matching "vila"/"vilă" but not "vilante". The negation cue uses the same trailing lookahead.
- **detectType scans the full haystack:** `classifyListing` passes title+description, but the standalone `deriveType(title)` (`code: listing-type.ts:6-8`) passes title only — a type cue present only in the description is invisible to `deriveType`.

### Region Classification

- **Fold invariant:** Diacritic normalization must be idempotent: `fold(fold(s)) === fold(s)`. Replaces â/î → i, then strips combining marks (NFD), then collapses alphanumeric runs.
- **Municipality allowlist:** Exactly 33 folded locality strings (`MUNICIPALITY_LOCALITIES`, `code: listing-classification.ts:54-88`) — Chișinău proper plus its towns, communes, and dependent villages. Any district whose fold is not in this set is a mismatch. **Null district is NOT a mismatch** (`isRegionMismatch` returns false), and a district that folds to the empty string (e.g. punctuation-only) is also NOT a mismatch (`code: listing-classification.ts:95-98`).
- **`isMunicipalityLocality` is the positive complement, not the strict negation:** it returns false for null AND for empty-fold input, and true only when the folded string is in the allowlist (`code: listing-classification.ts:104-108`). So both `isRegionMismatch(null)` and `isMunicipalityLocality(null)` are false — null is neither in-municipality nor a mismatch.
- **`classifyListing` haystack:** concatenates `title + " \n " + (description ?? '')` before `detectType`; the `reasons` entry for a region mismatch uses the **raw, unfolded** district string (`region: ${input.district}`), while the type reason is the lowercased derived type (`code: listing-classification.ts:122-131`).

### Sector Inference

- **Three-level fallback:** (1) explicit `sect(or(ul)?)?.?\s*<sector>` pattern → re-matched against KEYWORDS to resolve the sector, (2) bare keywords anywhere in `street+title+description` (Telecentru before Centru), (3) GAZETTEER (`schinoasa`, `valea morilor` → Centru — only 2 entries, `code: chisinau-sector.ts:36-39`).
- **Exact, diacritic-sensitive district gate:** the guard is `input.district !== 'Chișinău'` — a **strict string equality, NOT folded** (`code: chisinau-sector.ts:47`). So `"chisinau"`, `"Chisinau"` (no diacritics), `"CHIȘINĂU"`, or any town/commune (`"Durlești"`, `"Codru"`) returns null. Only the exact string `"Chișinău"` proceeds to keyword inference. This is intentionally stricter than `isMunicipalityLocality`.
- **Empty-haystack short-circuit:** after the district gate, if `street/title/description` are all null/empty, returns null before any regex (`code: chisinau-sector.ts:48-49`).
- **Telecentru/Centru ordering:** KEYWORDS lists Telecentru before the bare-Centru rule (`\bcentru\b|\bцентр\b`) so "Telecentru" is not shadowed. The Centru rule alone uses `\b` anchors; the other keyword rules (botanica, ciocana, …) are unanchored substring matches.
- **KEYWORDS coverage vs CHISINAU_SECTORS:** the explicit-pattern alternation does NOT include `aeroport`'s gazetteer fallback, but `Aeroport`, `Sculeni`, and `Poșta Veche` ARE in the bare-keyword KEYWORDS list. There is no keyword/gazetteer entry that can ever return some sectors via the explicit pattern that the bare list can't — the explicit branch only narrows, never adds.

### Hedonic Modeling

- **Log-space target:** All models predict log(price), so residuals are naturally percentage-like and the model is multiplicative (a +€10k effect scales).
- **One-hot encoding:** Levels are the sorted-unique set of `cat(value)`; the first sorted level is the dropped reference so the intercept is identified (`code: hedonic.ts:208-215`). `cat()` maps null **and whitespace-only** strings to the "∅" level (`value && value.trim().length > 0 ? value : MISSING`, `code: hedonic.ts:124-126`) — so `""`, `"  "`, and null collapse to the same category. Because "∅" sorts after most letters but the reference is the _first_ sorted level, "∅" is usually a non-reference dummy, not the dropped baseline.
- **Ridge regularization:** λ defaults to 1e-6 but escalates on singular matrix. The escalation sequence is `[lambda, 1e-4, 1e-2, 1]` where `lambda` is the _caller-supplied first step_ (`code: hedonic.ts:78`), NOT a hardcoded 1e-6. With the default this is `[1e-6, 1e-4, 1e-2, 1]`; passing a larger λ (e.g. 0.5) yields `[0.5, 1e-4, 1e-2, 1]`, which can _decrease_ on the second step. `invert()` throws `Error('matrix is singular')` when a pivot magnitude is `< 1e-12` (`code: hedonic.ts:56`); `fitWithEscalatingRidge` catches that and retries the next λ. If all four fail, `fitHedonic` returns null (not a fatal error).
- **Minimum usable samples:** Need ≥ 2 listings with `priceEur != null && priceEur > 0 && areaSqm != null && areaSqm > 0` (`code: hedonic.ts:139-143`). Mean-impute missing rooms/yearBuilt; if _all_ usable rows have a null rooms (or yearBuilt), the imputed mean is 0 (`mean([])` returns 0, `code: hedonic.ts:129`).
- **`predict()` null guard:** returns null when `sample.areaSqm == null || sample.areaSqm <= 0` (`code: hedonic.ts:187`); rooms/yearBuilt/categoricals are never required at predict time (they fall back to the training means / "∅" level). An unseen sector/heating/type at predict time matches no dummy and is treated as the dropped reference level.
- **`residualPct` guard:** returns 0 (not NaN / −Infinity) when `predicted <= 0` (`code: hedonic.ts:204`), so a degenerate prediction reads as "fairly priced" rather than an extreme deal.

### Market Signals

- **Snapshot bias:** Price snapshots are only written when the HTML hash changes (999.md's raw content check). A price held flat logs no new row. `timeToFirstCutDays` therefore returns the first _observed_ cut, not necessarily the true first cut. This is expected and noted in code comments. Snapshots **must be pre-sorted by `capturedAt` ascending** — the function does not sort; null-`priceEur` snapshots are skipped and do not break the prev/next comparison (`code: market-signals.ts:128-138`). Strict `<` comparison: a re-list at the _same_ price is not a cut.
- **Negative-time clamps:** both `realizedDomDays` and `timeToFirstCutDays` wrap the day-delta in `Math.max(0, Math.floor(...))` (`code: market-signals.ts:78, 133`). A `delistedAt`/cut timestamp _before_ `firstSeenAt` (clock skew, backfill) yields 0, never a negative DOM.
- **`repricingVelocity` short series:** returns 0 when fewer than 2 prices (`code: market-signals.ts:111`); it does not skip null entries (callers pass already-cleaned numbers).
- **`medianDomClosed`/`absorptionMonths` zero semantics:** `medianDomClosed` returns 0 (not null) when no listing has closed; `absorptionMonths` returns null when `delistsTrailing4wk <= 0` (treated as "undefined", not "infinite supply") (`code: market-signals.ts:84, 97`).
- **Segment floor:** Segments with < 5 valid samples (`priceEur != null && areaSqm != null && areaSqm > 0`) are suppressed as noise.
- **Null imputation for market temperature:** Missing components (medianDomClosed, absorptionMonths, newListingPremium — `distressShare` and `inventory` are non-null `number`s and never imputed) are imputed to the **mean of the present (non-null) values across the supplied segment set**, NOT to a global constant. If _every_ segment is null for a component, the imputed mean is 0 (`code: market-index.ts:79`). After imputation the series is z-scored, so a segment that was null lands at the component's mean → z=0 only when it equals the mean (which it does after imputation). This prevents missing data from artificially cooling/heating a segment.
- **`temperatureScore` rounding:** the blended mean-of-signed-z score is rounded to 3 decimals (`Math.round(score*1000)/1000`, `code: market-index.ts:105`) before power classification and sorting. Power thresholds compare the _unrounded_ score against `powerThreshold` — actually the rounded value is what is stored but classification uses the pre-round `score` (`code: market-index.ts:96-102`), a hair-splitting boundary case at exactly ±threshold.
- **Empty segment set:** `marketTemperature([])` returns `{ segments: [], summary: { buyers: 0, balanced: 0, sellers: 0 } }` — no throw (`code: market-index.ts:88-90`).
- **Power boundary:** classification is strict — `score > powerThreshold` → sellers, `score < -powerThreshold` → buyers, exactly ±threshold (and everything between) → balanced (`code: market-index.ts:98-102`).

## Edge Cases & Failure Modes

### What Breaks It

- **Empty input:** Empty haystack to detectType → return 'House' (default).
- **No usable samples in hedonic fit:** < 2 rows with priceEur > 0 and areaSqm > 0 → return null from fitHedonic.
- **Collinear categorical data:** One-hot dummies may be perfectly collinear with intercept (e.g., all listings in one sector). λ escalation handles this; if all λ values fail, return null.
- **All-zero variance in a component:** zScores returns all-zero when std=0 (no spread in medianDomClosed, for example). This is valid; the component contributes 0 to the temperature score.
- **Division by zero in market index:** absorptionMonths returns null when delistsTrailing4wk ≤ 0 (no recent delists); newListingPremium returns null when standing median ≤ 0.

### Degradation Paths

- **Hedonic singularity:** Escalate λ and retry; if unresolvable, skip hedonic scoring for that route (return best-buys without residual z-scores).
- **Snapshot missing:** timeToFirstCutDays returns null (expected); route skips that signal.
- **Sector unclassifiable:** Segment key has sector='unknown'; this is a valid category and gets one-hot encoded.
- **No closed listings:** medianDomClosed returns 0 (nothing to average); route reports as-is or skips that metric.

## Configuration & Operational Notes

### Environment & Defaults

- **No config keys needed.** Classification and market-signals are pure functions with no env-var dependencies.
- **Lambda escalation:** Built-in; no operator knob. λ starts at 1e-6 and escalates on singular matrix.
- **Market index power threshold:** Default 0.5 (±0.5 std dev between sellers/balanced/buyers). Passed via MarketIndexOptions; settable per call.
- **Segment floor:** SMALL_SAMPLE_FLOOR = 5 (hardcoded). Segments < 5 valid listings are silently dropped from output.

### Observability

- **R² reported:** HedonicModel.rSquared ∈ [0, 1]. Use to gauge fit quality (>0.7 is good).
- **z-scores:** Inspect TemperatureRow.temperatureScore; >0 hotter, <0 colder, ≈0 balanced.
- **Null returns:** fitHedonic, absorptionMonths, newListingPremium, deriveSector return null on degradation. Callers must handle gracefully.

## Acceptance Criteria

1. **Type detection** correctly identifies Duplex, Townhouse, Villa from title + description, respecting negation patterns and priority ordering.
2. **Region mismatch** flag is accurate for 33 municipality localities (all diacritics + spelling variants folded).
3. **Sector inference** returns correct ChisinauSector (9 values) or null for out-of-city; Telecentru not shadowed by Centru.
4. **Hedonic fit** trains on usable samples, outputs valid coefficients, and predict() returns reasonable EUR values.
5. **R² on hedonic model** is ≥0.60 on real dataset (50+ listings, diverse sectors).
6. **Market temperature** z-blends five components correctly: lower DOM/absorption/distress/inventory → hotter (negative z), higher premium → hotter (positive z). Score sorted descending. Power classification matches threshold.
7. **Segment stats** suppress noise (< 5 listings), compute accurate median €/m² and IQR, and include all four dimensions (sector, rooms, priceBand, month).
8. **Price bands** are fixed ranges for year-over-year trend stability: <40k, 40–70k, 70–100k, 100–150k, 150k+.
9. **All pure functions** return in <10ms on dataset of 500 listings (no blocking I/O, tight loops).
10. **Unit test coverage** ≥70% on lib functions; integration tests on analytics routes.
11. **No negative time:** `realizedDomDays` and `timeToFirstCutDays` never return a negative value (clock-skew clamps to 0).
12. **Strict guards hold:** `predict()` → null on null/≤0 area; `residualPct` → 0 on ≤0 predicted; `absorptionMonths`/`turnoverRatio`/`newListingPremium` → null on their zero-denominator cases; `marketTemperature([])` → empty result (no throw).
13. **Sector gate is exact:** only the literal `"Chișinău"` district yields a non-null sector; folded/diacritic-stripped variants and member towns/communes return null.
14. **segmentStats validity:** a sample counts iff `priceEur != null && areaSqm != null && areaSqm > 0`; `priceEur` is NOT required positive.

## Open Questions / Known Gaps

- **Distress scoring (Phase 2):** Lexicon-based flagging of "urgent sale", "motivated seller" cues in description. Not yet wired to market-index.
- **Cross-source dedup (Phase 2):** Listing.canonicalId is schema-ready but not populated; recomputeClusters() not yet implemented. Market signals assume 1:1 listing.
- **Seller identity (Phase 2):** Listing.authorId, authorName, phone are schema-ready but not yet captured. Seller-portfolio graph not built.
- **Geo-proximity dedup (Phase 2):** Listing.lat, lon parsed but not yet used. Proximity clustering not implemented.
- **Hot reload on Settings changes:** Hedonic coefficients are recomputed on every analytics route call (not cached). Cache-on-write (redis or in-memory) deferred to Phase 6.
- **Adaptive soft throttle:** Two-tier cadence plumbing (FetchTask, ThrottleEvent tables) is in place but observer logic not yet wired. Adaptive throttling deferred to PR 2 (after plumbing lands).
