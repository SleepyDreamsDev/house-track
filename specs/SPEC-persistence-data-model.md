# Persistence, Snapshots & Data Model Specification

## Purpose & Scope

This subsystem manages the authoritative state machine for observed listings, price history, dedup clustering, and sweep bookkeeping. It enforces atomicity boundaries (upsert + snapshot decision + filter-value replace within a transaction), detects meaningless HTML change via SHA-256 normalization, flags inactive listings with a delist event (timestamp + reason), and clusters cross-posted duplicates & relistings into canonical lineages. No user-facing APIs directly call Persistence; the crawler orchestrates it after each fetch phase.

**Constraints:** Postgres (migrated from SQLite Phase 4); Prisma ORM; Typescript ESM strict; 70%+ test coverage on business logic. Delist events signal true inventory absorption, not 999.md's opaque delisting reason. Dedup operates over 180-day window (current + near-past) so relistings link back to originals.

## Architecture & Key Modules

| File                         | Responsibility                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`       | Entity declarations: `Listing`, `ListingSnapshot`, `ListingFilterValue`, `SweepRun`, `Source`, `Setting`, `FetchTask`, `ThrottleEvent`. Indexes for upsert performance + sweep rotation queries.                                                                                                                                                                                        |
| `src/persist.ts`             | `Persistence` class: diffAgainstDb, markSeen, markInactiveOlderThan, persistDetail (atomic upsert+snapshot), startSweep, recordSweepProgress, finishSweep, snapshotConfig, findUnenrichedListings, findStaleListings, recomputeClusters, setWatchlist, setExcluded.                                                                                                                     |
| `src/db.ts`                  | Singleton `getPrisma()` lazily instantiates PrismaClient from `DATABASE_URL`; `disconnectPrisma()` for cleanup.                                                                                                                                                                                                                                                                         |
| `src/lib/dedup.ts`           | Pure-function clustering: `clusterListings()` (O(n²) pairwise matching), `matchReasons()` (image/geo/address signals), `canonicalMap()` (id → canonical id, **including singletons mapped to themselves**), `normalizeStreet()` (NFD + diacritic strip + punctuation collapse), `shareImage`/`geoMatch`/`addressMatch`/`areaWithin`/`haversineMeters`. UnionFind with path compression. |
| `src/lib/chisinau-sector.js` | Geo classification: `deriveSector()` heuristic (street name + title + description parsing) as fallback when 999.md's zone (feature 9) is absent.                                                                                                                                                                                                                                        |
| `src/parse-taxonomy.ts`      | LUT bootstrap: maps 999.md feature IDs to internal filter group IDs. Filters ingested via `ListingFilterValue.{featureId, optionId, textValue, numericValue}`.                                                                                                                                                                                                                          |
| `src/types.ts`               | Interface definitions: `ListingStub` (index-time stubs), `ParsedDetail` (detail-time full form), `FilterValueTriple`, `SweepStatus`, `SweepError`.                                                                                                                                                                                                                                      |

## Data Flow / Control Flow

### Per-Sweep Outline

The crawler's `runSweep()` (in `src/sweep.ts`) orchestrates Persistence across nine steps (from `docs/poc-spec.md`):

```
1. Pre-flight: check circuit breaker → if open, abort
2. Build index URLs (page 1..N from FILTER.baseUrl + params)
3. Fetch index pages sequentially (8s ± 2s politeness, 3× retry on 5xx)
4. Parse stubs → extract {id, url, title, priceEur, postedAt, imageUrls}

5. [PERSISTENCE] Diff against DB
   → Call diffAgainstDb(stubs): returns {new, seen}

6. [PERSISTENCE] Mark seen + age-out
   → Call markSeen(seen): bumps lastSeenAt, re-activates, refreshes images
   → Call markInactiveOlderThan(ageMs): flags old active=true → false (stale_cutoff)

7. Fetch details for `new` IDs only (10s delay between detail fetches)
8. Parse detail pages → extract full schema + rawHtmlHash

9. [PERSISTENCE] Persist + snapshot decision
   → Call persistDetail(detail): atomically
      - upsert listing (create or update all fields)
      - delete + recreate filter-value rows (replace logic, not merge)
      - compare latest snapshot's rawHtmlHash vs parsed rawHtmlHash
      - insert new snapshot only if hashes differ

10. [PERSISTENCE] Sweep bookkeeping
    → Call startSweep(opts): create SweepRun row with status='in_progress'
    → (Incrementally) recordSweepProgress(id, snapshot): UPDATE counters + errors
    → Call finishSweep(id, result): finalize with status + timestamps
```

**Atomicity:** persistDetail wraps upsert + filter-value replace + snapshot decision in a transaction. A crash mid-write never leaves a half-enriched listing.

### Inactive Listing Lifecycle

A listing transitions `active=true` → `active=false` when **not seen for ≥ N sweeps** (age cutoff, configurable via `STALE_CUTOFF_MS` setting, default 3 sweeps ≈ 3 hours). The delist event is stamped:

- `delistedAt = now()`
- `delistReason = 'stale_cutoff'` (live event) or `'backfill_estimate'` (pre-event rows migrated at deploy)

**Revival:** A `re-seen` listing (appearing in the index again after being inactive) is auto-revived:

- `active = true`
- `delistedAt = null`, `delistReason = null`
- This clears any stale delist record so absorption metrics don't double-count relistings.

**Backfill:** `backfillDelistedEstimate()` is a one-time/idempotent op (in Persistence) that estimates `delistedAt` for legacy rows where the column was NULL before the delist-event feature shipped. Mirrors the migration's UPDATE so it can be re-run safely.

### Dedup Clustering

Called via `recomputeClusters(opts)` periodically (e.g., after sweeps or on-demand). Operates over:

- All active listings
- Plus inactive listings delisted ≤ 180 days ago (so a relisting links back to its original)

**Algorithm:**

1. Load all candidates with `{id, imageUrls, street, sector, rooms, areaSqm, lat, lon, firstSeenAt}`
2. Pairwise match via three signals (priority = reliability):
   - **Image:** `shareImage(a, b)` → a.imageUrls ∩ b.imageUrls ≠ ∅ (same CDN photos). Returns `false` if **either** side has an empty `imageUrls` (dedup.ts:62).
   - **Geo:** `geoMatch(a, b)` → haversine(lat/lon) ≤ 25m AND rooms bucket match AND area within ±10%. Returns `false` if any of the four coords is null (dedup.ts:96).
   - **Address:** `addressMatch(a, b)` → normalized street match AND sector match AND rooms bucket match AND area within ±10%.
   - **`areaWithin` guard:** returns `false` if **either** area is null OR ≤ 0 (dedup.ts:68). So a listing with `areaSqm=0`/null can never geo- or address-match (but can still image-match).
   - **`roomsBucket(null)` collapses to bucket `'1–2'`** (src/lib/listing-type.ts:11): two listings both lacking a room count share a bucket and may match on geo/address if the other gates pass. This is intentional (sparse-data tolerance), not a bug.
   - **`normalizeStreet`** lowercases, NFD-decomposes, strips combining diacritics + non-alphanumerics, collapses whitespace; returns `null` if the result is empty. Two streets only address-match after this normalization (e.g. "Str. Pușkin" ≡ "strada pushkin"-style inputs collapse to comparable tokens). A null-normalized street blocks address-match.
3. Union-Find merges pairwise matches into clusters. **Transitivity:** A↔B (image) and B↔C (geo) yield one cluster {A,B,C} even though A and C share no direct signal.
4. Convention: **canonical = earliest-seen member** in each cluster; ties on `firstSeenAt` broken by ascending `id.localeCompare` (dedup.ts:182). Only non-canonical members have `canonicalId` set.
5. Write: atomically clear all non-null canonicalId, then set for multi-member clusters only.
   - **Clear scope is wider than candidate scope:** the clear step (`canonicalId: { not: null }`) touches **every** row in the DB, including rows outside the 180-day candidate window. A row delisted >180 days ago that still carried a stale `canonicalId` will therefore be reset to null even though it was not loaded as a clustering candidate (persist.ts:171). This is the desired self-healing behavior, but it means recompute is not "candidate-local".
   - `clusterListings` returns **only multi-member clusters**; singletons are skipped, so they never receive a `canonicalId`. `canonicalMap()` differs: it maps singletons to themselves.

**Invariant:** `COUNT(DISTINCT COALESCE(canonicalId, id))` = true unique inventory.

**Sparse data:** Geo/address signals are sparse until `filterValuesEnrichedAt` populates (next detail capture pins lat/lon, zone). Early-POC rows have only image + address.

### Price Change Detection

Each `ListingSnapshot` row stores:

- `listingId, capturedAt, priceEur, description, rawHtmlHash`

**Trigger:** `persistDetail()` compares latest snapshot's `rawHtmlHash` against the parsed detail's `rawHtmlHash` (SHA-256 of normalized HTML). Only **meaningful content changes** trigger a new snapshot (duplicate index/detail fetches within the same sweep do not).

**Price drops:** Queried post-hoc over snapshots:

```sql
SELECT l.id, l.title,
       (SELECT priceEur FROM ListingSnapshot
        WHERE listingId=l.id ORDER BY capturedAt ASC LIMIT 1) AS firstPrice,
       l.priceEur AS currentPrice
FROM Listing l
WHERE ...
ORDER BY (currentPrice * 1.0 / firstPrice) ASC;
```

### markSeen / markInactiveOlderThan / Aging

**markSeen:**

- Bulk-updates `lastSeenAt = now()`, `active = true`, clears delist event
- Bulk-updates `imageUrls` from index payload (cheap: one unnest UPDATE via raw SQL)

**markInactiveOlderThan:**

- Called with `ageMs` (typically 3 hours = ~3 sweeps)
- Flips `active = true` → `false` where `lastSeenAt < cutoff`
- Stamps `delistedAt = now()`, `delistReason = 'stale_cutoff'`
- Returns count of flagged rows

**Filtering:** `findStaleListings(opts)` and `findUnenrichedListings(limit)` use indexes to pick next batch for detail refresh:

- Watchlist first (operator-flagged)
- Then oldest `lastFetchedAt` (hot/warm/cold aging implicit)
- Excludes current-sweep touched rows

**Both pickers filter `active=true` AND `excluded=false`:**

- `findUnenrichedListings(limit)` (persist.ts:287): returns ids where `filterValuesEnrichedAt IS NULL AND active=true AND excluded=false`, oldest `lastFetchedAt` first, `take(limit)`. **Inactive and excluded rows are never returned** even if unenriched. Returns `[]` immediately if `limit <= 0`.
- `findStaleListings({limit, sinceFetched})` (persist.ts:307): both the watchlist query and the stale query require `active=true AND excluded=false AND lastFetchedAt < sinceFetched`. The `sinceFetched` cutoff is what implements "exclude current-sweep touched rows" — a row whose `lastFetchedAt >= sinceFetched` is filtered out of **both** buckets. Returns `[]` immediately if `limit <= 0`. Watchlist drains first up to `limit`; only the leftover slots (`limit - watchlist.length`) are filled from the `watchlist=false` stale bucket.

## Contracts & Types

### Inputs

**diffAgainstDb(stubs: ListingStub[]):**

- Input: Index page stubs (id, url, title, priceEur, postedAt, imageUrls)
- Returns: `{new: ListingStub[], seen: ListingStub[]}` — excludes excluded IDs
- Errors: None (read-only; wraps Prisma.listing.findMany)

**markSeen(stubs: ListingStub[]):**

- Input: Array of stubs from current sweep (empty array is a no-op, returns early)
- Side effects: `updateMany` bumps `lastSeenAt=now`, `active=true`, clears `delistedAt`/`delistReason`. A **second** raw `unnest` UPDATE refreshes `imageUrls` — but only for stubs whose `imageUrls.length > 0`; if no stub carries images the raw query is skipped entirely.
- Does **not** touch `lastFetchedAt` or `filterValuesEnrichedAt` (only `persistDetail` does).
- Unknown ids: `updateMany` silently matches zero rows — never creates a listing, never throws.
- Errors: Prisma query errors (rare)

**markInactiveOlderThan(ageMs: number):**

- Input: Age threshold in milliseconds (e.g., 3 _ 60 _ 60 \* 1000)
- Returns: count of flagged rows
- Side effects: Flip active + stamp delist event

**persistDetail(detail: ParsedDetail):**

- Input: Full parsed detail page
- Atomic side effects:
  1. Upsert Listing (create or update; sets lastSeenAt, lastFetchedAt, filterValuesEnrichedAt)
  2. Delete all FilterValue rows for this listing
  3. Insert fresh FilterValue rows (replace, not merge)
  4. Fetch latest snapshot's rawHtmlHash
  5. Insert new ListingSnapshot **only if** hash differs
- Errors: Prisma transaction errors; Sector derivation heuristic errors (logged, not fatal)

**recomputeClusters(opts?: Partial<DedupOptions>):**

- Input: Optional override for `areaTolerance` (default ±10%) and `geoMetersThreshold` (default 25m)
- Returns: count of multi-member clusters
- Side effects: Atomic transaction — clear all canonicalId, then set for clusters only
- Performance: O(n²) pairwise; ~1s for 500 listings on modern hardware

**startSweep(opts?: {source?, trigger?}):**

- Input: Optional source slug (default "999.md"), trigger ("cron" | "manual")
- Returns: `{id: number, startedAt: Date}`
- Side effect: Create SweepRun row with status='in_progress'
- **Type note:** `'in_progress'` is the literal written by `startSweep`, but it is **not** a member of the `SweepStatus` union (`'ok' | 'partial' | 'failed' | 'circuit_open' | 'cancelled'`, see `src/types.ts:72`). `SweepRun.status` is a plain `String` column (schema:132), so this is legal at the DB layer; consumers reading an in-progress row must treat any value outside the closed `SweepStatus` set as "still running". `finishSweep` overwrites it with a real `SweepStatus`.
- **Defaults:** `source`/`trigger` are only written when truthy (`opts?.source && {...}`); an empty-string `source` falls through to the schema default `"999.md"` / `"cron"` (persist.ts:351-353).

**setWatchlist(id, watchlist) / setExcluded(id, excluded):**

- Side effect: `prisma.listing.update` (NOT upsert) of the single flag column
- Errors: Prisma `P2025` (record-not-found) **throws** if `id` does not exist — these are the only Persistence methods that hard-fail on a missing listing. Callers must pass an id known to exist.

**finishSweep(id: number, result: SweepResult):**

- Input: SweepRun id, result snapshot (status, counters, errors, JSON detail cols)
- Side effects: UPDATE SweepRun row (finishedAt, status, all counters, JSON columns)
- **Empty/null → `Prisma.DbNull`:** Each JSON column (`errors`, `configSnapshot`, `pagesDetail`, `detailsDetail`, `eventLog`) is written as SQL `NULL` (`Prisma.DbNull`) when the corresponding input is an empty array (`errors`, `pagesDetail`, `detailsDetail`, `eventLog`) or `null`/`undefined` (`configSnapshot`). It is never stored as a JSON `[]` or `{}`. `eventLog` additionally requires `Array.isArray(...)` to be truthy before persisting (persist.ts:439-442). This keeps "no data" distinguishable from "empty payload" at the SQL level.
- Errors: Prisma query errors

**recordSweepProgress(id, snapshot):**

- Input: SweepRun id + partial counter/JSON snapshot; every field is optional.
- Side effects: builds a sparse `SweepRunUpdateInput` and UPDATEs only the keys present.
- **Asymmetry vs finishSweep:** counters are written when `!== undefined` (so an explicit `0` IS written). `errors` is written as `Prisma.DbNull` when empty (same as finishSweep), but `pagesDetail`/`detailsDetail`/`configSnapshot` are written **only when present and non-empty** — they are _never_ cleared to `DbNull` here, and `eventLog` is **not handled at all** by recordSweepProgress (persist.ts:377-399). Clearing/eventLog only happen at finishSweep.

### Outputs

**DiffResult:**

```ts
{
  new: ListingStub[];    // ids not yet in DB
  seen: ListingStub[];   // ids already in DB, not excluded
}
```

**SweepResult:**

```ts
{
  status: SweepStatus;                  // 'ok' | 'partial' | 'failed' | 'circuit_open' | 'cancelled'
  pagesFetched: number;
  detailsFetched: number;
  newListings: number;
  updatedListings: number;
  errors: SweepError[];                 // {url, status, msg, attempts?}
  configSnapshot?: Record<string, unknown>;  // All settings at sweep start
  pagesDetail?: Array<{n, url, status?, bytes?, parseMs, found, took}>;
  detailsDetail?: Array<{id, url, status?, bytes?, parseMs, action, priceEur?}>;
  eventLog?: unknown[];
}
```

**Cluster:**

```ts
{
  canonicalId: string;      // earliest-seen member
  memberIds: string[];      // all members, ascending by firstSeenAt
  reasons: MatchReason[];   // which signals linked cluster (image|geo|address, sorted, unique)
}
```

### Error Shapes

- **Prisma errors** (connection, migration, constraint): Wrapped in try-catch at sweep level; logged as SweepError with url=DB-context, status=null, msg=error.message
- **Parse errors** (single listing fails): Logged at sweep level; listing is skipped, sweep continues
- **Schema drift** (required field missing): Partial data stored; warning logged with sample HTML
- **Sector derivation fails** (heuristic parse error): Falls through to null; sector remains unpopulated
- **Dedup expensive** (O(n²) timeout): Logged; clusters still committed if partial
- **`DATABASE_URL` unset** (`getPrisma()` in db.ts:8): throws `Error('DATABASE_URL environment variable is not set')` on first client construction. This is a hard startup failure, not a per-sweep recoverable error. `Persistence` itself receives its client by constructor injection, so this throw originates in the singleton path used by the crawler/CLI, not inside Persistence methods.
- **`recordSweepProgress` / `setWatchlist` / `setExcluded` on a missing id**: Prisma throws `P2025` (record-not-found). Not caught inside Persistence — propagates to the caller.
- **Malformed `imageUrls` JSON** in `recomputeClusters`: the column is `Json?`; the loader defends by `Array.isArray(...)` then filtering to `typeof === 'string'` (persist.ts:156-158). A non-array value (object, null, scalar) coerces to `[]`; non-string array entries are dropped. Such a row simply never image-matches — no throw.

## Invariants & Business Rules

1. **Upsert is create-or-update, never delete.** Once a listing ID appears in the DB, it persists forever (with active/excluded flags). Delisting is a state change, not a row drop.

2. **Delist events are one-way stamps.** `delistedAt` and `delistReason` are set once per age-out cycle. A revision does not re-stamp — the event marks the moment it became inactive in the sweep.

3. **Snapshots only on real change.** A duplicate index+detail fetch (or a re-fetch with identical HTML) does not spawn a spurious snapshot. The `rawHtmlHash` gate prevents log spam.

4. **Filter-value replace, not merge.** When 999.md removes a feature from a listing's detail page, our DB must forget it too. Deletion + recreation is cheap at row counts 10–30 per listing.

5. **Canonical listings have canonicalId=null.** Non-canonical members point upward. This eliminates double-counting in inventory aggregates.

6. **Dedup window is 180 days.** A relisting after 6+ months is treated as a new property (its original is too stale). This bounds clusters to realistic time horizons.

7. **Sector is hierarchical.** Prefer 999.md's structured zone (feature 9) if present. Fall back to heuristic (street name parsing) only when zone is absent. This avoids false positives like "3 km to center" triggering a sector guess.

8. **Politeness + atomicity decouple:** The crawler respects politeness delays (8s ± 2s) **between** requests. Persistence atomicity (upsert+snapshot within txn) is **internal** to each persist call — no network delay inside the transaction.

9. **exclusion is operator intent.** A listing marked `excluded=true` is invisible to all sweep rotations (diffAgainstDb, findStaleListings, etc.). The flag is user-controlled via the operator UI.

10. **watchlist is priority 1.** Listings marked `watchlist=true` are refreshed **before** stale-rotation picks, regardless of age. Enables fast tracking of favourite properties. Caveat: even a watchlist row must satisfy `lastFetchedAt < sinceFetched` to be picked — a watchlist listing touched this sweep is still skipped this tick.

11. **`snapshotConfig` uses the instance's injected client, never `getPrisma()`.** This avoids split-brain reads when `Persistence` is constructed with a test/alternate client (persist.ts:402-405). The returned object is a flat `{ key: valueJson }` map of **all** `Setting` rows (no namespacing/filtering applied in code).

12. **Backfill estimate `delistedAt = lastSeenAt` exactly.** `backfillDelistedEstimate` copies `lastSeenAt` into `delistedAt` (not "now") for legacy `active=false, delistedAt IS NULL` rows and stamps `delistReason='backfill_estimate'` (persist.ts:121-124). It is the only delist-stamp that does NOT use `now()`. Idempotent: re-runs match zero rows once stamped.

## Edge Cases & Failure Modes

**Scenario: Listing revived after 3+ weeks inactive**

- prestate: active=false, delistedAt=<3 weeks ago>, delistReason='stale_cutoff'
- event: markSeen() called for the listing in the current sweep
- result: active=true, delistedAt=null, delistReason=null
- risk: Absorption calculations must filter for non-null delistedAt or use delistReason='stale_cutoff' to avoid double-counting

**Scenario: Two clusters merge mid-recompute**

- prestate: cluster A {canonical=X, members={X,Y}}, cluster B {canonical=Z, members={Z,W}}
- event: recomputeClusters() finds a new image match linking Y and W
- result: Union-Find merges to single cluster {canonical=X, members={X,Y,Z,W}} (earliest wins)
- atomicity: Transaction ensures stale assignments clear before new ones write

**Scenario: Price change within minutes (same sweep, different page hits)**

- prestate: listing "L" seen twice in index pages 1 and 20 of a single sweep
- event: detail fetch runs, persistDetail called; then another detail fetch (same listing, maybe re-queued)
- result: Both hit the same latest snapshot hash; second persistDetail is idempotent, no spurious snapshot
- risk: If HTML _legitimately_ changed (e.g., seller bumped the ad), the second fetch would show new hash and insert new snapshot

**Scenario: Excluded listing appears in index**

- prestate: listing "X" has excluded=true
- event: markSeen() called during diffAgainstDb — excluded IDs filtered out
- result: X not in seen set, no lastSeenAt bump, stays excluded
- risk: Excluded listings never get re-enriched; if operator unexclude, filterValuesEnrichedAt may be stale

**Scenario: Dedup over sparse data**

- prestate: 300 listings, 200 have images, 30 have geo, none have address yet
- event: recomputeClusters() runs with default opts
- result: Clusters via image + geo; address signal unused; many singletons remain
- improvement: After next sweep populates addresses, re-run clusters to catch address-only matches

**Scenario: Sector null fallthrough**

- prestate: listing with no 999.md zone (feature 9 = null)
- event: persistDetail calls deriveSector(…) heuristic
- result: heuristic returns null (street too generic, no Chișinău marker in title); sector remains null
- risk: Analytics queries using sector may skip this row (NULL ≠ any grouping value)

**Scenario: Snapshot explosion on parser churn**

- prestate: parser bug emits slightly different HTML normalization each sweep
- event: persistDetail sees different hash every call, even for unchanged listing
- result: Snapshot table grows without bound; false price/description history
- mitigation: rawHtmlHash must normalize away formatting differences (whitespace, tag order, comments)

**Scenario: Upsert race during transaction**

- prestate: same listing ID detail-fetched twice concurrently (shouldn't happen but possible under bug)
- event: persistDetail txn for detail A reads latest snapshot, decides to insert; detail B reads same snapshot, inserts different snapshot
- result: Both snapshots inserted (concurrent txns don't conflict on create); upsert on Listing is serializable
- mitigation: Crawler enforces concurrency=1 at fetch level; Persistence does not add extra locking

## Configuration & Operational Notes

### Settings (Prisma.Setting table)

Keys are namespaced; all values are JSON. Crawler reads at sweep-start via `snapshotConfig()`. Defaults in `src/config.ts`.

| Key                        | Type    | Default  | Used by                                                   |
| -------------------------- | ------- | -------- | --------------------------------------------------------- |
| `politeness.baseDelayMs`   | number  | 8000     | Fetch layer (8s base inter-request)                       |
| `politeness.jitterMs`      | number  | 2000     | Fetch layer (±2s jitter)                                  |
| `politeness.detailDelayMs` | number  | 10000    | Fetch layer (10s between detail fetches)                  |
| `sweep.maxPagesPerSweep`   | number  | 20       | Index crawl safety cap                                    |
| `sweep.staleAgeMs`         | number  | 10800000 | Persist.markInactiveOlderThan (3 hours)                   |
| `sweep.mode`               | string  | "legacy" | Two-tier plumbing (PR 1); defaults to monolithic runSweep |
| `source.999md.enabled`     | boolean | true     | Fetch layer (skip 999.md if disabled)                     |
| `log.level`                | string  | "info"   | Pino logger                                               |

Operators edit settings via `/api/settings` (Hono API) or `pnpm prisma:studio`.

### Environment Variables

- `DATABASE_URL` — Postgres connection string (required; set in `docker-compose.yml` or `.env.local`)
- `TZ=Europe/Chisinau` — Container time zone (so naive datetimes in Postgres match local cron)
- `NODE_ENV=production` — Enables Pino JSON output to stdout

### Circuit Breaker

A 403/429 from 999.md trips the circuit breaker (writes sentinel file `data/.circuit_open`). Manual clear:

```bash
# In container:
rm /data/.circuit_open
# Or via operator UI button on Sweeps page
```

### Backfill Operation

One-time op to estimate delistedAt for legacy rows:

```ts
const persistence = new Persistence(prisma);
const count = await persistence.backfillDelistedEstimate();
console.log(`Backfilled ${count} rows`);
```

Idempotent; safe to re-run (WHERE active=false AND delistedAt IS NULL).

### Indexes

Tuned for sweep rotation + analytics queries:

- `(active, lastSeenAt)` — aging out inactive listings
- `(priceEur)` — price-drop analytics
- `(watchlist, lastFetchedAt)` — watchlist-first rotation
- `(active, lastFetchedAt)` — stale-rotation picker
- `(sector)` — analytics grouping
- `(excluded)` — operator filtering
- `(delistedAt)` — absorption bucketing
- `(canonicalId)` — dedup cluster lookups
- `(authorId)` — seller-portfolio aggregation
- `ListingFilterValue: (filterId, featureId, optionId), (listingId), (featureId, optionId)` — filter queries

## Acceptance Criteria

1. ✅ `diffAgainstDb()` correctly partitions stubs into new vs seen, excluding excluded IDs
2. ✅ `markSeen()` bumps lastSeenAt + re-activates + bulk-updates imageUrls without extra round trips
3. ✅ `markInactiveOlderThan()` stamps delist event (delistedAt + delistReason='stale_cutoff')
4. ✅ `persistDetail()` atomically upserts listing, replaces filter-values, and inserts snapshot only on hash change
5. ✅ `persistDetail()` revives an inactive listing (clears delist event) when re-fetched
6. ✅ Snapshot table correctly captures price/description changes; duplicate fetches do not add spurious rows
7. ✅ `recomputeClusters()` identifies multi-member clusters via image + geo + address signals; writes canonical IDs; honors 180-day window
8. ✅ `startSweep()` + `finishSweep()` round-trip correctly; SweepRun counters, timestamps, JSON detail columns, and error list match inputs
9. ✅ `findStaleListings()` respects watchlist priority, the `sinceFetched` cutoff (current-sweep exclusion), and skips inactive/excluded rows; `findUnenrichedListings()` returns only `filterValuesEnrichedAt=null AND active=true AND excluded=false` rows. Both return `[]` for `limit <= 0`.
10. ✅ Delist revivability: re-seen listing clears delistedAt so absorption does not double-count relistings
11. ✅ Transactions are atomic: a crash during persistDetail never leaves filterValuesEnrichedAt set without corresponding filter values

## Open Questions / Known Gaps

- **address + geo sparseness (P2):** Until lat/lon and sector are populated by the next capture extending mapPoint extraction and zone handling, dedup relies heavily on image matching. Address/geo signals are sparse in early POC. Mitigation: re-run clusters after each sweep to catch new address/geo data as it arrives.
- **Seller identity & phone (P2):** `authorId`, `authorName`, `authorType`, `phone` fields exist in schema but are not yet wired in the parser. Once the GetAdvert selection extends the owner object and phone-reveal op is implemented, these populate automatically. Currently all null.
- **Two-tier cadence integration (PR 1 — plumbing only):** `FetchTask` and `ThrottleEvent` tables exist; `Setting` keys for sweep.mode exist; but runtime producer/consumer logic lives in a separate PR (PR 2). No behavior change in this state.
- **Adaptive soft-throttle observer:** `ThrottleEvent` table captures trigger events; rolling-window stats in memory. Implementation deferred to PR 2.
- **Schema drift handling:** Currently a warning log + partial data. No automatic alerting or quarantine queue. If a required field disappears from 999.md's HTML, the field value will be null but the listing is still persisted.
- **Sector heuristic false positives:** Phrases like "3 km to center" or "near X" can trigger incorrect sector guesses. Mitigated by preferring structured zone (feature 9) when available.

---

_Last updated: 2026-06-01. Reflects code state in `src/persist.ts`, `prisma/schema.prisma`, `src/lib/dedup.ts` as of that date._
