# MCP `run_sql` — open-ended "ask the data" — Design

**Date:** 2026-05-24
**Status:** Approved (brainstorming complete)
**Scope:** Extend the existing read-only MCP server (`src/mcp/server.ts`) with a
schema resource and a guarded `run_sql` tool, plus a sweep-aware result cache.

---

## 1. Goal

Today the MCP server exposes three curated Prisma-backed tools (`list_filters`,
`search_listings`, `get_listing`). They cover the common 80% but cannot answer
questions that don't fit their parameters (e.g. "median €/m² by district for
listings whose price dropped this month").

Add open-ended querying so Claude can compose the question at query time instead
of us hand-coding a report per question:

1. A **schema resource** so Claude knows the tables/columns/semantics.
2. A guarded **`run_sql`** tool that executes a single read-only `SELECT`.
3. A **sweep-aware result cache** to avoid re-executing identical queries.

The three curated tools remain untouched.

---

## 2. Non-goals (YAGNI)

- No write/mutation tools.
- No `run_sql` pagination (single `LIMIT`-capped page only).
- No `EXPLAIN ANALYZE` (executes the query) — and `EXPLAIN` is out of scope for v1.
- No persistent/cross-process cache (would require a write path — see §6).
- No multi-source support.

---

## 3. Architecture

```
Claude Desktop ──stdio JSON-RPC──> server.ts
                                      ├── resource: schema://house-track   (memoized read of prisma/schema.prisma)
                                      └── tool:     run_sql                 ─> sql-runner.ts
                                                                                 ├── validate(sql)        (pure)
                                                                                 ├── version probe        (pg, RO pool)
                                                                                 ├── LRU cache            (in-memory)
                                                                                 ├── execute(wrappedSql)  (pg, RO pool)
                                                                                 └── serialize(result)    (pure)
```

- **New module `src/mcp/sql-runner.ts`** mirrors the existing `queries.ts` /
  `server.ts` split: all logic lives here, pure and unit-testable without
  spawning the JSON-RPC harness. It owns the `pg.Pool`, the validator, the
  cache, execution, and serialization.
- **`run_sql` uses the `pg` driver directly** (already a dependency,
  `pg@^8.20.0`), *not* Prisma. Rationale: Prisma can't cleanly run
  `SET statement_timeout` + an ad-hoc query, and we want a dedicated pool bound
  to a read-only connection string. The curated tools keep using Prisma.
- **Two connection identities.** Prisma keeps using `DATABASE_URL` (app role).
  `run_sql` uses a new `DATABASE_URL_RO` (read-only role). They are independent.

---

## 4. Safety model — defense in depth

Two independent layers. Either alone would block writes; together they also give
clean errors and kill runaway queries before they reach the DB.

### Layer 1 — DB read-only role (the hard backstop)

A `scripts/create-ro-role.sql`, wired into docker-compose initdb and documented
as a manual step for existing databases. **Kept out of Prisma migrations** —
migrations run as the app user and are for schema, not roles.

```sql
CREATE ROLE house_track_ro LOGIN PASSWORD ':changeme:';
GRANT CONNECT ON DATABASE house_track TO house_track_ro;
GRANT USAGE  ON SCHEMA public TO house_track_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO house_track_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO house_track_ro;
ALTER ROLE house_track_ro SET default_transaction_read_only = on;
ALTER ROLE house_track_ro SET statement_timeout = '5s';
```

This backstop is what blocks the cases app-level validation can't easily see:
data-modifying CTEs (`WITH x AS (INSERT … RETURNING) SELECT …`), `SELECT … INTO`,
and privileged functions (`pg_read_file`, `lo_import`, `COPY … TO PROGRAM`).

### Layer 2 — app validation pipeline (per call, in `sql-runner.ts`)

1. Trim input; reject empty.
2. Build a **skeleton**: strip SQL comments (`--…`, `/* … */`) and string
   literals, then **reject if more than one statement** (any non-trailing `;`).
   Stripping literals/comments first defeats `;`/`DROP` hidden inside them.
3. The skeleton must **start with `SELECT` or `WITH`** (case-insensitive).
   Reject everything else.
4. **Strip any trailing `;` and trailing comments**, then **wrap** to inject the
   row cap: `SELECT * FROM ( <user_sql> ) AS _q LIMIT 500`. (Stripping first is
   required — `SELECT * FROM (SELECT 1;) AS _q` is a syntax error.)
5. Execute on the RO pool. The role already enforces read-only + 5s timeout;
   set both per-session too as belt-and-suspenders.

---

## 5. Schema resource

- URI: `schema://house-track`, MIME `text/plain`.
- Content: **`prisma/schema.prisma` served verbatim** + a short preamble.
- Rationale: the schema file already carries the semantic comments Claude needs
  (`priceEur` nullable EUR-normalized, `filterId=0` = taxonomy-unknown, index
  meanings). Reading the file means **zero drift** — no hand-maintained data
  dictionary to rot. (Rejected alternative: live `information_schema` — accurate
  but strips the WHY comments.)
- Preamble notes: timezone is `Europe/Chisinau`; prices are EUR-normalized with
  `priceRaw` kept for audit; querying conventions (table names are
  PascalCase-quoted in SQL, e.g. `"ListingSnapshot"`).
- **Memoized**: `prisma/schema.prisma` is read once per process, not per fetch.

---

## 6. Caching

- **In-memory LRU**, ~50 entries, implemented inline (no new dependency — a
  Map-based LRU is ~20 lines; this is a dep-careful repo).
- **In-memory only.** A persistent cache would need a write path, which breaks
  the read-only role. The server is spawned by Claude Desktop per session, so a
  process-local cache covers exactly the "re-running the same query while
  exploring" case.
- **Sweep-aware key** = `hash(wrappedSql) : latestSweepFinishedAt`.
  - Version probe each call: `SELECT max("finishedAt") FROM "SweepRun"` on the RO
    pool. `max` ignores NULLs, so in-progress sweeps don't prematurely bust
    (their data is partial anyway). Empty table → `NULL` → version `"none"`.
  - When a new crawl finishes, the version advances; old keys are simply never
    hit again and LRU evicts them. No manual busting.
- **Only successful results are cached.** Validation rejections and Postgres
  errors never enter the cache.
- A cache hit returns `cached: true` + `cachedAt`. The stored envelope is the
  already-capped (≤100 KB) serialized result, so a hit can't blow the byte
  budget either.

> Token note: the cache saves DB round-trips and latency, not LLM context tokens
> directly (Claude re-reads the result on a hit either way). The real token
> levers are the row cap, byte cap, and a tool description that nudges
> aggregate-first queries.

---

## 7. Output / serialization

`run_sql` returns a JSON envelope (text content):

```jsonc
{
  "rows": [ /* result rows */ ],
  "rowCount": 42,
  "truncated": false,        // true if row cap or byte cap hit
  "cached": false,           // true on a cache hit
  "cachedAt": null,          // ISO timestamp when cached === true
  "sqlExecuted": "SELECT * FROM ( … ) AS _q LIMIT 500"
}
```

- **BigInt → string.** `pg` returns `count(*)` as BigInt; naive `JSON.stringify`
  throws. Convert before serializing.
- **Byte cap ~100 KB.** If the serialized payload exceeds it, drop trailing rows
  and set `truncated: true` with a note.
- `sqlExecuted` lets Claude (and the operator) see exactly what ran.

---

## 8. Error handling

| Condition | Behavior |
|---|---|
| `DATABASE_URL_RO` not set | `isError`, message: "run_sql not configured — set DATABASE_URL_RO (see docs/mcp-setup.md)". Other 3 tools keep working. |
| Validation rejection (non-SELECT, multi-statement, empty) | `isError` with the specific reason; query is **not executed**. |
| Postgres error (timeout, syntax, permission) | Surface the message (schema is public — we expose it deliberately), but scrub any connection-string fragments. |
| Pool/connection failure | `isError`; log detail to stderr (stdout is reserved for JSON-RPC). |

Errors are never cached.

---

## 9. Edge cases

| Edge case | Caught by |
|---|---|
| `SELECT 1; DROP TABLE "Listing"` (multi-statement) | L2 step 2 + RO role |
| DML inside CTE: `WITH x AS (INSERT…RETURNING) SELECT…` | **RO role** (L2 can't easily see it) |
| `SELECT … INTO newtbl` (creates a table) | RO role + L2 leading-keyword |
| `;`/`DROP` hidden in a string literal or comment | L2 skeleton strips literals/comments before counting statements |
| Runaway cartesian join / seq scan, no LIMIT | injected `LIMIT 500` + `statement_timeout = 5s` |
| `pg_read_file`, `lo_import`, `COPY … TO PROGRAM`, `nextval` | RO role lacks the privilege / not a SELECT |
| `count(*)` → BigInt | serializer (§7) |
| 100k-row or huge-text result blowing up context | row cap + byte cap + truncation note |
| User query already ends in `;` or has `ORDER BY`/`UNION` | strip-then-wrap (§4 step 4) handles it |
| `DATABASE_URL_RO` unset | graceful "not configured" error (§8) |
| Connection pile-up | pool `max: 2`, single stdio client |
| Postgres error leaking connection string | scrubbed before surfacing |
| Empty `SweepRun` (fresh DB) → version NULL | version = `"none"`, still cacheable |
| Sweep mid-run | `max(finishedAt)` reflects last *completed* crawl; no premature bust |
| Same SQL, different whitespace | keyed on wrapped SQL; trivially-different text re-runs (correctness over hit-rate) |

---

## 10. Testing (TDD workflow)

Gherkin spec `specs/mcp-run-sql.feature`, one `Scenario:` → one `it()`.

**Integration** (testcontainers Postgres, per-file pattern):
- Create the `house_track_ro` role in-container; connect `run_sql` via it.
- Seed listings + a current-price snapshot (mirror `persist.ts`); a real
  aggregate (`avg(priceEur) GROUP BY district`) returns rows.
- `INSERT` / `UPDATE` / `DROP` and DML-in-CTE are **rejected by the role**.
- Multi-statement and comment-hidden DML rejected by the validator.
- `count(*)` BigInt serializes without throwing.
- Byte cap truncates a large result with `truncated: true`.
- Cache hit returns `cached: true` without re-querying (spy on the pool).
- A new `SweepRun` row busts the cache (version advances → miss).
- Rejected/errored queries are **not** cached.
- `DATABASE_URL_RO` unset → "not configured" error, other tools unaffected.

**Unit** (pure functions):
- Validator: leading-keyword allowlist, statement-count, literal/comment
  stripping, wrap output.
- Schema resource read once across repeated fetches (memoization).

Coverage target 70%+ on `sql-runner.ts` logic.

---

## 11. Files

| File | Change |
|---|---|
| `src/mcp/sql-runner.ts` | **new** — pool, validator, cache, execute, serialize |
| `src/mcp/__tests__/sql-runner.test.ts` | **new** — unit + integration |
| `src/mcp/server.ts` | register `run_sql` tool + schema resource; fix stale "reads the same SQLite file" comment (it's Postgres) |
| `specs/mcp-run-sql.feature` | **new** — Gherkin scenarios |
| `scripts/create-ro-role.sql` | **new** — RO role |
| `docker-compose.yml` | wire RO-role init |
| `.env.example` | add `DATABASE_URL_RO` |
| `docs/mcp-setup.md` | document RO role + `DATABASE_URL_RO` + `run_sql` usage |

---

## 12. Commit scope

`mcp` (per CLAUDE.md conventions). Branch: `feature/mcp-run-sql`, squash-merge to
`main`.
