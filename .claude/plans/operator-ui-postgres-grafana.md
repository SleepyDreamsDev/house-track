# Operator UI + Postgres migration + Grafana

## Context

The crawler has been running headless: a cron-driven Node process, results queryable
only via `pnpm prisma studio` or the MCP server in Claude Desktop. Operating it
(pausing the breaker, retuning politeness, watching sweep health, reviewing what
it has captured) requires either editing `src/config.ts` and redeploying, or
SSH-ing in and reading pino JSON.

This feature adds the operator surface: a small localhost-only web UI for
**settings**, **crawl progress**, and a **houses table**, plus an embedded
**Grafana** instance for the (small set of) key analytics. To make Grafana work
cleanly with Prisma, the SQLite store is swapped for Postgres in the same change.
Settings become runtime-mutable via a key/value `Setting` table; sources are
modeled (`Source` table) with 999.md remaining the only working adapter for now.

The result: a single `docker compose up` brings up `crawler` + `postgres` +
`grafana` + `web`, all bound to `127.0.0.1`, no auth, no public exposure.

## Decisions (already aligned with user)

- **DB**: SQLite → Postgres, drop existing data, fresh initial migration.
- **Settings model**: single `Setting (key TEXT PK, valueJson JSONB, updatedAt)` table; `src/config.ts` stays as the defaults file. Read path: `getSetting(key) ?? DEFAULTS.key`.
- **Sources**: `Source` table modeled and editable in the UI; only the `999md` adapter actually runs. No adapter-interface refactor in this feature — the data shape is ready, the dispatch is not.
- **Grafana**: native Postgres datasource (no community SQLite plugin needed once we move).
- **Deployment**: localhost-only. `web` on `127.0.0.1:3000`, `grafana` on `127.0.0.1:3001`, `postgres` on `127.0.0.1:5432`. No auth, no TLS.
- **Frontend stack**: Vite + React 18 + TS strict + Tailwind v4 + shadcn/ui + TanStack Query + TanStack Table + react-hook-form + zod. Charts handled by Grafana (no Recharts in app).
- **Backend HTTP**: Hono (ESM-native, tiny, fits Node 22 + undici + Prisma).
- **frontend-design skill**: invoked during PHASE 3 GREEN of the UI domain to drive the visual pass on the four screens.

## Architecture

```
docker-compose.yml
├── postgres          (image: postgres:16-alpine, volume: pg-data, port 127.0.0.1:5432)
├── grafana           (image: grafana/grafana:latest, provisioned datasource + dashboards, 127.0.0.1:3001)
├── crawler           (existing service; DATABASE_URL → postgres; reads runtime overrides)
└── web               (NEW; Hono API + built Vite SPA, served from same Node process, 127.0.0.1:3000)
```

Single Node process for `web` keeps deploy simple: Hono mounts `/api/*` and falls through to `serveStatic('dist/')` for the SPA. SPA is built into the same container at image build time.

## Files to create / modify

### Backend — DB layer
- `prisma/schema.prisma` — change datasource provider `sqlite` → `postgresql`. Add `Source` model (`id`, `slug` unique, `name`, `baseUrl`, `adapterKey`, `enabled`, `politenessOverridesJson`, `filterOverridesJson`, `createdAt`, `updatedAt`). Add `Setting` model (`key` PK, `valueJson` Json, `updatedAt`). `imageUrls`/`features`/`errors` JSON columns: switch from `String` (SQLite) to `Json` (postgres).
- `prisma/migrations/` — delete existing SQLite migrations, generate `0_init` against postgres.
- `prisma/seed.ts` (NEW) — seeds the single `999md` Source row + a defaults snapshot of every overridable setting key. Wire `prisma db seed` in `package.json`.

### Backend — settings/source plumbing
- `src/settings.ts` (NEW) — `getSetting<T>(key, fallback): Promise<T>`, `setSetting(key, value)`, `listSettings()`. Keys are namespaced strings: `politeness.baseDelayMs`, `politeness.jitterMs`, `sweep.maxPagesPerSweep`, `sweep.backfillPerSweep`, `sweep.cronSchedule`, `circuit.consecutiveFailureThreshold`, `circuit.pauseDurationMs`, `filter.maxPriceEur`, `filter.maxAreaSqm`, `filter.searchInputJson`, `log.level`. Validate writes with zod schemas defined alongside.
- `src/config.ts` — stays as the defaults source. Existing call sites refactored to call `getSetting(...)` lazily where mutability matters (sweep loop, fetch headers, circuit breaker init). Politeness headers / UA stay constants — not user-tunable.
- `src/sweep.ts` — read `sweep.maxPagesPerSweep`, `sweep.backfillPerSweep` per sweep. Read `filter.searchInput` per sweep.
- `src/fetch.ts` — read `politeness.baseDelayMs`, `politeness.jitterMs`, `politeness.detailDelayMs` per request batch (cache for the duration of one sweep).
- `src/circuit.ts` — read `circuit.*` at breaker init.
- `src/index.ts` — read `sweep.cronSchedule` at boot. Cron reschedule on change is out-of-scope; document that the operator restarts the crawler after editing it.

### Backend — HTTP API
- `src/web/server.ts` (NEW) — Hono app. Mounts `/api/*` JSON routes + `serveStatic` for `dist/`. Uses `PrismaClient` singleton from a new `src/web/db.ts` (so `web` and `crawler` services don't share a process — each gets its own connection pool).
- `src/web/routes/sweeps.ts` — `GET /api/sweeps?limit=20` reads `SweepRun` desc by `startedAt`. `GET /api/sweeps/latest` for the dashboard tile. `GET /api/sweeps/:id/errors` returns the parsed `errors` JSON.
- `src/web/routes/listings.ts` — `GET /api/listings` (delegates to `searchListings` from `src/mcp/queries.ts` — reuse). `GET /api/listings/:id` (delegates to `getListing`).
- `src/web/routes/filters.ts` — `GET /api/filters` (delegates to `listFilters`).
- `src/web/routes/settings.ts` — `GET /api/settings` returns `{ key, value, default, schema }[]`. `PATCH /api/settings/:key` validates with the per-key zod schema and writes via `setSetting`.
- `src/web/routes/sources.ts` — `GET /api/sources`, `PATCH /api/sources/:id` (toggle enabled, edit overrides). `POST /api/sources` allowed but adapter will reject anything but `adapterKey === '999md'` for now (UI shows a "no adapter available" badge for the rest).
- `src/web/routes/circuit.ts` — `GET /api/circuit` returns `{ open: boolean, openedAt?: string, sentinelPath: string }`. `DELETE /api/circuit` deletes the sentinel file. (Operator escape hatch already documented in CLAUDE.md.)
- `package.json` — add `web` script: `tsx watch src/web/server.ts`. Build script: `vite build && tsc -p tsconfig.web.json`.

### Frontend — Vite SPA in `web/`
- `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tailwind.config.ts`, `web/postcss.config.js` — standard Vite + Tailwind v4 setup. `vite.config.ts` proxies `/api` → `http://127.0.0.1:3000` in dev.
- `web/src/main.tsx`, `web/src/App.tsx`, `web/src/router.tsx` — react-router v6 with four routes.
- `web/src/lib/api.ts` — typed fetch helpers. Types imported from a shared `src/web/api-types.ts` (re-exported from the backend, kept as the single source of truth).
- `web/src/lib/query.ts` — TanStack Query client.
- `web/src/components/ui/` — shadcn primitives (Button, Card, Table, Input, Select, Switch, Dialog, Badge, Toast). `pnpm dlx shadcn@latest add ...` once.
- `web/src/components/layout/AppShell.tsx` — left nav (Dashboard, Houses, Sweeps, Settings) + main content. Minimal, monospace-flavored header with crawler status pill (green = circuit closed + last sweep < 2h, yellow = stale, red = circuit open).
- **Pages (4):**
  - `web/src/pages/Dashboard.tsx` — last-sweep tile, circuit-state tile, "open in Grafana" button + a single `<iframe src="http://127.0.0.1:3001/d/house-track/overview?kiosk&theme=dark">` for the key analytics panel grid (see Grafana section below).
  - `web/src/pages/Houses.tsx` — TanStack Table of listings. Columns: title (link to 999.md), priceEur, areaSqm, rooms, district, firstSeenAt. Filter sidebar: price range, room range, area range, district select, feature/option multi-select (sourced from `/api/filters`). Sort dropdown. Server-side pagination (`limit` + offset; reuse `searchListings`). Row click opens a slide-over Drawer with `getListing` detail (image carousel, full description, filter triples, snapshot history).
  - `web/src/pages/Sweeps.tsx` — TanStack Table of `SweepRun` rows. Columns: startedAt, durationMs, status badge, pagesFetched, detailsFetched, newListings, updatedListings, errorCount. Expandable row reveals the `errors` JSON. Top action: "Reset circuit breaker" button (destructive style, confirms) — calls `DELETE /api/circuit`.
  - `web/src/pages/Settings.tsx` — three sections, each a Card:
    1. **Crawler tuning**: form generated from `/api/settings` metadata. Each row: label, current value, default-value hint, edit input (typed by zod schema), Save button. Optimistic update via TanStack Query.
    2. **Sources**: Source list (just `999md` initially). Each card shows baseUrl, enabled toggle, "edit overrides" expanding to politeness/filter override JSON editors (Monaco-lite or just a textarea with zod validation). "Add source" button is present but yields a non-working entry — banner explains adapter is not yet implemented.
    3. **Global filter**: structured editor for `filter.searchInput` (price ceiling, area ceiling, category) backed by the same setting key. Live preview of the resulting GraphQL filter shape.
- **Visual pass**: at PHASE 3 GREEN of the UI domain, invoke `frontend-design` skill to drive the design language (typography, spacing, monochrome palette with a single accent, density choices for the tables, empty/loading/error states). The brief: "minimalistic operator console for a polite-crawler POC, dense over decorative, mono numerals, single accent color for state."

### Infra
- `docker-compose.yml`:
  - Add `postgres` service: `postgres:16-alpine`, `POSTGRES_DB=house_track`, `POSTGRES_USER=house_track`, password from `.env`, volume `pg-data:/var/lib/postgresql/data`, healthcheck on `pg_isready`. Bind `127.0.0.1:5432`.
  - Add `grafana` service: `grafana/grafana:latest`, mount `./grafana/provisioning` for datasource + dashboards. Bind `127.0.0.1:3001`. `GF_AUTH_ANONYMOUS_ENABLED=true`, `GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer`, `GF_SECURITY_ALLOW_EMBEDDING=true` (for the dashboard iframe).
  - Add `web` service: built from a new `Dockerfile.web` (multi-stage: build SPA, build server, copy both). Depends on postgres healthy. Bind `127.0.0.1:3000`.
  - Update `crawler` service: `DATABASE_URL=postgresql://house_track:...@postgres:5432/house_track`, `depends_on: postgres (healthy)`.
- `.env.example` — add `POSTGRES_PASSWORD=...`, `DATABASE_URL=...`.
- `grafana/provisioning/datasources/postgres.yml` — Postgres datasource pointing at `postgres:5432/house_track`, read-only user (provisioned by an init script in `postgres/init/01-readonly.sql` mounted into the postgres container).
- `grafana/provisioning/dashboards/house-track.json` — dashboard with 4–5 panels (Stats: total listings, active listings, sweeps last 24h success rate, average price; Time series: new listings per day, sweep duration; Histogram: priceEur distribution). Provisioned as code so the dashboard is reproducible and gitops-friendly.
- `Dockerfile` (existing crawler) — add `pnpm prisma migrate deploy` to entrypoint so migrations run on first boot.
- `Dockerfile.web` (NEW) — multi-stage. Stage 1 builds `web/` Vite SPA. Stage 2 builds `src/web/` server. Final stage copies both, runs `node dist/web/server.js`.

### Testing strategy (matters because Postgres changes the test story)
- **Per-process Postgres via testcontainers**: add `vitest.setup.ts` with a `globalSetup` hook that starts a `postgres:16-alpine` testcontainer once per Vitest process and exports its URL. Each test file in `src/__tests__/` gets a unique database (`CREATE DATABASE test_${randomUUID().slice(0,8)}`); migrations run via `prisma migrate deploy` against it; cleanup drops the DB. ~3-5s startup once, then tests are fast.
- **Existing 146 tests**: refactored from per-test temp SQLite to per-file Postgres DB. The query shapes are identical — only the connection string differs.
- **New tests** (TDD per `/feature` cycle):
  - `src/web/__tests__/server.test.ts` — Hono routes integration (each route, happy + 4xx).
  - `src/__tests__/settings.test.ts` — `getSetting`/`setSetting` round-trip, default fallback, zod validation rejection.
  - `src/__tests__/sources.test.ts` — Source CRUD, adapter-availability flag.
  - `web/src/**/*.test.tsx` — react-testing-library + happy-dom for the four pages: render, filter interactions, optimistic settings save, error boundaries.

### Docs
- `docs/poc-spec.md` — append a "Phase 4 (delivered)" section noting that the UI shipped earlier than planned and what's in scope.
- `docs/operator-ui.md` (NEW) — short operator runbook: how to bring the stack up, how to read the dashboard, how to reset the breaker, how to tune politeness, where Grafana lives.
- `CLAUDE.md` — update Stack section (add Postgres, Hono, Vite, Tailwind, Grafana). Update Quick Start. Add `web` and `grafana` to scopes.
- `docs/mcp-setup.md` — note that MCP keeps working unchanged; web UI is complementary.

## Critical files to read before implementing

- `prisma/schema.prisma` — current shape, JSON column handling.
- `src/config.ts` — every constant that needs a setting key.
- `src/mcp/queries.ts` — `searchListings`/`listFilters`/`getListing` are reused as-is in HTTP routes.
- `src/sweep.ts` — call sites that need `getSetting(...)`.
- `src/persist.ts` — `SweepRun` writes; HTTP `GET /api/sweeps` mirrors this shape.
- `docs/poc-spec.md` §"Phase 4 — UI" (lines 262–276) — the long-term shape we're partially delivering.

## Verification

End-to-end smoke after implementation:

1. `cp .env.example .env`, fill `POSTGRES_PASSWORD`.
2. `docker compose up --build -d` — all four services green; `docker compose ps`.
3. `docker compose logs -f crawler` — first sweep starts, Postgres connection healthy, no schema errors.
4. Open `http://127.0.0.1:3000` — Dashboard loads, last sweep tile shows the in-progress / completed run.
5. **Houses page**: filter by `priceEur ≤ 200000`, sort by newest, click a row → drawer opens with the full listing.
6. **Sweeps page**: rows present, expand the latest → no errors. Click "Reset circuit breaker" with breaker closed → toast says "already closed". Manually `touch data/.circuit_open`, refresh → status pill flips red, click reset → sentinel deleted.
7. **Settings page**: change `politeness.baseDelayMs` from `8000` → `12000`, save. Watch `crawler` logs — next sweep uses the new gap (verify timestamp delta in `sweep.done` log).
8. **Grafana**: open `http://127.0.0.1:3001`, dashboard "House-Track Overview" auto-loads. Panels render real data from postgres.
9. `pnpm test` (in CI / locally) — all 146 existing tests + new ones green against testcontainer postgres.
10. `pnpm typecheck` clean.
11. MCP smoke (regression): `pnpm mcp` from Claude Desktop, all three tools still work against postgres.

## Out of scope (deferred)

- Pluggable source adapters (only the `999md` adapter ships).
- Cron-schedule hot-reload (operator restarts crawler after editing).
- Auth / TLS / public exposure.
- LLM scoring (poc-spec Phase 2).
- Telegram delivery (poc-spec Phase 3).
- Mobile / Capacitor wrap (poc-spec Phase 6).
- Migrating existing SQLite data — fresh start, the crawler repopulates within ~5 days of backfill.

## Suggested execution order (per `/feature` TDD)

1. **Postgres migration** as its own merge-able slice: schema change + testcontainers test infra + run all 146 tests against postgres. Land before anything else; keeps the blast radius contained.
2. **Settings + Source tables + getSetting/setSetting** + sweep/fetch/circuit refactor to consume them. Verify crawler still runs identically with no overrides set.
3. **HTTP API layer** (Hono) + `web` service in compose. Verify each route via curl.
4. **Vite SPA scaffold** + four pages with placeholder styling, wired to the API. Functional, ugly.
5. **frontend-design pass** on the four pages — visual language, density, states.
6. **Grafana provisioning** + dashboard JSON + iframe embed in Dashboard page.
7. **Docs**: poc-spec append, operator-ui.md, CLAUDE.md updates.

Each step is independently testable and shippable. Recommend `/feature-parallel` for steps 3–6 once step 1–2 land, since API + SPA + Grafana provisioning are independent domains.
