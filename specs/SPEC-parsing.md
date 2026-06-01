# SPEC: HTML/GraphQL Parsing into Listings

## Purpose & Scope

Transform raw GraphQL responses from 999.md into normalized `Listing` domain objects. The parsing subsystem extracts index stubs (lightweight listing metadata from search) and full details (comprehensive field set including description, geo, seller identity, and filter taxonomy). It handles three stages: (1) JSON response validation and top-level extraction, (2) field-by-field normalization (price currency/unit stripping, Romanian date parsing, area regex from title, feature enumeration), and (3) deferred enrichment (filter taxonomy lookup, geo/author extraction, hash-stable fields for snapshot-on-change detection). Prices store both normalized (EUR-only) and raw forms; errors on a single listing do not abort the sweep.

## Architecture & Key Modules

| Module                    | Responsibility                                                                                                                                                                                                                                                                                                                                                                                          | Key Exports                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/parse-index.ts`      | Parse SearchAds GraphQL response into `ListingStub[]`. Index-time extraction only; no detail fetches.                                                                                                                                                                                                                                                                                                   | `parseIndex(json: unknown): ListingStub[]`                                                                                                                                                                                              |
| `src/parse-detail.ts`     | Parse GetAdvert GraphQL response into `ParsedDetail`. Full schema extraction, hash computation for snapshots, filter-value emission.                                                                                                                                                                                                                                                                    | `parseDetail(id: string, json: unknown): ParsedDetail`, `AdvertNotFoundError`                                                                                                                                                           |
| `src/parse-taxonomy.ts`   | Resolve `featureId → filterId` mapping from captured filter-taxonomy response or bootstrap fallback. Merges captured overrides with config anchors.                                                                                                                                                                                                                                                     | `bootstrapLutFromConfig(): TaxonomyLut`, `parseTaxonomyResponse(json: unknown): TaxonomyLut`, `mergeLuts(a, b): TaxonomyLut`                                                                                                            |
| `src/graphql.ts`          | GraphQL operation strings (SEARCH_ADS_QUERY, GET_ADVERT_QUERY, FILTER_TAXONOMY_QUERY) and variable builders. Stale-marked FILTER_TAXONOMY_QUERY as placeholder until live capture.                                                                                                                                                                                                                      | `SEARCH_ADS_QUERY`, `GET_ADVERT_QUERY`, `buildSearchVariables(pageIdx, override?)`, `buildAdvertVariables(id)`                                                                                                                          |
| `src/lib/listing-text.ts` | Behavioral text-mining: distress signal scanning (urgency, negotiable, price drops, exchange, installments), photo-quality inference from count, posting-hour histogram, bump-cadence regularity. Pure functions over already-stored fields. All time-of-day/weekend math uses **UTC** (`getUTCHours`/`getUTCDay`), NOT the Europe/Chisinau local TZ that `parseRoDate` uses — a deliberate divergence. | `normalizeText(text)`, `scanDistress(description)`, `photoQuality(imageCount)`, `isWeekend(date)`, `postingHourHistogram(dates)`, `bumpRegularity(bumpTimes)`, `DISTRESS_LEXICON`, `DistressCategory`, `DistressResult`, `PhotoQuality` |
| `src/lib/image-url.ts`    | Simpals CDN URL construction (`https://i.simpalsmedia.com/999.md/BoardImages/320x240/<filename>`) from stored filenames or pass-through of absolute URLs. Index already captures filenames; detail fields get formatted on retrieval.                                                                                                                                                                   | `thumbUrl(filename)`, `primaryThumb(imageUrls)`                                                                                                                                                                                         |
| `src/types.ts`            | Shared type definitions: `ListingStub`, `ParsedDetail`, `FilterValueTriple`. Mirror subset of Prisma `Listing` model to keep parsers decoupled from `@prisma/client`.                                                                                                                                                                                                                                   | `ListingStub`, `ParsedDetail`, `FilterValueTriple`, `FetchResult`, `SweepStatus`, `SweepError`                                                                                                                                          |
| `src/config.ts`           | Hardcoded filter anchors (region feature 7 / optionId 12900, sale feature 1 / optionId 776), politeness constants (8s base + 2s jitter, 10s detail gap, UA/headers), circuit breaker thresholds.                                                                                                                                                                                                        | `GRAPHQL_ENDPOINT`, `FILTER`, `POLITENESS`, `CIRCUIT`, `SWEEP`                                                                                                                                                                          |

## Data Flow / Control Flow

### Parse Index (SearchAds → ListingStub[])

1. **Fetch SearchAds** — caller invokes GraphQL with `buildSearchVariables(pageIdx)`, receives JSON response.
2. **Extract ads array** — validate `data.searchAds.ads` exists and is array; throw if missing.
3. **Map each ad to stub** — for each `RawAd`:
   - Extract `id`, `title`, compute `url` as `${FILTER.listingBaseUrl}/${id}`.
   - Normalize price: read `price.value.{value, unit}`, strip `UNIT_` prefix, keep only EUR as `priceEur`, store raw string in `priceRaw`.
   - Parse area from title regex `(\d+)\s*m²`, store as `areaSqm` (integer from first match or null).
   - Pass `postedAt: null` (index has no timestamp; detail fills it).
   - Collect `images.value[]` as `imageUrls` (CDN filenames, not yet URL-formatted).
4. **Return array** — sorted by index response order (descending by posting date, per SEARCH_ADS_QUERY's `SORT_ADS_DATE_DESC`).

**Invariants:**

- Every stub has a valid `id` and `url`.
- `priceEur` is null if unit ≠ EUR or price value is missing.
- `areaSqm` is int ≥ 0 or null; never negative or NaN.
- `imageUrls` are bare filenames (e.g. `"d870a….jpg"`, not full URLs).

### Parse Detail (GetAdvert → ParsedDetail)

1. **Fetch GetAdvert** — caller invokes with `buildAdvertVariables(id)`, receives JSON.
2. **Validate response** — check `data.advert` exists and is non-null; throw `AdvertNotFoundError` if null (404 case) or missing key.
3. **Extract scalar fields:**
   - `id`, `title`, `url` (same as index).
   - `state` (enum value, stored for snapshot hashing but not yet used).
   - **Price**: read `price.value.{value, unit}`, normalize as index; MDL/USD get `priceEur: null, priceRaw: "X MDL"`.
   - **Area**: same regex from title.
   - **Title fallback** — `title` defaults to `''` (empty string) when `advert.title` is absent, NOT null. Area regex then runs on `''` and yields null.
   - **Land area** (`landAre` in ares, feature 245) — calls `featureNumber()` which accepts BOTH `landArea.value === <number>` (FEATURE_INT) and `landArea.value.value === <number>` (wrapped) shapes; any non-number (string, object without numeric `.value`, missing) yields null.
   - **District** (`city.value.translated` — localized name of region, e.g. "Chișinău").
   - **Zone** (`zone.value.translated` — intra-city zone, feature 9; null if unset).
   - **Street** (`street.value`).
   - **Floors** (feature 249) — read option id from `floors.value.value`, map via `FLOOR_OPTION_TO_COUNT` {1641→1, 1643→2, 1644→3, 1652→4}; 1652 collapses 4+ to 4.
   - **Year built, heating type**: `yearBuilt: null, heatingType: null` (not in GraphQL yet; reserved for future field expansion).
   - **Description** (`body.value.ro` — Romanian locale; Russian ignored for listing text).
   - **Features** (`features: []` — no feature tags extracted yet; reserved).
   - **Images** (`images.value[]` — filenames).
   - **Seller type** (`sellerType: null` — inferred from `owner.business.plan` when wired).
   - **Posted/bumped** — call `parseRoDate(posted)` and `parseRoDate(reseted)` on strings like "26 apr. 2026, 18:34"; returns local `Date` or null.
4. **Extract geo** — call `extractGeo(advert)` on `mapPoint.value`:
   - `lat` tries keys in order: `lat`, `latitude`, `y`.
   - `lon` tries keys in order: `lon`, `lng`, `longitude`, `x` (note `lng` is included — Google-Maps style).
   - lat and lon are resolved **independently**; a payload can yield a valid lat with a null lon if only one key matches.
   - If `mapPoint.value` is missing or not an object, both are null.
   - Only `typeof === 'number' && Number.isFinite(n)` values pass; NaN/Infinity/string coords are rejected to null.
5. **Extract author** — call `extractAuthor(advert)` on `owner` Account:
   - `authorId` from `owner.id` (coerced to string or null).
   - `authorName` from `owner.login` (string or null).
   - `authorType` = `"agency"` if `owner.business.plan != null`, else `"private"` (only set if owner exists).
6. **Compute hash** — call `hashStableFields(advert)` over JSON.stringify of {title, state, priceValue, priceUnit, street, bodyRo}, sha256. Each absent field is coerced to `null` (so a missing title hashes as `null`, NOT the `''` used for the top-level `title` output field — the two coercions differ). **`priceUnit` in the hash is the RAW unit string** (`advert.price.value.unit ?? .measurement`), the `UNIT_`-prefixed form — it is NOT stripped the way `priceRaw`/`priceEur` strip it. So a unit-string change alone changes the hash.
7. **Extract filter values** — call `extractFilterValues(advert)`:
   - Walk all top-level keys of the advert object (this includes the `[key: string]: unknown` index, so every `feature(id:N)`-backed key the GraphQL query selected is examined: `price` (id 2), `region` (7), `city` (8), `zone` (9), `street` (10), `floors` (249), `landArea` (245), `offerType` (1), `pricePerMeter`, `oldPrice`, …).
   - Detect FeatureValue shape via `isFeatureEntry`: requires `typeof id === 'number'` AND `typeof type === 'string'` AND `type.startsWith('FEATURE_')` AND the key `'value'` is present. Anything failing all four is skipped.
   - Skip non-filter types: FEATURE_BODY, FEATURE_IMAGES, FEATURE_MAP_POINT.
   - Map each surviving entry to `FilterValueTriple` with `filterId: 0` (populated by persistence layer); emit optionId, textValue, or numericValue depending on type.
   - **Filter triples DUPLICATE several scalar fields by design.** `price`, `zone`, `floors`, `landArea`, `street`, `region`, `city`, `offerType` appear BOTH as dedicated scalar/geo fields on `ParsedDetail` AND as triples in `filterValues`. The persistence layer is the de-dup authority; the parser intentionally emits both. In particular `price` (FEATURE_PRICE, id 2) emits a triple with `numericValue` set — it is always present in `filterValues` when the advert has a price.
8. **Return ParsedDetail** — all fields merged, filterValues included for persistence.

**Invariants:**

- Hash is sha256 hex string (64 chars).
- Filter values have `featureId ≥ 1`, filterId starts at 0 (persistence layer resolves).
- `lat/lon` are finite numbers or null; never NaN or Infinity.
- Date fields (postedAt, bumpedAt) are local TZ (no UTC conversion — raw value from 999.md).

### Parse Taxonomy

1. **Bootstrap from config** — call `bootstrapLutFromConfig()` to seed {featureId → filterId} from `FILTER.searchInput.filters`.
2. **Parse captured response** — call `parseTaxonomyResponse(json)` on filter-taxonomy GraphQL response (shape TBD until live capture):
   - Recursively walk any object/array tree. A node contributes edges when it has a numeric `filterId` **or** numeric `id` (the `id` key is a fallback — `pickNumber(obj, ['filterId','id'])`) AND an array `features[]`.
   - For each feature element, the leaf id is `featureId` **or** `id` (`pickNumber(f, ['featureId','id'])`); non-numeric/non-finite ids are skipped.
   - Recursion continues into every value regardless, so nested filter groups are all visited.
   - Returns an **empty** `Map` (never throws) for unrecognized/garbage/empty input — the caller is expected to merge it over the bootstrap so an empty captured LUT is harmless.
3. **Merge** — call `mergeLuts(bootstrap, captured)` to combine; the **right-hand (second) argument wins** on conflict (so `mergeLuts(bootstrap, captured)` lets captured override the anchors).

**Invariants:**

- Only finite numeric ids are admitted (`Number.isFinite`); NaN/Infinity/string ids are skipped.
- `parseTaxonomyResponse` and `bootstrapLutFromConfig` both return a `ReadonlyMap<number, number>`; `mergeLuts` returns a fresh map and mutates neither input.
- Collision resolution is deterministic (right side of `mergeLuts` wins; last-writer-wins within a single walk).

## Contracts & Types

### Input: SearchAds GraphQL Response

```json
{
  "data": {
    "searchAds": {
      "ads": [
        {
          "id": "12345678",
          "title": "Casă, 140 m², Chișinău, 150 000 EUR",
          "price": {
            "value": {
              "value": 150000,
              "unit": "UNIT_EUR",
              "measurement": "UNIT_EUR"
            }
          },
          "images": {
            "value": ["d870a….jpg", "d870b….jpg"]
          }
        }
      ]
    }
  }
}
```

**Output: ListingStub[]**

```typescript
[
  {
    id: '12345678',
    url: 'https://999.md/ro/12345678',
    title: 'Casă, 140 m², Chișinău, 150 000 EUR',
    priceEur: 150000,
    priceRaw: '150000 EUR',
    areaSqm: 140,
    postedAt: null,
    imageUrls: ['d870a….jpg', 'd870b….jpg'],
  },
];
```

### Input: GetAdvert GraphQL Response

```json
{
  "data": {
    "advert": {
      "id": "12345678",
      "title": "Casă, 140 m², Colonița",
      "state": "published",
      "posted": "26 apr. 2026, 18:34",
      "reseted": "28 apr. 2026, 10:15",
      "price": {
        "value": {
          "value": 150000,
          "unit": "UNIT_EUR"
        }
      },
      "body": {
        "value": {
          "ro": "Casă frumoasă cu grădină mare…",
          "ru": "Красивый дом с большим садом…"
        }
      },
      "city": {
        "value": {
          "translated": "Chișinău"
        }
      },
      "zone": {
        "value": {
          "translated": "Rîșcani"
        }
      },
      "street": {
        "value": "Strada Marelui Voievod"
      },
      "floors": {
        "value": {
          "value": 1643
        }
      },
      "landArea": {
        "value": 80
      },
      "mapPoint": {
        "value": {
          "lat": 47.123,
          "lon": 28.456
        }
      },
      "images": {
        "value": ["d870a….jpg"]
      },
      "owner": {
        "id": 54321,
        "login": "seller_name",
        "business": {
          "plan": "premium"
        },
        "verification": {
          "isVerified": true
        }
      }
    }
  }
}
```

**Output: ParsedDetail**

```typescript
{
  id: "12345678",
  url: "https://999.md/ro/12345678",
  title: "Casă, 140 m², Colonița",
  priceEur: 150000,
  priceRaw: "150000 EUR",
  rooms: null,
  areaSqm: 140,
  landAre: 80,
  district: "Chișinău",
  zone: "Rîșcani",
  street: "Strada Marelui Voievod",
  floors: 2,
  yearBuilt: null,
  heatingType: null,
  description: "Casă frumoasă cu grădină mare…",
  features: [],
  imageUrls: ["d870a….jpg"],
  sellerType: null,
  postedAt: Date("2026-04-26T18:34:00.000Z"), // local TZ, no offset
  bumpedAt: Date("2026-04-28T10:15:00.000Z"),
  lat: 47.123,
  lon: 28.456,
  authorId: "54321",
  authorName: "seller_name",
  authorType: "agency",
  phone: null,
  rawHtmlHash: "abc123…",
  filterValues: [
    // NOTE: filterValues also re-emits price/zone/street/floors/landArea/region/city/offerType
    // as triples — they intentionally duplicate the scalar fields above. Persistence de-dups.
    { filterId: 0, featureId: 2,   optionId: null, textValue: null, numericValue: 150000 }, // FEATURE_PRICE
    { filterId: 0, featureId: 245, optionId: null, textValue: null, numericValue: 80 },
    { filterId: 0, featureId: 249, optionId: 1643, textValue: null, numericValue: null },
    …
  ]
}
```

### Error Types

- **`AdvertNotFoundError`** — extends Error, thrown when `data.advert` is null. Caller typically logs and skips that listing (continues sweep).
- **Validation errors** — generic Error on malformed JSON or missing top-level keys (data.searchAds.ads, data.advert). Cause: schema drift at 999.md or network corruption.

## Invariants & Business Rules

1. **Price normalization is strict:** Only `unit === "EUR"` (after stripping `UNIT_` prefix) maps to `priceEur`. MDL/USD/other currencies get `priceEur: null` and store raw in `priceRaw` for audit trail.

2. **Area extraction from title is regex-only:** Pattern `(\d+)\s*m²` returns first integer match or null. Title may contain multiple areas (living area, land area); only the first m² mention is captured at parse time. Land area (feature 245) is a separate field.

3. **Floors are options, not raw counts:** 999.md feature 249 is a structured enum; the mapping {1641→1, 1643→2, 1644→3, 1652→4+} is hardcoded. Option IDs outside this set return null (no inference).

4. **Dates are local timezone, no offset:** `parseRoDate()` returns naive Date in local TZ matching Europe/Chisinau (docker-compose TZ env var). No UTC conversion happens at parse time. The matcher is the **anchored** regex `^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4}),\s+(\d{1,2}):(\d{2})$` (case-insensitive): the period after the month is **optional** (`"26 apr 2026, 18:34"` parses identically to `"26 apr. 2026, 18:34"`), and anchoring means any leading/trailing garbage rejects to null. Even on a regex match, an **unknown month abbreviation** (not in the `RO_MONTHS` lexicon `ian/feb/mar/apr/mai/iun/iul/aug/sep/oct/nov/dec`) returns null — this is a second guard beyond the regex. The text-mining layer in `lib/listing-text.ts`, by contrast, reads these dates with `getUTCHours`/`getUTCDay` — so histogram/weekend buckets are UTC, not Chisinau-local.

5. **Distress signals and metadata (P3) are computed post-persistence:** Text mining (`scanDistress`, `photoQuality`, `bumpRegularity`) runs over already-stored fields to avoid re-parsing on every fetch. These are optional feature-enhancements, not core parsing.

6. **Hash stability for snapshots:** `rawHtmlHash` is sha256 of a minimal field set {title, state, price, street, body.ro}. This skips timestamp-only bumps (no hash change if only `reseted` changed). Allows the persistence layer to omit redundant snapshots.

7. **Filter values emit `filterId: 0` as placeholder:** Persistence layer resolves each `featureId` to `filterId` via the taxonomy LUT. Parsers do not call the resolver — clean separation of concerns.

8. **Per-listing errors do not abort the sweep:** If `parseDetail(id)` throws on a single listing, the sweep continues; error is logged to `SweepRun.errors` and the listing is skipped. Only network/circuit breaker events abort the whole sweep.

9. **GraphQL operation/variable builders are pure string + object factories:** `buildSearchVariables(pageIdx, override?)` returns `{ input: { ...base, sort: 'SORT_ADS_DATE_DESC', pagination: { limit: FILTER.pageSize, skip: pageIdx * FILTER.pageSize } } }` where `base` is `override ?? FILTER.searchInput`. `buildAdvertVariables(id)` returns `{ input: { id } }`. Only `FILTER_TAXONOMY_QUERY` is a REPLACE-ME placeholder; `SEARCH_ADS_QUERY` and `GET_ADVERT_QUERY` are live-captured strings. `GET_ADVERT_QUERY` selects far more `feature(id:N)` keys (region 7, city 8, zone 9, street 10, offerType 1, pricePerMeter 1385, oldPrice 1640, …) than the parser reads into scalar fields — the surplus surfaces only via `extractFilterValues`.

10. **Text-mining behavior (`listing-text.ts`) is fully specified pure functions:** `scanDistress` normalizes via `normalizeText` (NFD + strip combining diacritics, lowercase, Cyrillic preserved), matches substring against `DISTRESS_LEXICON` across 5 categories (urgency/negotiable/reduced/exchange/installments), returns distinct **sorted** categories, `score` = count (0–5), `distressed` = score ≥ 1; null/empty description → empty result. `photoQuality`: ≤0 → `none`, ≤2 → `sparse`, ≤7 → `ok`, else `rich`. `bumpRegularity`: needs ≥3 timestamps else null; sorts, computes day-interval CV, returns `max(0, 1-CV)`; returns null when mean ≤ 0. `isWeekend`/`postingHourHistogram` operate on **UTC** day/hour.

11. **CDN URL construction (`image-url.ts`) is read-time, not parse-time:** Parsers store bare filenames; `thumbUrl(f)` returns null for empty, passes `https?://` absolutes through unchanged, else `https://i.simpalsmedia.com/999.md/BoardImages/320x240/<f>`. `primaryThumb` returns null unless input is a non-empty array whose first element is a string.

## Edge Cases & Failure Modes

| Scenario                                                                                                 | Behavior                                             | Rationale                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Missing `price.value.value`                                                                              | `priceEur: null, priceRaw: null`                     | Incomplete listing; store null rather than fail.                                                                            |
| Unknown price unit (e.g., "UNIT_GBP")                                                                    | `priceEur: null, priceRaw: "X GBP"`                  | Currency audit trail preserved; future filters can handle.                                                                  |
| Price present but `unit`/`measurement` both absent                                                       | `priceEur: null, priceRaw: "X ?"`                    | `stripUnitPrefix(undefined)` → undefined → `${value} ?` literal question-mark sentinel. priceEur stays null (no EUR match). |
| `price.value` exists but `price.value.value` is not a number (e.g. string)                               | `priceEur: null, priceRaw: null`                     | `typeof v?.value !== 'number'` short-circuits before unit parsing.                                                          |
| Title has no m² regex match                                                                              | `areaSqm: null`                                      | Optional field; many listings may lack area in title.                                                                       |
| `landArea` is string or nested differently than expected                                                 | `landAre: null`                                      | `featureNumber()` is defensive; never crashes on shape variance.                                                            |
| `mapPoint.value` has typos in key names (e.g., "latt" instead of "lat")                                  | `lat: null, lon: null`                               | `extractGeo()` tries multiple key aliases; returns nulls on no match.                                                       |
| `owner` is null or missing                                                                               | `authorId: null, authorName: null, authorType: null` | Accounts for private/anon listings; fields are nullable.                                                                    |
| Date string doesn't match "DD MMM. YYYY, HH:MM" regex                                                    | `postedAt: null` or `bumpedAt: null`                 | Schema drift or typo; null is safer than parsing wrong date.                                                                |
| Filter value is neither text nor number nor object                                                       | Skipped (toTriple returns null)                      | Defensive iteration; unknown feature types don't break the loop.                                                            |
| SearchAds response has `ads: null` instead of array                                                      | Throws Error, sweep catches and logs                 | Schema violation; not recoverable (abort this index page).                                                                  |
| GetAdvert response is 404 (advert not found)                                                             | Throws `AdvertNotFoundError`, sweep catches and logs | Listing may have delisted between index fetch and detail fetch; skip and continue.                                          |
| Image filename is already full URL                                                                       | `imageUrls` stored as-is (CDN logic passes through)  | Backward compat for manual test fixtures or older captures.                                                                 |
| Feature type is FEATURE_BODY or FEATURE_IMAGES                                                           | Skipped by extractFilterValues                       | Non-triple features stored elsewhere (description, imageUrls).                                                              |
| FeatureValue with object `value` whose inner `.value` is non-numeric, and `value` is not a string/number | `toTriple` returns null → skipped                    | Unrecognized FEATURE\_\* shape; defensive null rather than a malformed triple.                                              |
| `floors` option id present but not in `{1641,1643,1644,1652}`                                            | `floors: null`                                       | No inference for unmapped enum options.                                                                                     |
| `primaryThumb([])` or first element not a string                                                         | returns null                                         | Empty/dirty imageUrls → no thumbnail rather than a broken URL.                                                              |
| `thumbUrl` given an already-absolute `https?://` URL                                                     | returned unchanged (pass-through)                    | Backward compat for older rows / fixtures.                                                                                  |

## Configuration & Operational Notes

### Environment

- **`DATABASE_URL`** (Postgres connection) — used by persistence layer only, not by parsers.
- **`NODE_ENV`** — parsers ignore; no logging conditional on this.
- **`TZ=Europe/Chisinau`** (docker-compose) — affects `parseRoDate()` Date constructor behavior (naive dates use system TZ).

### Runtime Flags & Toggles

- **`FILTER.searchInput`** — mutable via Postgres `Setting('filter.generic')` key; read at sweep-start to pick the active filter override.
- **`SWEEP.backfillPerSweep`** — controls backfill detail fetch budget; 0 disables.
- **Taxonomy LUT fallback** — if captured taxonomy is stale/missing, bootstrap from config anchors (featureId 1, 7 anchors for sale/region).

### Hardcoded Anchors (Verified 2026-04-26)

- **Sale filter**: featureId 1, optionId 776 ("Vând").
- **Region filter**: featureId 7, optionId 12900 (Chișinău municipality).
- **Category**: subCategoryId 1406 (houses and gardens).
- **GraphQL endpoint**: `https://999.md/graphql`.
- **Listing URL base**: `https://999.md/ro/`.

### Sentinel Files & External Dependencies

- **`/data/.circuit_open`** — not involved in parsing, but sweep respects circuit breaker state.
- **`src/data/filter-taxonomy.json`** — captured taxonomy fixture (placeholder FILTER_TAXONOMY_QUERY until real capture lands).

## Acceptance Criteria

1. ✅ `parseIndex(json)` extracts ListingStub[] with correct id, url, title, priceEur (EUR-only), priceRaw, areaSqm, imageUrls (bare filenames).
2. ✅ `parseDetail(id, json)` extracts ParsedDetail with all scalar + geo + author fields; hash is stable across bumps.
3. ✅ Filter values emitted with featureId intact; filterId resolved by persistence (not parser).
4. ✅ Price normalization: EUR maps to priceEur; MDL/USD/unknown get priceEur=null, priceRaw stored.
5. ✅ Area regex `(\d+)\s*m²` extracts first integer or null; landAre (feature 245) is separate numeric field.
6. ✅ Floors (feature 249) map from optionId via hardcoded enum {1641→1, 1643→2, 1644→3, 1652→4}; unknown IDs return null.
7. ✅ Romanian dates "26 apr. 2026, 18:34" parse to local-timezone naive Date or null on mismatch.
8. ✅ Geo extraction (lat/lon) is defensive: tries multiple key names, returns null on non-finite or missing.
9. ✅ Author extraction coerces owner.id to string, reads login, infers agency/private from business.plan.
10. ✅ Per-listing error (AdvertNotFoundError, parse validation) does not abort sweep; error logged, listing skipped.
11. ✅ Filter extraction skips FEATURE_BODY/FEATURE_IMAGES/FEATURE_MAP_POINT; emits filterId=0 placeholder.
12. ✅ `rawHtmlHash` is sha256(JSON of stable fields); empty/null fields included for consistency; the price unit is hashed in its RAW (unstripped) form, and a missing title hashes as `null` even though the output `title` field is `''`.
13. ✅ Geo `lon` accepts `lng` (Google-Maps key); lat/lon resolve independently; non-object `mapPoint.value` → both null.
14. ✅ `parseRoDate` accepts an optional period after the month, is anchored (rejects surrounding text), and returns null when the month abbreviation is outside `RO_MONTHS`.
15. ✅ Price with present numeric value but absent unit yields `priceRaw: "X ?"`; non-numeric `price.value.value` yields both fields null; `measurement` is a fallback for `unit`.
16. ✅ `featureNumber` (landAre) accepts both `value: n` and `value: {value: n}`; `featureOptionId` (floors) only reads `value: {value: n}`.
17. ✅ `filterValues` re-emits price (FEATURE_PRICE id 2), zone, street, floors, landArea, region, city, offerType as triples that duplicate the scalar fields; persistence de-dups.
18. ✅ `buildSearchVariables` adds `sort: SORT_ADS_DATE_DESC` + pagination over `override ?? FILTER.searchInput`; `buildAdvertVariables(id)` returns `{input:{id}}`.
19. ✅ `parseTaxonomyResponse` uses `id` as fallback for both filterId and featureId, skips non-finite ids, and returns an empty map (never throws) on garbage input; `mergeLuts` is right-biased and non-mutating.
20. ✅ Text-mining functions behave as specified (sorted distinct distress categories, photo-quality buckets, ≥3-sample bumpRegularity returning null on mean ≤ 0, UTC-based weekend/hour bucketing).
21. ✅ `thumbUrl` builds `…/320x240/<filename>`, passes absolutes through, returns null on empty; `primaryThumb` returns null unless first array element is a string.
22. ✅ The 250k EUR price cap is a SEARCH-FILTER concern (config.ts filterId 9441), NOT applied by any parser; parsers store all prices verbatim.

## Open Questions & Known Gaps

- **Phone number capture** — currently `phone: null` everywhere. Future opt-in via separate "show phone" operation (P2). Not parsed in detail response yet.
- **Filter taxonomy capture** — FILTER_TAXONOMY_QUERY is a placeholder. Real query discovered via browser inspection + `scripts/capture-session.ts`. Bootstrap fallback works but becomes stale if 999.md restructures filters.
- **Year built & heating type** — reserved fields, not in current GraphQL extraction. Requires schema extension at 999.md (capture & extend GET_ADVERT_QUERY).
- **Feature tags (feature line 47, "features": [])** — index extracted but mapping unknown. Will populate once tag taxonomy is available.
- **Rooms count** — not exposed in GraphQL; title regex parse attempted in other sources (makler.md, lara.md).
- **Sector derivation from zone** — zone is localized name (e.g., "Rîșcani"); sector is inferred sector code (Sector 1–6, or null for communes). Mapping TBD after more captures.
- **Text mining (distress/photo quality)** — pure functions, no I/O, no capture dependency. Work at P3 post-listing-store.
- **Dedup cluster (`canonicalId`)** — image URL / geo / address match computed post-capture by `recomputeClusters()`. Not part of parse.
