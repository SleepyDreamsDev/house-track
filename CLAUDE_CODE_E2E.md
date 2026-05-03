# house-track UI redesign — end-to-end instructions for Claude Code

You are picking up a UI redesign in this repo. A `port-kit/` folder has been
unzipped at the project root. Your job is to (A) install it into the right
locations, then (B) replace the stub backends with real implementations.

When done, a fresh clone should `pnpm install && pnpm prisma migrate deploy &&
pnpm dev` and have a fully working redesigned operator UI talking to real data.

---

## A. Install the kit (do this first, in order)

### A1. Move the kit files into place

```bash
# From repo root.
# Frontend: replaces existing files, adds new ones. Existing tests stay put.
cp -R port-kit/web/. web/

# Backend stubs: new files only, none collide with existing routes.
mkdir -p src/web/routes
cp port-kit/server/events.ts            src/web/events.ts
cp port-kit/server/routes/sweeps.detail.ts   src/web/routes/sweeps.detail.ts
cp port-kit/server/routes/sweeps.stream.ts   src/web/routes/sweeps.stream.ts
cp port-kit/server/routes/stats.ts           src/web/routes/stats.ts
cp port-kit/server/routes/listings.feed.ts   src/web/routes/listings.feed.ts

# Prisma migration as a real migration directory.
TS=$(date +%Y%m%d%H%M%S)
mkdir -p prisma/migrations/${TS}_sweep_detail_columns
cp port-kit/prisma/migration.sql prisma/migrations/${TS}_sweep_detail_columns/migration.sql
```

After verifying the build, delete the kit:

```bash
rm -rf port-kit
```

### A2. Update Prisma schema

In `prisma/schema.prisma`, add to the `SweepRun` model:

```prisma
model SweepRun {
  // …existing fields…
  configSnapshot Json?
  pagesDetail    Json?
  detailsDetail  Json?
  eventLog       Json?
}
```

Then:

```bash
pnpm prisma migrate dev --name sweep-detail-columns   # in dev
# or in CI/prod: pnpm prisma migrate deploy
pnpm prisma generate
```

### A3. Register new routes

In `src/web/server.ts` (the Hono app), add:

```ts
import { sweepDetailRouter } from './routes/sweeps.detail.js';
import { sweepStreamRouter } from './routes/sweeps.stream.js';
import { statsRouter } from './routes/stats.js';
import { listingsFeedRouter } from './routes/listings.feed.js';

app.route('/api', sweepDetailRouter);
app.route('/api', sweepStreamRouter);
app.route('/api', statsRouter);
app.route('/api', listingsFeedRouter);
```

Order doesn't matter — none of the new paths collide with existing ones.

### A4. Smoke test

```bash
pnpm install
pnpm -C web install
pnpm dev
```

Open http://localhost:5173. You should see:

- Dashboard with KPI strip, "New today" + "Price drops" cards, district bars (stub data)
- Houses page with filter rail and card list (uses existing `/api/listings`)
- Sweeps with circuit-breaker banner and table (uses existing `/api/sweeps`)
- Sweep detail at `/sweeps/:id` (stub data)
- Settings with grouped sections — but typed controls won't render properly
  yet because `/api/settings` doesn't return `group/kind/unit` fields. Task 4
  fixes this.

If anything 500s, fix the route registration before continuing.

---

## B. Implementation tasks (replace stubs with real impls)

Do these in order. Each ends with an acceptance test you must pass before
moving on.

### Task 1 — Persist sweep detail to Postgres

**Why:** SweepDetail page can't show pages/details/config until the crawler
writes them.

**Files:** `src/sweep.ts` (or wherever the sweep loop lives), `src/persist.ts`
if separate.

**Steps:**

1. At sweep start, call `prisma.settings.findMany()` (or whatever the resolved-
   settings function is), serialize, and stash into `configSnapshot` when you
   create the SweepRun row.
2. Inside the index-page loop, push to a local array:
   ```ts
   pagesDetail.push({ n, url, status, bytes, parseMs, found, took });
   ```
3. Inside the detail-fetch loop, push:
   ```ts
   detailsDetail.push({ id, url, status, bytes, parseMs, action, priceEur });
   ```
   where `action` is `'new' | 'updated'` based on insert vs upsert outcome.
4. Subscribe to pino events for the active sweep (see Task 2 emitter), keep a
   ring buffer of the last 200, and write to `eventLog` on completion.
5. On sweep finalization (success/failure), persist all four arrays in one
   `prisma.sweepRun.update`.

**Then remove the stub branch in `src/web/routes/sweeps.detail.ts`** and
uncomment the REAL IMPL block. Drop the stub return.

**Acceptance:**

- After a sweep completes: `psql ... -c 'SELECT id, jsonb_array_length(pagesDetail) FROM "SweepRun" ORDER BY "startedAt" DESC LIMIT 1;'` shows non-zero length.
- `curl http://localhost:3000/api/sweeps/<id>` returns the populated payload (no stub fields).
- SweepDetail page in the browser shows real pages/details for a finished sweep.

### Task 2 — Live event stream over SSE

**Why:** The Sweep detail "Live" hero needs real-time progress without polling.

**Files:** `src/log.ts`, `src/sweep.ts`, `src/web/events.ts` (already in kit),
`src/web/routes/sweeps.stream.ts` (already in kit; keep as-is unless the
emitter shape changes).

**Steps:**

1. In `src/sweep.ts`, when a sweep is active, set a module-scoped
   `currentSweepId`. Clear it on finalize.
2. In `src/log.ts`, after pino formats each line, also call:
   ```ts
   import { sweepEvents } from './web/events.js';
   if (currentSweepId) {
     sweepEvents.emitEvent({
       sweepId: currentSweepId,
       t: new Date().toLocaleTimeString('en-GB', { hour12: false }),
       lvl: line.level,
       msg: line.msg,
       meta: line.meta ? JSON.stringify(line.meta) : undefined,
     });
   }
   ```
   (Adjust depending on whether you're using a pino transport, a custom write
   stream, or a child logger. The cleanest path is a custom write stream that
   tees to both stdout and the emitter.)
3. Verify the SSE route returns `Content-Type: text/event-stream` and flushes
   each event.

**Acceptance:**

- Trigger a sweep manually (`POST /api/sweeps`), open `/sweeps/<id>` in the
  browser. Index-page progress bar advances; "Currently fetching" updates;
  events tail appends without page reload.
- `curl -N http://localhost:3000/api/sweeps/<id>/stream` while a sweep is
  running prints `data: {...}\n\n` lines in real time.
- No memory leak: kill the browser tab, `sweepEvents.listenerCount('event')`
  decreases (the route's cleanup `off()` runs).

### Task 3 — Real dashboard queries

**Why:** Replace stubbed `/api/stats/*` and `/api/listings/{new-today,price-drops}` with real Prisma queries.

**Files:** `src/web/routes/stats.ts`, `src/web/routes/listings.feed.ts`.

Each stub has a `// TODO (Claude Code, Task 3): real query` block with the
SQL sketch. Replace each with the Prisma equivalent. Keep response shapes
identical so the frontend is unchanged.

**Acceptance:**

- Dashboard "By district" matches `SELECT district, COUNT(*) FROM "Listing" WHERE "deletedAt" IS NULL GROUP BY district` exactly.
- "New today" count equals listings whose `firstSeenAt > now() - 24h`.
- "Price drops" only includes listings with ≥5% price drop in the last 7d.
- Sparkline shows 7 daily counts oldest→newest.

### Task 4 — Settings metadata

**Why:** Settings page renders typed controls (numbers w/ units, selects, etc.)
based on metadata. Without it everything degrades to a text input.

**Files:** `src/settings.ts` (the zod registry), `src/web/routes/settings.ts`
(extend existing route — DO NOT add a new file).

**Steps:**

1. In `src/settings.ts`, enrich each entry with `{ group, kind, unit?, hint?, options?, label? }`.
2. In `GET /api/settings` and `GET /api/settings/:key`, include those fields
   in the response. Keep `value` and `default` as-is.
3. Mapping:

   | key                                 | group           | kind   | unit     |
   | ----------------------------------- | --------------- | ------ | -------- |
   | politeness.baseDelayMs              | Politeness      | number | ms       |
   | politeness.jitterMs                 | Politeness      | number | ms       |
   | sweep.maxPagesPerSweep              | Sweep           | number | pages    |
   | sweep.backfillPerSweep              | Sweep           | number | listings |
   | sweep.cronSchedule                  | Sweep           | text   | —        |
   | circuit.consecutiveFailureThreshold | Circuit breaker | number | failures |
   | circuit.pauseDurationMs             | Circuit breaker | number | ms       |
   | filter.maxPriceEur                  | Filter          | number | €        |
   | filter.maxAreaSqm                   | Filter          | number | m²       |
   | log.level                           | Logging         | select | —        |

   For `log.level`, set `options: ['debug','info','warn','error']`.

**Acceptance:**

- Settings page groups settings into the sections above.
- Number inputs show the unit suffix.
- `log.level` shows a dropdown.
- Save button works and persists across reload.

### Task 5 — Listings sort + filter params

**Why:** Frontend sends `sort` and `district` query params; existing
`/api/listings` may not honor them.

**Files:** `src/web/routes/listings.ts` (existing).

**Steps:**

1. Accept query params: `sort=newest|price|eurm2`, `district=<name>`,
   `flags=priceDrop,belowMedian` (comma-separated).
2. Map to Prisma:
   - `sort=newest` → `orderBy: { firstSeenAt: 'desc' }`
   - `sort=price` → `orderBy: { priceEur: 'asc' }`
   - `sort=eurm2` → raw query (`ORDER BY priceEur / NULLIF(areaSqm,0) ASC`)
   - `district=X` → `where: { district: X }`
   - `flags=priceDrop` → join against snapshot table where latest < earliest by ≥5%

**Acceptance:** all filter rail controls produce different result sets;
sort segmented control reorders cards.

### Task 6 — Tests

**Files:** `src/__tests__/`, `web/src/__tests__/`, `specs/*.feature`.

For each preceding task, add a test:

- T1: integration test for `/api/sweeps/:id` against a SweepRun row with populated JSON columns.
- T2: BDD spec — `running sweep emits SSE events`. Use `node:http` request to read 2-3 events.
- T3: contract tests for each new endpoint shape.
- T4: contract test that `/api/settings` includes `group` and `kind` for every key.
- T5: per-param test for sort/filter on `/api/listings`.

Match existing test style. Do not add new dependencies.

---

## C. Definition of done

All of these must hold:

- [ ] `pnpm test` is green
- [ ] `pnpm -C web typecheck` is green
- [ ] `pnpm prisma migrate status` shows no pending migrations
- [ ] Dashboard shows real values for active count, by-district, new-per-day, new-today, price-drops
- [ ] Sweep detail (`/sweeps/:id`) renders for finished + failed sweeps using only DB data
- [ ] Live sweep streams SSE events end-to-end (no setInterval polling for progress)
- [ ] Settings page renders typed controls (numbers w/ units, select for log level)
- [ ] Listings filter rail (search, max price, district, sort) all work end-to-end
- [ ] `port-kit/` directory deleted from repo
- [ ] No new npm dependencies added

## D. Constraints

- **Don't redesign.** All Tailwind classes and component shapes are intentional.
  If you need new colors, add them to `tailwind.config.ts` — don't replace
  existing tokens.
- **Don't break old API consumers.** Existing tests must still pass — extend
  responses, don't replace fields.
- **Don't change the URL scheme.** `/sweeps/:id` is now part of the public
  routing contract.
- **Keep stubs working until each task ships.** A half-migrated state is fine,
  but never push a state where a page 500s on stub-removed endpoints.

## E. Hand-off

When all six tasks are green, post a PR with:

- Migration name + reversibility note
- One-line description of each new route
- Any new env vars (there shouldn't be any)
- A short before/after screenshot for each redesigned page
