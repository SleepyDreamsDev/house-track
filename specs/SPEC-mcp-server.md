# MCP Server (Read-Only SQL over the Catalog) — Specification

## Purpose & Scope

The Model Context Protocol (MCP) server provides Claude Desktop with read-only access to the `house-track` Postgres database.
It exposes three curated Prisma-backed tools for structured queries (`list_filters`, `search_listings`, `get_listing`),
one open-ended SQL runner (`run_sql`) guarded by strict validation and DB-level permissions, and a resource (`schema://house-track`)
containing the Prisma schema for composing ad-hoc queries.
The server runs as a local stdio process spawned on demand by Claude Desktop; it never mutates data and integrates
seamlessly with the operator UI's analytics layer.

## Architecture & Key Modules

| File Path                    | Responsibility                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/mcp/server.ts`          | MCP server entrypoint; registers 4 tools + 1 resource; connects Prisma/SqlRunner to stdio transport; error scrubbing     |
| `src/mcp/queries.ts`         | Prisma-backed query helpers: `listFilters()`, `searchListings()`, `getListing()`. Range/facet logic, type derivation     |
| `src/mcp/sql-runner.ts`      | Defense-in-depth SQL validator + executor. Skeleton parser, statement allowlist, row/byte caps, cache, statement_timeout |
| `src/mcp/schema-resource.ts` | Reads `prisma/schema.prisma` once, serves it as a resource with a preamble explaining semantics (TZ, prices, etc.)       |

## Data Flow / Control Flow

### MCP Startup

1. Node process spawns via `dist/mcp/server.js` (compiled; built by `pnpm build`)
2. At **module load** (top-level), `new PrismaClient()` and `new SqlRunner()` are constructed eagerly. The `SqlRunner` constructor only _reads_ `process.env.DATABASE_URL_RO` into a field; it does NOT open a pool yet. So a missing `DATABASE_URL_RO` does not break startup. Prisma also does not connect until its first query (lazy connect).
3. The 4 tools and 1 resource are registered on the `McpServer` (`name: "house-track", version: "0.1.0"`, capabilities `{ tools, resources }`)
4. `main()` creates a `StdioServerTransport` and `await server.connect(transport)`. Any fatal error here is written to **stderr** (stdout is reserved for JSON-RPC) and the process exits with code 1.
5. The RO `pg.Pool` is built on the **first `run_sql` call** (`pool()` lazily constructs it; `max: 2`, `statement_timeout`, `options='-c default_transaction_read_only=on'`). An injected pool (test seam) bypasses this.
6. Schema resource is memoized: first `read schema://house-track` triggers `loadSchemaText()`, which reads `prisma/schema.prisma` once and caches it; `SCHEMA_PATH` is resolved via `import.meta.url` so it works under both tsx (`src/mcp/`) and the compiled build (`dist/mcp/`).

### Tool: `list_filters()`

**Input:** none

**Process:**

1. Query `ListingFilterValue` table, filtering `optionId != null`
2. Walk result rows, grouping by `(filterId, featureId)` key
3. Deduplicate `optionIds` and collect up to 3 `sampleListingIds` per group
4. Accumulate `listingCount` (sum of all rows in that group)
5. Sort groups by `listingCount DESC`
6. Enrich labels from taxonomy tables (`getFilterLabel()`, `getFeatureLabel()`, `getOptionLabel()`)

**Output:** JSON array of `FilterGroup[]`, sorted by prevalence, with human-readable labels when available

**Error handling:** If taxonomy lookup fails (stale taxonomy), labels fall through to null; response stays stable

### Tool: `search_listings(input)`

**Input (`SearchListingsInput`, all optional):** Range filters (minPrice, maxPrice, minRooms, maxRooms, minAreaSqm, maxAreaSqm, minLandAre, maxLandAre, minFloors, maxFloors),
string filters (district, sector, q for title substring), facet filters (`filters[]` array of `{filterId?, featureId, optionIds}`), flags (`flags="priceDrop"`, `type`),
booleans (`favorite`, `includeExcluded`), timestamp bounds (`firstSeenAfter`, `lastFetchedAfter` — ISO strings), pagination (limit, offset), sort order.

**Two distinct surfaces — known asymmetry:** the `SearchListingsInput` type (`queries.ts`) supports the full set above, but the MCP `inputSchema` registered in `server.ts` only exposes a _subset_ to Claude Desktop: `minPrice, maxPrice, minRooms, maxRooms, minAreaSqm, maxAreaSqm, district, filters, sort, limit`. Fields like `sector, q, offset, flags, type, favorite, includeExcluded, minLandAre/maxLandAre, minFloors/maxFloors, firstSeenAfter, lastFetchedAfter` are reachable by the internal helper and the operator UI but are **NOT in the MCP tool schema**, so an MCP client cannot set them today. The Zod schema additionally enforces `limit` is a positive integer with **max 500**; `minRooms/maxRooms` are integers.

**Sort enum:** the MCP schema accepts `priceAsc | priceDesc | pricePerSqmAsc | newest`. The helper additionally accepts the aliases `price` (→priceAsc) and `eurm2` (→pricePerSqmAsc). Importantly, **`pricePerSqmAsc`/`eurm2` have NO dedicated column** — `orderBy()` falls back to `firstSeenAt: 'desc'` (i.e. same as `newest`), so the result is NOT actually sorted by price-per-sqm. Any unknown/absent sort also defaults to `firstSeenAt: 'desc'`.

**Process:**

1. Build Prisma `where` clause:
   - AND all range filters (convert to `{ gte, lte }`)
   - OR within each `filters[]` group via `filterValues.some()`
   - Set `active=true`, `excluded=false` unless `includeExcluded=true`
   - Append `watchlist=true` if `favorite=true`
   - Add `district`/`sector` (single value or `IN(...)` for multiple)
   - Add title substring filter if `q` provided
   - Timestamp range filters (`firstSeenAfter`, `lastFetchedAfter`)

2. Handle special flags:
   - **priceDrop:** Fetch with `include: { snapshots: true }` **already paginated** (`take`/`skip` applied to the pre-filter query), then post-filter by ≥5% price drop in past 7 days. Requires **≥2 snapshots within the past 7 days**; listings with fewer are skipped. The drop is computed from the _oldest-in-window_ vs _newest-in-window_ `priceEur`; both must be non-null or the listing is skipped. `total` here is `prisma.listing.count(where)` — the **pre-filter** count, NOT the count of price-drop matches (a known inconsistency; see Edge Cases).
   - **type:** In-memory classification via `deriveType()` (regex on title). NOTE: `deriveType()` returns **capitalized** `DerivedType` values (`"House" | "Villa" | "Townhouse" | "Duplex"`), and the match is a strict `deriveType(title) === input.type`. Callers MUST pass the capitalized value (`type="House"`); a lowercase `type="house"` matches nothing. There is no `"other"` type — the default/fallback classification is `"House"`.
   - If both flags are set, `priceDrop` wins the branch (it is checked first); the `type` filter is composed on top of the drop filter via `matchesType()`. A bare `type` (no priceDrop) uses its own branch.

3. Execute Prisma query with `orderBy()` (sort parameter), apply `limit` / `skip` / `take`

4. Map rows to `SearchListingsRow[]`:
   - Derive classification from title/description/district via `classifyListing()` (NOT `deriveType()` alone — `classifyListing` runs the full type+region heuristics)
   - Emit `derivedType`, `typeMismatch`, `regionMismatch`, and `mismatchReasons` (the latter is mapped from the classifier's `reasons` field; reason strings look like `"type: villa"`, `"region: <district>"`)
   - **`typeMismatch` is true whenever `derivedType !== "House"`** — i.e. any villa/townhouse/duplex classification is flagged as a mismatch, since the catalog scope is houses
   - Compute `primaryImage` via `primaryThumb(imageUrls)`. This does NOT return the stored value verbatim: a bare filename is expanded to a CDN thumbnail URL `https://i.simpalsmedia.com/999.md/BoardImages/320x240/<filename>`; values that are already `http(s)://` pass through unchanged; empty/non-array → null

5. Count total: if type filter is applied, total is post-filter count; otherwise `prisma.listing.count(where)`

**Output:** `SearchListingsEnvelope = { listings: SearchListingsRow[], total: number }`

**Pagination caveats:**

- If `flags=priceDrop`, `take`/`skip` are applied to the PRE-filter query, then the page is post-filtered for price drops. So a requested `limit=50` can return far fewer rows (only the drops within that pre-filter page), and `total` is the pre-filter count (misleading — see Edge Cases #10). Paging deeper can skip drops that lived on an earlier page.
- If `type` filter is active, the ENTIRE where-matched set is fetched (no DB-side `take`/`skip`), classified in memory, then sliced by `offset`/`limit`. `total` reflects post-filter count, so offset/limit stay honest with the filtered set — at the cost of loading the full matched set into memory.
- Default `limit` is `DEFAULT_LIMIT = 50`; default `offset` is 0. The MCP Zod schema caps `limit` at 500 but the helper itself does not.

### Tool: `get_listing(id)`

**Input:** `id` (999.md listing ID, e.g. `"12345"`)

**Process:**

1. Query `Listing` with `include: { filterValues: true }`
2. Map to `GetListingResult`, converting dates to ISO strings
3. Coerce `imageUrls` JSON to `string[]` (defense: in case of hand-edits)
4. Compute `primaryImage` from the array

**Output:** `GetListingResult` or error if not found

**Error handling:** There is no HTTP status code (stdio JSON-RPC, not HTTP). `getListing()` returns `null` when the id is absent; `server.ts` converts that to an MCP tool result `{ isError: true, content: [{ type: "text", text: "Listing not found: <id>" }] }`. The server does not throw, so the process keeps serving subsequent requests.

**Date handling:** `firstSeenAt`/`lastSeenAt`/`lastFetchedAt` are always present and emitted as ISO strings. `filterValuesEnrichedAt` is nullable → ISO string or null. `imageUrls` is coerced via `coerceStringArray()` (non-array or non-string elements are dropped → `[]`).

### Tool: `run_sql(sql)`

**Input:** User-provided SQL string

**Process (guarded execution):**

1. **Validation phase** (`validateSql(sql, rowLimit)` — the runner passes `this.rowLimit`, default 500):
   - Reject empty/whitespace-only: reason `"Empty query."`
   - Build the skeleton (strip comments/strings/identifiers/dollar-quotes). If it ended inside an open construct → reject with the SINGLE shared reason `"Unterminated string, comment, or quoted literal."` (the same message for an unterminated `'`-string, `/* */` block comment, `"`-identifier, OR `$tag$` dollar-quote — there are NOT distinct messages per construct)
   - If the skeleton is empty after stripping → `"Query is only comments/whitespace."`
   - Require leading keyword `/^(select|with)\b/i` → else `"Only read-only SELECT (or WITH … SELECT) queries are allowed."` (case-insensitive; only checks the FIRST keyword — a `WITH` CTE that contains a writable CTE like `WITH x AS (DELETE ... RETURNING ...)` would PASS app validation and is stopped only by the RO DB role)
   - After stripping ONE trailing `;`/whitespace run, any remaining `;` → `"Only a single statement is allowed."`
   - Wrap the **original** SQL (literals intact, trailing separators stripped): `SELECT * FROM (\n<body>\n) AS _q LIMIT <rowLimit>`. The leading newline before `)` defeats a trailing `--` line comment in the user SQL.

   **Skeleton parser specifics:** line comments `--` run to EOL; `'`-strings honor `''` escapes and detect `E'…'`/`e'…'` backslash escapes via the preceding char; `"`-identifiers honor `""` and emit a placeholder `x` token so identifier boundaries survive scanning; `$tag$…$tag$` dollar-quotes are matched by tag (`/^\$([A-Za-z0-9_]*)\$/`, including the anonymous `$$`).

2. **Caching phase** (`SqlRunner.cache`, LRU, max 50 entries):
   - **Version probe always runs first:** every `run()` executes `VERSION_SQL = SELECT max("finishedAt") AS v FROM "SweepRun"` against the RO pool, _even on a cache hit_. So a cache hit still costs one round-trip (it avoids only the user query, not the probe). A Date result is ISO-stringified; null → the literal `"none"`.
   - Hash the **wrapped** SQL to a sha256 key (so the row-limit and wrapper are part of the key)
   - Append the version probe result to the key: `${sha256(wrapped)}:${version}`
   - Check cache; if hit, return cached entry with `cached=true`, `cachedAt=<timestamp the entry was created>`
   - **LRU eviction:** on `get`, the entry is moved to most-recently-used; `set` evicts the oldest key once size exceeds 50

3. **Execution phase** (only on cache miss):
   - Acquire connection from `pg.Pool` (max 2 connections, `statement_timeout=5000`)
   - Pool created with `options='-c default_transaction_read_only=on'` (belt-and-suspenders)
   - Execute wrapped SQL
   - Serialize result rows via `serializeRows()`: deep-normalize through `JSON.parse(JSON.stringify(..., bigintReplacer))` (BigInt → string; this also drops `undefined`/functions and converts `Date` objects to ISO strings as a side effect of JSON), then drop trailing rows once the serialized payload would exceed `maxBytes` (~100 KB). **At least one row is always kept**, even if that single row alone exceeds 100 KB.
   - `truncated` is the OR of two independent signals: the byte-cap truncation from `serializeRows`, **and** `rowCapHit = result.rows.length >= rowLimit` (the raw, pre-serialization row count reaching the 500 cap from the `LIMIT 500` wrapper). Note `rowCapHit` uses the count returned by Postgres, not `rows.length` after byte truncation.
   - Cache the entry (rows, rowCount, truncated, cachedAt) before returning. The cached `truncated`/`cachedAt` are replayed on subsequent hits.

4. **Result envelope** (`RunSqlResult`):
   - `rows[]` — actual result rows (JSON-safe)
   - `rowCount` — number of rows in `rows[]` (after truncation)
   - `truncated` — boolean, true if results were capped
   - `cached` — boolean, true if served from cache
   - `cachedAt` — ISO timestamp when cache entry was created, null if `cached=false`
   - `sqlExecuted` — the wrapped SQL that ran (for transparency)

**Security model:**

- **Database role:** `house_track_ro` user (SELECT only) — hard backstop, writes impossible at DB level
- **App validation:** Skeleton parser strips all comments/strings; scanner checks for SELECT/WITH leading keyword; statement_timeout prevents runaway queries
- **Result capping:** 500 rows max, ~100 KB max
- **Error scrubbing:** `scrubError()` in `server.ts` applies `/(postgres(?:ql)?:\/\/)[^\s]*@/gi` → `$1***@`. The greedy `[^\s]*@` runs through the LAST `@` in the credential run, so an unencoded `@` inside the password cannot leak its tail. **Caveat:** this ONLY matches strings prefixed `postgres://`/`postgresql://`. A credential expressed any other way (bare `user:pass@host`, or a non-URL secret in an error) is NOT scrubbed. Scrubbing is applied only to the `run_sql` catch path in `server.ts`; the curated Prisma tools (`list_filters`/`search_listings`/`get_listing`) do NOT pass their errors through `scrubError` — a Prisma connection error would surface unscrubbed (though Prisma generally does not embed the password in its messages).

**Failure modes:**

- `NotConfiguredError` if `DATABASE_URL_RO` env var is not set
- `SqlValidationError` if skeleton parse fails, statement is non-SELECT, or multiple statements detected
- Execution timeout (5s) reported as query error
- Connection errors reported with credentials scrubbed

### Resource: `schema://house-track`

**Endpoint:** `schema://house-track`

**Process:**

1. Load schema on first read (memoized)
2. Prepend a preamble explaining DB semantics: timezone (Europe/Chisinau), price columns (priceEur, priceRaw), filterId=0 sentinel, case-sensitivity
3. Append raw Prisma schema from `prisma/schema.prisma` (file read, never hand-maintained)

**Output:** Plain text (`mimeType: "text/plain"`) — preamble + raw schema. The resource is registered under name `schema` at URI `schema://house-track`; the handler returns `{ contents: [{ uri, mimeType, text }] }`.

**Memoization & failure:** `loadSchemaText()` caches in a module-level `cached` var and increments `readCount` only on the disk read. Test seams `resetSchemaCache()` / `schemaReadCount()` exist (the spec's monitoring note referring to a `readCount()` method is wrong — the exported function is `schemaReadCount()`). The read uses `readFileSync(..., 'utf8')` with **no error handling**: if `prisma/schema.prisma` is missing (e.g. a partial deploy that shipped `dist/` without the schema), the first read THROWS and the resource read fails (no cached fallback).

**Preamble content (verbatim semantics):** TZ Europe/Chișinău (naive timestamps are local); `priceEur` EUR-normalized & nullable (~90% of rows), `priceRaw` is the audit string; `filterId = 0` means the taxonomy group is not yet captured (match on `(featureId, optionId)`); identifiers are case-sensitive — quote them.

**Use case:** Claude reads this before composing a `run_sql` query, so it understands table/column names and semantics

## Contracts & Types

### FilterGroup

```typescript
interface FilterGroup {
  filterId: number; // 999.md taxonomy group id (0 = unknown)
  featureId: number; // Feature identifier
  optionIds: number[]; // Distinct option values observed
  sampleListingIds: string[]; // Up to 3 listing IDs for exploration
  listingCount: number; // Total rows with this feature-option pair
  filterLabel?: string | null; // Human-readable filter name
  featureLabel?: string | null; // Human-readable feature name
  optionLabels?: Record<number, string>; // Mapping optionId → label (if known)
}
```

### SearchListingsInput

Range filters, string filters, facet array, sort order, pagination, flags. All optional.

### SearchListingsRow

```typescript
interface SearchListingsRow {
  id: string;
  url: string; // https://999.md/ro/<id>
  title: string;
  priceEur: number | null; // EUR-normalized
  priceRaw: string | null; // Source price string
  areaSqm: number | null;
  landAre: number | null; // Land plot size in ares
  rooms: number | null;
  district: string | null;
  firstSeenAt: string; // ISO timestamp
  lastSeenAt: string; // ISO timestamp
  lastFetchedAt: string; // ISO timestamp
  watchlist: boolean;
  excluded: boolean;
  derivedType: DerivedType; // "House" | "Villa" | "Townhouse" | "Duplex" (capitalized; default "House", NOT "other")
  typeMismatch: boolean; // true iff derivedType !== "House"
  regionMismatch: boolean; // district suggests outside Chișinău municipality
  mismatchReasons: string[]; // e.g. ["type: villa", "region: Orhei"]; from classifier `reasons`
  primaryImage: string | null; // CDN URL of first photo, or null
}
```

### GetListingResult

Full record + filter triples:

```typescript
interface GetListingResult {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceRaw: string | null;
  rooms: number | null;
  areaSqm: number | null;
  landAre: number | null;
  district: string | null;
  street: string | null;
  floors: number | null;
  yearBuilt: number | null;
  heatingType: string | null;
  description: string | null;
  imageUrls: string[]; // JSON array coerced to string[]
  primaryImage: string | null;
  active: boolean;
  watchlist: boolean;
  excluded: boolean;
  firstSeenAt: string; // ISO timestamp
  lastSeenAt: string; // ISO timestamp
  lastFetchedAt: string; // ISO timestamp
  filterValuesEnrichedAt: string | null; // When 999.md taxonomy was last captured
  filterValues: FilterValueRow[]; // Full triple list
}

interface FilterValueRow {
  filterId: number;
  featureId: number;
  optionId: number | null; // Taxonomy option, or null for text/numeric values
  textValue: string | null;
  numericValue: number | null;
}
```

### RunSqlResult

```typescript
interface RunSqlResult {
  rows: unknown[]; // Result set, JSON-serializable
  rowCount: number; // Actual rows returned (after truncation)
  truncated: boolean; // true if 500-row or ~100 KB cap hit
  cached: boolean; // true if served from cache
  cachedAt: string | null; // ISO timestamp when cached, null if not cached
  sqlExecuted: string; // The wrapped SELECT * FROM (...) AS _q LIMIT 500
}
```

## Invariants & Business Rules

1. **Read-only guarantee:** The MCP server connects via `DATABASE_URL_RO` (SELECT-only role) at the DB level.
   App-level validation (`SqlRunner`) adds an extra backstop.
   No INSERT, UPDATE, DELETE, CREATE, DROP, or mutation of any kind is exposed.

2. **Prisma queries use the rw connection (`DATABASE_URL`)** while ad-hoc SQL uses the ro connection.
   This separation is intentional: Prisma benefits from connection pooling and statement prepare, while SQL validation
   needs direct `pg` driver access to set `statement_timeout` per-connection.

3. **Cache stability:** The `run_sql` cache is keyed to the latest `SweepRun.finishedAt` so stale cache
   is automatically invalidated when new data lands. Identical queries re-asked after a sweep see fresh rows.

4. **Skeleton parsing removes all comment/string content before scanning for keywords.**
   This prevents SQL injection via comments (e.g., `SELECT * /* DROP TABLE */ FROM x`).
   App validation only inspects the LEADING keyword and statement count — it does NOT parse the
   statement tree. A `WITH … (writable CTE) …` or a SELECT calling a volatile/side-effecting
   function would pass app validation; the `house_track_ro` DB role + `default_transaction_read_only=on`
   session is the authoritative backstop that actually rejects writes. The app layer is convenience, not the security boundary.

5. **All result timestamps are ISO strings** (not epoch, not Date objects).
   `priceEur` and area fields default to null if unparsed; null is not filtered away — Claude sees the data as-is.

6. **Filter labels are best-effort.** The taxonomy is a static distillation in `taxonomy-labels.ts`;
   rows with no label entry still appear (filterLabel = null), so the response is stable across 999.md taxonomy updates.

7. **District/sector fields are raw parsed values** (no normalization).
   The crawler extracts them from breadcrumbs and filter strings; Claude can group/normalize them in post-processing.

8. **Image URLs are never downloaded.** The JSON array stored in the `imageUrls` column contains full CDN URLs.
   `primaryThumb()` extracts the first one; Claude can fetch them asynchronously if needed.

## Edge Cases & Failure Modes

1. **Empty database:**
   - `list_filters()` returns `[]`
   - `search_listings()` returns `{ listings: [], total: 0 }`
   - `get_listing(id)` returns error if `id` not found

2. **Missing `DATABASE_URL_RO`:**
   - MCP server starts successfully
   - First `run_sql` call fails with `NotConfiguredError`: "run_sql is not configured — set DATABASE_URL_RO (see docs/mcp-setup.md)" (note the trailing doc reference in the actual message). `SqlRunner.configured` is `Boolean(injectedPool ?? connectionString)`; both the `configured` guard at the top of `run()` and `pool()` throw `NotConfiguredError`.
   - Other three tools keep working (Prisma over `DATABASE_URL`)

3. **Malformed SQL:**
   - Unterminated string: `validateSql` rejects
   - Non-SELECT: `validateSql` rejects (must start with `SELECT` or `WITH`)
   - Multiple statements: `validateSql` rejects (only one allowed)
   - Syntax error: Passes validation, fails at DB execution (error scrubbed, no credentials leaked)

4. **Slow/runaway query:**
   - 5-second `statement_timeout` fires on the database
   - Connection error raised, caught in `run()`, error message returned to Claude
   - Connection is terminated; next query uses a fresh connection from the pool

5. **Result too large:**
   - Rows truncated at 500 rows
   - Bytes truncated at ~100 KB
   - `truncated=true` reported; Claude knows results are partial

6. **Cache miss due to new sweep:**
   - Query hash is the same, but `SweepRun.finishedAt` changed → cache key changed → new query execution
   - First time after a sweep, results include new data; second identical query hits cache

7. **Type derivation default:**
   - `deriveType(title)` returns `"House"` when no villa/townhouse/duplex regex matches (there is NO `"other"` value)
   - Negation cues ("nu este duplex", "lângă un townhouse") within ~40 chars before a match suppress that classification
   - `classifyListing()` sets `typeMismatch=true` for any `derivedType !== "House"`, and `regionMismatch=true` when the district is outside the Chișinău municipality locality list
   - Listing is always returned; Claude sees the warning flags + `mismatchReasons`

8. **Pagination beyond dataset:**
   - `offset > total` → result is empty array with correct `total` count
   - Claude can use `total` to avoid asking for non-existent pages

9. **Concurrent requests (unlikely, but theoretically possible):**
   - Prisma is thread-safe via connection pooling
   - `SqlRunner` cache is an in-memory Map; concurrent reads are safe (reads never contend)
   - At most one cache entry is written per query hash per sweep (very low contention)

10. **priceDrop `total` is the pre-filter count (known bug):** in the `flags="priceDrop"` branch, `total = prisma.listing.count(where)` counts ALL where-matched listings, not the price-drop subset that actually appears in `listings[]`. So `total` will usually be much larger than `listings.length`, and clients cannot rely on it for pagination of price-drop results. The `type`-only branch, by contrast, sets `total` to the post-filter count (honest).

11. **priceDrop requires ≥2 in-window snapshots:** a listing whose only price change is older than 7 days, or that has <2 snapshots within the window, is silently dropped — even if its overall price fell. The comparison is oldest-in-window vs newest-in-window `priceEur`; if either is null, the listing is skipped (no NaN propagation).

12. **`type` filter capitalization trap:** `deriveType()` returns capitalized `DerivedType`; the post-filter is `deriveType(title) === input.type`. Passing `type="house"` (lowercase) matches nothing because the value is `"House"`. There is no `"other"` bucket; non-matching titles classify as `"House"` by default.

13. **`pricePerSqmAsc` does not sort by price/sqm:** no column exists, so `orderBy()` falls back to `firstSeenAt DESC`. Same for the `eurm2` alias. Results are returned newest-first, not cheapest-per-sqm-first.

14. **Single-row over-cap:** if one result row alone serializes to more than ~100 KB, `serializeRows()` still keeps it (at-least-one guarantee) and reports `truncated=true`. The envelope can therefore exceed 100 KB for a single huge row.

15. **`run_sql` version probe failure:** the `SELECT max("finishedAt") FROM "SweepRun"` probe runs on the RO pool before every query. If `SweepRun` is missing/unreadable or the connection fails, the probe throws and the whole `run_sql` call errors (scrubbed) — the cache cannot be consulted without it.

16. **Unencoded `@` in password (scrub edge):** the greedy `[^\s]*@` deliberately consumes through the last `@`, so a password containing `@` still has its tail redacted. But only `postgres(ql)://`-prefixed strings are scrubbed (see Security model).

## Configuration & Operational Notes

### Environment Variables

| Variable          | Source  | Purpose                                                 | Required? | Default         |
| ----------------- | ------- | ------------------------------------------------------- | --------- | --------------- |
| `DATABASE_URL`    | `.env`  | Postgres connection string (rw role); read by Prisma    | Yes       | —               |
| `DATABASE_URL_RO` | `.env`  | Read-only role connection string; read by `SqlRunner`   | No        | —               |
| `NODE_ENV`        | `.env`  | Environment (production, development)                   | No        | development     |
| `TZ`              | compose | Timezone for naive timestamps (must be Europe/Chisinau) | No        | Europe/Chisinau |

### Setup Steps

1. **Build the server:**

   ```bash
   pnpm build
   ```

   Outputs `dist/mcp/server.js` (compiled TypeScript).

2. **Create the read-only role (if not done via `docker compose up`):**

   ```bash
   psql "$DATABASE_URL" -v ro_password='changeme_ro' -f scripts/create-ro-role.sql
   ```

3. **Set `DATABASE_URL_RO` in `.env`** (optional; `run_sql` reports "not configured" if absent, but other tools still work).

4. **Configure Claude Desktop:**

   ```bash
   pnpm setup:mcp
   ```

   Writes to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).
   Or edit manually; see `docs/mcp-setup.md` for paths on other OSes.

5. **Restart Claude Desktop.** Tools should appear in the MCP picker.

### Local Development (no rebuild needed)

```bash
pnpm mcp
```

Runs the tsx form directly, reading `DATABASE_URL` / `DATABASE_URL_RO` from the environment.
Useful for iteration on `queries.ts` or `sql-runner.ts` — but Claude Desktop itself runs the **compiled** binary,
so any change still requires `pnpm build` before Desktop sees it.

### Role Permissions

The `house_track_ro` role has `SELECT` on all tables in the public schema and is revoked from CREATE/ALTER/DROP/DML.
The role is created by `scripts/create-ro-role.sql` or `scripts/init-ro-role.sh` (called during `docker compose up`).

### Monitoring / Troubleshooting

- **Check if server runs:** `pnpm mcp` (should not error; stdio JSON-RPC output is for Claude Desktop only)
- **Check schema cache:** call `schemaReadCount()` (and `resetSchemaCache()` to reset) from `src/mcp/schema-resource.ts` in tests; should be 1 after first read regardless of how many reads occurred
- **Check SQL cache:** `SqlRunner` has internal LRU (max 50 entries); no observability exposed to Claude Desktop
- **Check credentials in errors:** Error messages from `run_sql` have credentials redacted; verify via unit tests

## Acceptance Criteria

1. MCP server starts cleanly, connects to `DATABASE_URL` via Prisma, spawns `SqlRunner` lazily
2. `list_filters()` returns non-empty array when DB has listings; returns `[]` when empty
3. `search_listings()` with no filters returns all active listings (paginated); respects limit/offset
4. `search_listings()` with range filters (price, rooms, area) AND-s them correctly
5. `search_listings()` with `district` filters by single or multiple districts
6. `search_listings()` with `filters[]` facet array AND-s across feature groups, OR-s within groups
7. `search_listings()` sort order (priceAsc, priceDesc, pricePerSqmAsc, newest) is applied correctly
8. `search_listings()` `flags=priceDrop` filters by ≥5% drop in past 7 days only
9. `search_listings()` `type` filter classifies via regex (in-memory post-filter)
10. `get_listing(id)` returns full record with filter triples; returns error if not found
11. `run_sql` validates and rejects: empty string, non-SELECT, multiple statements, unterminated constructs
12. `run_sql` wraps valid SQL and executes with 5s timeout, 500-row cap, ~100 KB cap
13. `run_sql` cache is keyed to latest sweep; identical queries after new sweep run fresh
14. `schema://house-track` resource reads file once and caches; contains preamble + raw schema
15. Error messages in `run_sql` have credentials scrubbed (no password leaks)
16. All timestamps in results are ISO strings, not Date objects or epochs
17. MCP server integrates with Claude Desktop via stdio; no auth needed (assumes local trust)
18. Prisma client initialized once, reused across requests (no connection leak)
19. `SqlRunner` pool initialized lazily on first `run_sql` call; max 2 connections, 5s timeout per statement
20. Database role (`house_track_ro`) is SELECT-only; writes are impossible at DB level
21. `search_listings` `type` filter is case-sensitive and matches capitalized `DerivedType` (`"House"|"Villa"|"Townhouse"|"Duplex"`); lowercase matches nothing; default classification is `"House"`
22. `search_listings` `sort=pricePerSqmAsc` (and alias `eurm2`) falls back to `firstSeenAt DESC` — NOT a real price/sqm sort
23. `search_listings` MCP `inputSchema` exposes only a subset of `SearchListingsInput` (no sector/q/offset/flags/type/favorite/includeExcluded/landAre/floors/firstSeenAfter/lastFetchedAfter); `limit` ≤ 500
24. `search_listings` `flags=priceDrop` returns `total` as the PRE-filter count (does not equal the number of drop matches in `listings[]`)
25. `run_sql` runs the `SweepRun` version probe on every call (including cache hits); empty `SweepRun` yields version `"none"`
26. `run_sql` validation emits ONE shared message for any unterminated construct: `"Unterminated string, comment, or quoted literal."`
27. `run_sql` app validation inspects only the leading keyword + statement count; a writable CTE is stopped by the DB role, not the app
28. `primaryImage` expands bare CDN filenames to a `320x240` thumbnail URL; already-absolute URLs pass through; empty → null
29. Schema resource read throws if `prisma/schema.prisma` is absent (no try/catch); `schemaReadCount()`/`resetSchemaCache()` are the test seams

## Open Questions / Known Gaps

1. **Observable cache metrics:** Currently, cache hits/misses are not observable to Claude Desktop.
   Operator UI could poll a `/api/mcp-cache-stats` endpoint in future if cache visibility is needed.

2. **Real-time invalidation:** Cache is invalidated only when `SweepRun.finishedAt` changes.
   If an operator manually updates a listing (future feature), cache won't know until next sweep.
   Mitigation: Document that manual edits won't be visible to Claude until the next sweep.

3. **Cost of full-scan post-filters:** `searchListings()` with `type` filter or `flags=priceDrop` fetch the entire where-matched set,
   then filter in memory. For very large result sets (1000+ rows), this could be slow.
   Optimization: Add a `Listing.derivedType` column (computed) or store price snapshots more efficiently.

4. **Pagination with post-filters:** `priceDrop` and `type` filters apply after DB fetch, so offset/limit don't align perfectly with the filtered result.
   User might see fewer rows than `limit` requested. Documented in code comment; consider caching the post-filtered set or using keyset pagination.

5. **Query plan visibility:** No `EXPLAIN` output exposed to Claude. If Claude's query is slow, troubleshooting requires operator intervention
   (log into `psql` and run `EXPLAIN ANALYZE` manually). Could expose a debug tool in future.

6. **Lateral facet queries:** `list_filters()` aggregates across all active listings. If Claude wants facets _conditional on_ a search (e.g., "show me options for properties in Botanica"),
   a new tool would be needed. Current design is "filters across the whole DB" only.
