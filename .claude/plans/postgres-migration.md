# Slice 1 — Postgres migration + testcontainers

## Goal

Swap the persistence layer from SQLite to Postgres in a single
self-contained, mergeable slice. Land before any new feature work
(settings, HTTP API, UI) so subsequent slices ship against the new test
infra. All 146 existing tests must pass green against a Postgres
testcontainer at the end of this slice.

This is **slice 1 of 7** in the parent plan
`.claude/plans/operator-ui-postgres-grafana.md`. Slices 2–7 are out of
scope for this session.

## Decisions (locked, from parent plan)

- **Provider**: `sqlite` → `postgresql` in `prisma/schema.prisma`.
- **No data migration**: drop the existing dev SQLite, fresh `0_init` migration generated against pg. The crawler repopulates within ~5 days of backfill in production.
- **JSON columns**: `Listing.imageUrls`, `Listing.features`, `Listing.errors` (and any other `String` blobs that are actually JSON) switch from `String` to `Json` (native pg `jsonb`). Read-side parsers in `src/persist.ts` simplify accordingly.
- **Test infra**: per-Vitest-process Postgres testcontainer, per-test-file unique database. `vitest.globalSetup` starts the container once and exports its URL. Each `*.test.ts` file gets `CREATE DATABASE test_${randomUUID().slice(0,8)}`, runs `prisma migrate deploy` against it, drops on teardown.
- **Compose**: add `postgres:16-alpine` service, healthcheck on `pg_isready`, bind `127.0.0.1:5432`. Crawler service gains `DATABASE_URL=postgresql://...@postgres:5432/house_track` and `depends_on: postgres (healthy)`. Crawler entrypoint runs `pnpm prisma migrate deploy` before booting.
- **Out of scope this slice**: `Setting` model, `Source` model, `seed.ts`, settings refactor in sweep/fetch/circuit, any HTTP/UI work. Those are slices 2–6.

## Files to create / modify

### Schema + migrations
- `prisma/schema.prisma` — change `datasource db.provider` from `"sqlite"` to `"postgresql"`. Switch `String` JSON-blob columns on `Listing` (`imageUrls`, `features`) and `SweepRun.errors` to `Json`. Keep all other field types as-is.
- `prisma/migrations/` — delete every existing migration directory (they are SQLite-shaped and unrunnable on pg). Generate a new single `0_init` migration via `pnpm prisma migrate dev --name init` against a local pg.
- `prisma/migrations/migration_lock.toml` — regenerated to `provider = "postgresql"`.

### Test infrastructure
- `vitest.config.ts` — point `globalSetup` at a new `vitest.global-setup.ts`. Set `pool: 'forks'`, `poolOptions.forks.isolate: true` so each test file gets its own database connection.
- `vitest.global-setup.ts` (NEW) — boots a `postgres:16-alpine` testcontainer once per Vitest process. Writes the connection URL to a `globalThis.__PG_BASE_URL__` (or env var) for `vitest.setup.ts` to read. Tears down on `afterAll`.
- `vitest.setup.ts` (NEW or extend existing) — in `beforeAll`: connects to the base URL, `CREATE DATABASE test_${randomUUID().slice(0,8)}`, sets `process.env.DATABASE_URL` to the new DB URL, runs `prisma migrate deploy` programmatically (via `execa` or `child_process.execSync`). In `afterAll`: drops the DB.
- Existing per-test SQLite plumbing in `src/__tests__/**` — find the helper that creates a temp SQLite file (likely something like `createTestDb()` or inline `tmpdir()` calls), refactor to use the `DATABASE_URL` set by `vitest.setup.ts`. The 146 tests should not need to change shape; only the bootstrap helper does.
- `package.json` — add `testcontainers` (`@testcontainers/postgresql`) to `devDependencies`. Add `execa` if not already present.

### Compose + entrypoint
- `docker-compose.yml`:
  - Add `postgres` service: `image: postgres:16-alpine`, env `POSTGRES_DB=house_track`, `POSTGRES_USER=house_track`, `POSTGRES_PASSWORD` from `.env`, volume `pg-data:/var/lib/postgresql/data`, port mapping `127.0.0.1:5432:5432`, `healthcheck: pg_isready -U house_track`.
  - Add named volume `pg-data` to top-level `volumes:`.
  - Update `crawler` service: env `DATABASE_URL=postgresql://house_track:${POSTGRES_PASSWORD}@postgres:5432/house_track`, `depends_on: { postgres: { condition: service_healthy } }`. Drop the SQLite volume mount if any.
- `Dockerfile` (existing crawler image) — entrypoint runs `pnpm prisma migrate deploy` once before `node dist/index.js`. Likely a small `entrypoint.sh` or inline `CMD ["sh","-c","pnpm prisma migrate deploy && node dist/index.js"]`.
- `.env.example` — add `POSTGRES_PASSWORD=changeme`, `DATABASE_URL=postgresql://house_track:changeme@127.0.0.1:5432/house_track`.

### Persist-layer cleanups
- `src/persist.ts` — replace `JSON.stringify(...)` writes and `JSON.parse(...)` reads on the now-`Json`-typed columns with direct object passthrough. Prisma returns `Json` columns as `unknown` / typed via Prisma client.
- Anywhere else in `src/` that does `JSON.parse` on those columns — same simplification.

## Step-by-step implementation (TDD via `/feature` skill)

The `/feature` skill drives the RED → GREEN → REFACTOR → commit cycle.
This list is what to expect inside that cycle:

1. **PHASE 1.5 SPECIFY** — write `specs/postgres-migration.feature`. Scenarios:
   - "Crawler boots against postgres and applies migrations idempotently"
   - "SweepRun row round-trips through Json `errors` column"
   - "Listing row round-trips through Json `features` and `imageUrls` columns"
   - "Existing 146 tests still pass against testcontainer postgres"
   - "Compose stack starts postgres healthy before crawler"
2. **PHASE 2 RED** — testcontainer setup + first failing tests for the JSON-column round-trips. Existing test files refactored to consume `process.env.DATABASE_URL` from `vitest.setup.ts` instead of temp SQLite — they will fail until step 3 lands the schema/migration.
3. **PHASE 3 GREEN** — schema swap, regenerate `0_init`, simplify `src/persist.ts`. Run `pnpm test` until all 146 + new tests pass.
4. **PHASE 4 REFACTOR** — collapse `JSON.parse`/`JSON.stringify` boilerplate, add types where Prisma's `Json` returns `unknown`, ensure `vitest.setup.ts` is the single source of `DATABASE_URL` for tests.
5. **Compose + entrypoint** verified manually (not unit-tested):
   - `docker compose up postgres -d` → healthy.
   - `docker compose up --build crawler` → migrations applied, sweep completes, no schema errors in logs.
6. **Commit** with conventional-commit scope `db`: `feat(db): migrate sqlite → postgres + testcontainer test infra`.

## Constraints

- **No new feature work in this slice.** No `Setting` table, no `Source` table, no HTTP, no UI. Resist scope creep — those are slices 2–6 with their own commits.
- **No data migration script.** Fresh start is the locked decision.
- **Test parity is the bar.** All 146 existing tests must pass against pg before commit. If any test exposes a SQLite-specific assumption (e.g. naive `datetime('now')` string format), fix the test, not the schema.
- **Politeness, circuit, MCP behavior unchanged.** This is a storage-layer swap; no observable behavior change for the crawler or MCP tools.
- **Token discipline.** `/compact` after PHASE 2 RED, after PHASE 3 GREEN, and before commit.

## Verification (end of slice)

1. `pnpm prisma migrate dev --name init` produced a clean `0_init` SQL committed under `prisma/migrations/0_init/migration.sql`.
2. `pnpm test` — 146+ tests green against testcontainer pg. Cold run < 30s on first start (testcontainer pull), warm < 10s.
3. `pnpm typecheck` clean.
4. `docker compose up postgres -d && docker compose up --build crawler` — crawler boots, runs `prisma migrate deploy`, completes one sweep, no errors in `docker compose logs crawler`.
5. `pnpm prisma studio` against `DATABASE_URL` shows the expected tables (`Listing`, `Snapshot`, `Filter`, `ListingFilter`, `SweepRun`).
6. MCP smoke (regression): `pnpm mcp` from Claude Desktop, all three tools (`search_listings`, `list_filters`, `get_listing`) still return data.
