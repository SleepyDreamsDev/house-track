# Operator UI — Running & Operating the House Crawler

## Quick Start

The operator UI is a small web console for managing the crawler at runtime: tuning settings, reviewing sweep results, resetting the circuit breaker, and monitoring key metrics via Grafana.

### First run

```bash
# Copy environment template and set Postgres password
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD=<choose-a-password>

# Start all services: crawler, postgres, web UI, grafana
docker compose up --build -d

# Verify all services are healthy
docker compose ps

# Watch the crawler boot and begin its first sweep
docker compose logs -f crawler
```

Open http://127.0.0.1:3000 in your browser. The **Dashboard** tile will show the in-progress sweep.

## Architecture

```
docker-compose.yml
├── postgres:16         (port 127.0.0.1:5432) — data store
├── web:3000           (port 127.0.0.1:3000) — operator console
├── grafana:3001       (port 127.0.0.1:3001) — analytics dashboard
└── crawler            (background service) — crawls every hour
```

All services bind to `127.0.0.1` only — no public exposure. No authentication.

### Database

The crawler stores all data in Postgres (switched from SQLite):

- **Listing**: property records from 999.md (title, price, area, etc.)
- **SweepRun**: crawl job metadata (when it ran, how many details fetched, errors)
- **Setting**: runtime-configurable crawler settings (read by the operator UI and applied by the crawler on its next sweep)
- **Source**: crawl source definition (only `999md` is implemented; UI shows placeholder for future adapters)

Migrations run automatically on first boot via `Dockerfile` entrypoint.

## Pages

### Dashboard

Shows the current state at a glance:

- **Last sweep tile**: when it started, how long it ran, success/failure status
- **Circuit breaker tile**: green (closed, crawling normally) or red (open, paused for 24h after 3 consecutive failures)
- **"Open in Grafana" button**: jumps to the analytics dashboard in a new tab

Below: embedded Grafana dashboard showing key metrics:
- Total listings captured
- Active (not expired) listings
- Sweep success rate (last 24h)
- Average price (EUR)
- New listings per day (time series)
- Sweep duration (time series)
- Price distribution (histogram)

### Houses

Searchable, sortable table of all captured listings:

**Columns**: title (link to 999.md), price, area, rooms, district, first seen date

**Filters** (sidebar):
- Price range (EUR)
- Area range (m²)
- Room count range
- District (multi-select)
- Features (rooms with balcony, new build, etc.)

**Interactions**:
- Sort by any column
- Server-side pagination (scroll loads more)
- Click a row → detail slide-over with:
  - Full description and link to original listing
  - Photo carousel
  - Price history snapshot (how many times seen, price range)
  - All metadata fields

### Sweeps

Table of crawl jobs (SweepRun history):

**Columns**: started at, duration, status badge, pages fetched, details fetched, new listings, updated listings, error count

**Interactions**:
- Expand a row → full error log (JSON, syntax-highlighted)
- Top-left **"Reset circuit breaker"** button (red, destructive style):
  - Confirms before running
  - If breaker is already closed: shows "Already closed" toast
  - If breaker is open: deletes the sentinel file and restarts the crawler on next cron cycle

### Settings

Three sections, each a card:

#### 1. Crawler Tuning

Form with one row per overridable setting:

- **Label** (human-friendly name)
- **Current value** (from database, or default if not yet overridden)
- **Hint**: "(default: 8000ms)" to show the built-in baseline
- **Input field** (typed according to the setting's schema: number spinner for milliseconds, textarea for JSON, select for enum)
- **Save button** (optimistic update via TanStack Query; toast on success/error)

**Available settings** (from the crawl loop and fetch layer):
- `politeness.baseDelayMs` — gap between index requests (default: 8000)
- `politeness.jitterMs` — random jitter on top of base (default: 2000)
- `sweep.maxPagesPerSweep` — stop after this many index pages (default: 2)
- `sweep.backfillPerSweep` — backfill old listings in addition to new (default: 10)
- `sweep.cronSchedule` — cron expression (default: `0 * * * *` = every hour). **Note**: after editing, restart the crawler container for the new schedule to take effect.
- `circuit.consecutiveFailureThreshold` — failures before open (default: 3)
- `circuit.pauseDurationMs` — how long to pause (default: 86400000 = 24h)
- `filter.maxPriceEur` — cap price on capture (default: 250000)
- `filter.maxAreaSqm` — cap area on capture (default: 200)
- `log.level` — pino level (default: `info`); set to `debug` to see all HTTP requests

#### 2. Sources

Shows the available crawl sources (currently only `999md` is implemented):

Each source card displays:
- Base URL
- **Enabled toggle** (turn on/off to include/exclude in sweep loop)
- **"Edit overrides" button** → opens JSON editors for:
  - Politeness overrides (base delay, jitter, detail delay)
  - Filter overrides (price, area, category constraints specific to this source)

**"Add source" button** is present but yields a non-working entry — a banner explains that the pluggable adapter interface is not yet implemented. The UI is ready for future sources.

#### 3. Global Filter

A structured form to edit the filter criteria that the crawler applies to all sources:

- **Price ceiling (EUR)** — skip listings above this
- **Area ceiling (m²)** — skip listings above this
- **Category** — only capture houses & villas, skip apartments

**Live preview** shows the resulting GraphQL-like filter shape that will be sent to the crawler on next sweep.

## Grafana Dashboard

Open http://127.0.0.1:3001 in a new tab (or use the Dashboard page's "Open in Grafana" button).

The default dashboard is **"House-Track Overview"**. It loads anonymously and is locked to read-only (no editing).

**Panels**:
- Stats row: total listings, active, success rate, avg price
- Time series: new listings per day, sweep duration trend
- Histogram: price distribution (EUR)

The dashboard is **provisioned as code** — see `grafana/provisioning/dashboards/house-track.json`. Edit that file to add new panels, then restart:

```bash
docker compose restart grafana
```

All metrics come from the Postgres database — no external services. The Grafana datasource is read-only, so the crawler and web UI cannot corrupt it.

## How to... (common operations)

### Pause the crawler for a day

If the circuit breaker is open (red) on the Dashboard, the crawler is already paused. To pause or resume:

1. Go to **Sweeps page**
2. Click **"Reset circuit breaker"** button to toggle state

Alternatively, from the host terminal:

```bash
# Open the breaker (pause crawler)
touch data/.circuit_open
docker compose kill -s HUP crawler

# Close the breaker (resume crawler)
rm data/.circuit_open
docker compose kill -s HUP crawler
```

### Change politeness settings mid-crawl

1. Go to **Settings → Crawler Tuning**
2. Edit **`politeness.baseDelayMs`** to a new value (e.g., 12000 for 12 seconds)
3. Click Save
4. The next sweep will use the new delay. Verify in `docker compose logs -f crawler` — look for `sweep.done` log with the new delay reflected.

### Add a new setting

The UI loads all available settings from `/api/settings` at startup. To add a new one:

1. Edit `src/settings.ts` — add the key, default value, and zod validator
2. Optionally add a row in the **Settings** page UI (edit `web/src/pages/Settings.tsx`)
3. Commit and redeploy

### Export recent listings

The **Houses** table is queryable via the API (terminal on your machine):

```bash
curl http://127.0.0.1:3000/api/listings?limit=100
```

### Add a new crawl source (future)

Once the pluggable source adapter interface is implemented:

1. Edit `src/adapters/` to add a new source handler (copy `999md.ts` as a template)
2. Add a `Source` row in the Postgres console or via **Settings → Sources → "Add source"** button
3. The crawler will dispatch to the new adapter on next sweep

For now, the UI shows the form fields but any non-`999md` source will be skipped at crawl time.

## Security

- **Localhost only** — no firewall rules needed, not exposed to the internet
- **No authentication** — assumes trusted operator console (behind NAT/firewall)
- **Postgres read-only for Grafana** — the dashboard datasource cannot modify data
- **Settings validation** — all form inputs are validated with zod schemas server-side before storage

Do not expose the `web`, `grafana`, or `postgres` services to the public internet.

## Development

### Starting the dev server

Terminal 1 (crawler):

```bash
pnpm dev
```

Terminal 2 (web UI with HMR):

```bash
cd web && pnpm dev
```

The web dev server (Vite) proxies `/api` to `http://127.0.0.1:3000` (the production crawler server), so you can develop the UI and the backend independently.

### Building for production

```bash
pnpm build
docker compose up --build -d
```

The `Dockerfile.web` multi-stage build:
1. Builds the Vite SPA into `web/dist/`
2. Builds the server (TypeScript → JavaScript)
3. Copies both into the final image
4. Runs `node dist/web/server.js` on startup

### Database schema changes

Edit `prisma/schema.prisma`, then:

```bash
pnpm prisma migrate dev --name <description>
```

This creates a new migration file. Migrations run automatically in the Docker container on boot.

### Adding a new API route

1. Create a file in `src/web/routes/` (e.g., `src/web/routes/custom.ts`)
2. Export a Hono router: `export const router = new Hono()`
3. Register it in `src/web/server.ts`: `app.route('/api', customRouter)`
4. Test via `curl http://127.0.0.1:3000/api/custom/...`

### Testing

```bash
pnpm test              # all tests
pnpm test:watch       # watch mode
pnpm test:coverage    # coverage report
```

Tests run against a disposable Postgres testcontainer — see `vitest.setup.ts` for the setup.

## Troubleshooting

### Crawl is stuck / not running

1. Check **Dashboard** → Circuit breaker tile. If red, the crawler paused after 3 failures. Reset it via the **Sweeps** page button.
2. Check `docker compose logs -f crawler` for error messages.
3. Check `docker compose ps` — all four services should be `Up`. If one isn't, check its logs:
   ```bash
   docker compose logs postgres
   docker compose logs web
   docker compose logs grafana
   ```

### Cannot connect to database

1. Ensure `postgres` service is running and healthy: `docker compose ps`
2. Check that `.env` has `POSTGRES_PASSWORD=<something>` set
3. Stop and restart services:
   ```bash
   docker compose down
   docker compose up --build -d
   ```

### Settings changes not taking effect

The crawler **reads settings at the start of each sweep**. If you changed a setting and the next sweep doesn't reflect it:

1. Manually trigger a sweep by restarting the crawler:
   ```bash
   docker compose restart crawler
   ```
2. Or wait for the next cron-scheduled sweep (default: every hour at `:00`)

### Grafana dashboard is empty

Grafana starts with no data. After the first sweep completes (~5–10 min), refresh the dashboard. If still empty:

1. Check `docker compose logs grafana`
2. Verify the Postgres datasource is configured: **Grafana → Dashboards → Data sources → "house-track-postgres"** should show a green checkmark
3. Restart Grafana: `docker compose restart grafana`

## References

- [POC Spec](./poc-spec.md) — project scope and backlog
- [Architecture](./framework-architecture.md) — system design
- Source code: `src/web/` (backend API), `web/src/` (frontend SPA)
