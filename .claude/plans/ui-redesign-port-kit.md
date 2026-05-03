# UI redesign port-kit — install + backend wire-up

## Context

`port-kit/` (already unzipped at repo root) ships a redesigned operator UI:
KPI strip Dashboard, filter-rail Houses, Sweep table with circuit banner,
and a new `/sweeps/:id` detail page with live SSE progress, HTTP log, event
tail, errors and config-snapshot tabs. The CLAUDE-Code-E2E brief
(`CLAUDE_CODE_E2E.md`) covers section A (drop-in install) and section B
(replace stubs with real impls — Tasks 1–6).

The redesign is intentionally pixel-fixed; we install the kit verbatim. The
backend, however, has a handful of gaps that the brief glosses over but
must be closed before the UI is real (not stubbed):

- crawler and web API run in **separate Node processes**, but the kit's SSE
  bridge is an in-process `EventEmitter` (Task 2 cannot work as-shipped);
- `/api/listings` returns a bare array, but every UI page consumes
  `{ listings, total }` — including the **already-shipped** page, which is
  silently broken in prod and only green in tests because tests mock the
  shape;
- the Dashboard's "Run sweep now" and SweepDetail's "Cancel sweep" buttons
  have **no endpoints**;
- `SweepRun` has no `source`/`trigger`/`durationMs` columns but the kit
  emits them in API responses;
- existing frontend Vitest tests assert old strings ("Listings", "Reset
  Circuit Breaker", "Crawler Tuning") and will fail against the new pages.

This plan installs the kit, ships Tasks 1–4 (the parts that close the
biggest gaps), and **escalates Tasks 5–6 + tested-button endpoints to the
backlog** so we don't try to land a 6-task megabranch in one go. Outcome:
the redesigned UI renders against real data for Dashboard, Sweeps,
SweepDetail, Settings; live SSE works; Listings filter rail still flows
through but with caveats that ship as backlog items.

---

## Plan

Five sequential phases. Each ships behind one PR; do not bundle.

### Phase 0 — Install the kit (A1–A4 of E2E doc)

**Files moved (verbatim, no edits):**

- `port-kit/web/.` → `web/.` (overwrites `Dashboard.tsx`, `Listings.tsx`,
  `Sweeps.tsx`, `Settings.tsx`, `router.tsx`, `tailwind.config.ts`; adds
  `pages/SweepDetail.tsx`, `lib/format.ts`, `lib/sse.ts`, `components/ui/{KStat,PageHeader,PhotoPlaceholder,Sparkline,StatusDot,Toggle}.tsx`)
- `port-kit/server/events.ts` → `src/web/events.ts`
- `port-kit/server/routes/sweeps.detail.ts` → `src/web/routes/sweeps.detail.ts`
- `port-kit/server/routes/sweeps.stream.ts` → `src/web/routes/sweeps.stream.ts`
- `port-kit/server/routes/stats.ts` → `src/web/routes/stats.ts`
- `port-kit/server/routes/listings.feed.ts` → `src/web/routes/listings.feed.ts`
- `port-kit/prisma/migration.sql` → `prisma/migrations/<TS>_sweep_detail_columns/migration.sql`

**`prisma/schema.prisma` edits** (additive, in `SweepRun`):

```prisma
configSnapshot   Json?
pagesDetail      Json?
detailsDetail    Json?
eventLog         Json?
```

Then `pnpm prisma migrate dev --name sweep-detail-columns && pnpm prisma generate`.

**`src/web/server.ts` edits** — adapt port-kit's `app.route('/api', router)`
to this project's `register*Routes(app, prisma)` pattern. Keep the existing
pattern; mount each new router by importing its `Hono` instance and
calling `app.route('/api', router)`. Both styles compose in Hono.

**Existing frontend tests rewrite**
(`web/src/__tests__/{Dashboard,Listings,Settings,Sweeps}.test.tsx`):
update assertions to match new strings ("Houses", "Reset breaker", "New
today", group section names, etc.). Brief allows this — only **backend**
tests must remain non-breaking.

**Delete `port-kit/`** at the end.

**Verify:** `pnpm install && pnpm -C web install && pnpm dev`; load
`http://localhost:5173`; every page renders without 500s (stub data still
wired). `pnpm test` green; `pnpm -C web typecheck` green.

### Phase 1 — Co-locate crawler + web API (foundation for Task 2)

**Why now:** the kit's SSE design is in-process. Without Phase 1, Task 2
silently no-ops in production (cron crawler emits to an EventEmitter the
web process never sees). Two options were considered:

- **Co-locate** (chosen): `src/index.ts` calls `createApiApp()` and starts
  the Hono `serve()` next to `cron.schedule(...)` in the same Node process.
  No new deps, no transport, EventEmitter just works.
- LISTEN/NOTIFY over Postgres: works cross-process, but adds non-trivial
  Prisma raw-query plumbing and stretches the "no new deps" rule via
  long-lived `pg` connections. Defer.

**Files to edit:**

- `src/index.ts` — import `createApiApp` from `./web/server.js` and
  `serve` from `@hono/node-server`. After `bootstrap()` schedules cron,
  start the API on port 3000 (same as today).
- `Dockerfile` — already runs `node dist/index.js`, no edits needed.
- `docker-compose.yml` — `property-crawler` service: add `ports: -
  '127.0.0.1:3000:3000'` so the API is reachable from the host (and from
  the Vite dev server's proxy).

**Verify:** `RUN_ONCE=0` mode boots cron + API together; `curl
localhost:3000/api/health` returns 200 with crawler still scheduled.

### Phase 2 — Task 1 (persist sweep detail) + Task 4 (settings metadata)

These two are independent and small; bundle.

**Task 1 — `src/sweep.ts` + `src/persist.ts`**

- Extend `SweepResult` (`src/persist.ts:14`) with
  `pagesDetail: Array<{n,url,status,bytes,parseMs,found,took}>` and
  `detailsDetail: Array<{id,url,status,bytes,parseMs,action,priceEur}>`.
  Default to `[]`.
- In `runSweep` (`src/sweep.ts:42`), after `startSweep()`, call a new
  `persist.snapshotConfig(sweepId)` that reads resolved settings via
  `listSettings()` and writes `configSnapshot`. Reuse `listSettings()`
  from `src/settings.ts:87` — do not re-define.
- In `collectIndexStubs` (`src/sweep.ts:83`), capture `Date.now()` before
  `fetchSearchPage`, byte length from the JSON, parse duration, and
  `stubs.length` as `found`. Push to `result.pagesDetail`. URL string can
  be synthesized as `<search-page-${page}>` for now (the GraphQL endpoint
  is constant; page index identifies the page) — flag as backlog if a
  real URL is needed.
- In `fetchAndPersistDetails` (`src/sweep.ts:108`), capture the same
  timing and the `action` (`'new'` or `'updated'`) — derivable from the
  `diffAgainstDb` result the caller already has. Pass `seenStubs` ids in
  so we can label.
- `persist.finishSweep` (`src/persist.ts:150`) must serialize
  `pagesDetail`, `detailsDetail`, and the eventLog ring buffer (Phase 3
  populates the ring buffer; Phase 2 just persists empty arrays). All
  JSON columns nullable.
- `src/web/routes/sweeps.detail.ts` — uncomment the REAL IMPL block,
  remove the stub. **Coerce the URL `:id` param via `parseInt`** —
  `SweepRun.id` is `Int` (`prisma/schema.prisma:90`), the kit assumes
  string. Return the kit's response shape verbatim.

**Task 4 — `src/settings.ts` + `src/web/routes/settings.ts`**

- Extend `settingSchemas` map → array of records with metadata (no zod
  shape change). Add `meta` keyed object alongside `defaultValues`:

  ```ts
  const settingMeta: Record<string, {
    group: string; kind: 'number'|'text'|'select';
    unit?: string; options?: string[]; label?: string; hint?: string;
  }> = { ... }; // exactly the table from CLAUDE_CODE_E2E.md §Task 4
  ```

- `listSettings()` returns the metadata fields alongside `value`/`default`.
- `GET /api/settings` (`src/web/routes/settings.ts:6`) projects
  `{key, value, default, group, kind, unit?, options?, label?, hint?}`.
  Existing test (`server.test.ts:114`) only asserts `200`, so the shape
  extension is safe.

**Verify:**

- `psql ... -c 'SELECT id, jsonb_array_length("pagesDetail") FROM "SweepRun" ORDER BY "startedAt" DESC LIMIT 1;'` is non-zero after a sweep finishes.
- `curl /api/sweeps/<id>` returns the populated payload.
- `curl /api/settings` includes `group` and `kind` for every key. Settings
  page shows grouped sections + unit suffixes + log.level dropdown.

### Phase 3 — Task 2 (live SSE) + Task 3 (real dashboard queries)

**Task 2 — pino → EventEmitter tee**

- Add an `activeSweepId` module variable in `src/sweep.ts`; set in
  `runSweep` after `startSweep`, clear in `finally`. Export a
  `getActiveSweepId()` getter so `log.ts` can read it.
- In `src/log.ts`, replace the bare `pino()` with a pino instance that
  writes to **both** stdout and a custom write stream:

  ```ts
  import { Writable } from 'node:stream';
  import { sweepEvents } from './web/events.js';
  import { getActiveSweepId } from './sweep.js';

  const teeStream = new Writable({ write(chunk, _, cb) {
    process.stdout.write(chunk); // preserve stdout JSON
    try {
      const line = JSON.parse(chunk.toString());
      const sweepId = getActiveSweepId();
      if (sweepId) sweepEvents.emitEvent({
        sweepId: String(sweepId),
        t: new Date(line.time ?? Date.now()).toLocaleTimeString('en-GB', { hour12: false }),
        lvl: ['','','info','warn','error','fatal'][Math.floor((line.level ?? 30)/10)] as any,
        msg: line.event ?? line.msg ?? '',
        meta: line.meta ? JSON.stringify(line.meta) : JSON.stringify(line),
      });
    } catch { /* non-JSON line */ }
    cb();
  }});
  export const log = pino({ level: ... }, teeStream);
  ```

  (The cyclic `log.ts → web/events.ts → log.ts` is fine because
  `events.ts` imports nothing from `log.ts`.)
- Maintain a ring buffer of the last 200 emitted events on `runSweep` and
  flush to `eventLog` in `finishSweep`.
- `src/web/routes/sweeps.stream.ts` already streams; **fix the `id`
  comparison** — kit compares string-to-string but `sweepId` is a number.
  Coerce both sides via `String(...)`.

**Task 3 — real Prisma queries**

- `src/web/routes/stats.ts`:
  - `/stats/by-district` → `prisma.$queryRaw` per the SQL sketch in the
    stub. Order by count desc, drop nulls (`WHERE district IS NOT NULL`).
  - `/stats/new-per-day` → 7-day day-bucketed count, oldest first; pad
    missing days with 0.
- `src/web/routes/listings.feed.ts`:
  - `/listings/new-today` → `prisma.listing.findMany` with `firstSeenAt
    >= now()-24h`, `active: true`, `orderBy firstSeenAt desc`, `take: 10`.
    Project the kit's expected fields (`id`, `title`, `priceEur`,
    `areaSqm`, `landSqm?`, `rooms?`, `district`, `street?`,
    `firstSeenAt`, `isNew: true`).
  - `/listings/price-drops` → for listings with `active: true`, fetch the
    earliest and latest `ListingSnapshot.priceEur` in the past 7d via two
    correlated subqueries (or `prisma.listing.findMany` with `snapshots:
    { orderBy: { capturedAt }, take: N }` then filter in JS for ≥5%
    drop). The schema's `@@index([listingId, capturedAt])` makes either
    cheap. Project `priceWas` from earliest, `priceEur` from current,
    `priceDrop: true`.

**Verify:**

- Trigger a sweep; open `/sweeps/<id>` in the browser. Live progress bar
  advances; events tail appends without page reload.
- `curl -N /api/sweeps/<id>/stream` while a sweep runs prints `data:
  {...}\n\n` lines.
- Dashboard "By district" matches `SELECT district, COUNT(*) FROM
  "Listing" WHERE "active" = true GROUP BY district`.
- "New today" + "Price drops" return real rows.

### Phase 4 — Cleanup + DOD checklist

- Delete `port-kit/` directory + commit the deletion separately.
- Run full test suite (`pnpm test`) + frontend (`pnpm -C web test`) +
  typecheck both.
- Update `.claude/progress.md` per session-reporting rule.

---

## Critical files

- `src/sweep.ts:42` — runSweep, the orchestrator we're hooking
- `src/persist.ts:14,150` — SweepResult shape + finishSweep writeback
- `src/log.ts` — pino tee target for SSE
- `src/web/server.ts:13` — Hono mount point for new routers
- `src/web/routes/sweeps.detail.ts` — uncomment real impl in Phase 2
- `src/web/routes/sweeps.stream.ts` — fix id coercion in Phase 3
- `src/web/routes/stats.ts`, `listings.feed.ts` — real queries in Phase 3
- `src/web/routes/settings.ts:6` — shape extension in Phase 2
- `src/settings.ts:87` — `listSettings()` returns metadata
- `prisma/schema.prisma:89` — SweepRun JSON columns
- `src/index.ts:100` — co-locate API in Phase 1

---

## Reused, do not reinvent

- `listSettings()` (`src/settings.ts:87`) for `configSnapshot` + `/settings` shape
- `searchListings()` (`src/mcp/queries.ts`) for `/listings` filtering
- `Persistence.diffAgainstDb` result for the `action` field on detailsDetail
- Existing `app.get('/api/sweeps/:id/errors')` (`src/web/routes/sweeps.ts:48`)
  stays; the new `GET /api/sweeps/:id` does not collide

---

## Backlog items to add (out-of-scope for this PR set)

Append to `.claude/plans/backlog.md` under a new "Priority 2.5 — UI
redesign follow-ups" section:

1. **Task 5 — Listings sort + filter params + response envelope.**
   `/api/listings` currently returns a bare array; every UI page (old and
   new) expects `{ listings, total }`. Rewrap the response (returns
   `total` via a second `prisma.listing.count` with the same `where`).
   Wire `sort=newest|price|eurm2`, `district`, and `q` (title ILIKE) into
   `searchListings`. Wire `flags=priceDrop` via the same snapshot
   compare from Phase 3 Task 3. Update existing backend test to assert
   the new envelope.

2. **Task 6 — Tests for Phases 0–3.** Vitest contract tests for each new
   route, BDD spec for SSE in `specs/sweep-sse-stream.feature`, and an
   integration test that creates a `SweepRun` row with populated JSON
   columns and asserts the `/api/sweeps/:id` payload.

3. **`POST /api/sweeps` (manual trigger).** Dashboard's "Run sweep now"
   has no endpoint. Ship as a thin wrapper that calls `runSweep(deps)`
   on demand (deps already built in `src/index.ts:33`). Guard with the
   circuit breaker.

4. **`POST /api/sweeps/:id/cancel` (cancellation).** SweepDetail "Cancel
   sweep" button has no endpoint. Requires an `AbortController` plumbed
   through `Fetcher` + `runSweep` so an in-flight tick can be
   short-circuited; non-trivial — track separately.

5. **Add `source` + `trigger` columns to `SweepRun`.** Kit's
   `/api/sweeps/:id` returns these but the schema has no such fields.
   For Phase 2 we hard-code `source: '999.md'`, `trigger: 'cron'` so the
   UI renders; the columns belong in a follow-up migration so the
   backfill backfill flag and any future manual-trigger work can record
   the real provenance.

6. **`durationMs` on `/api/sweeps` list response.** Kit's Sweeps table
   expects `durationMs`; existing list omits it. Compute as `finishedAt -
   startedAt` (null when running) and add to the projection in
   `src/web/routes/sweeps.ts:12`.

7. **SweepDetail `progress` + `currentlyFetching` fields.** Live banner
   needs structured progress (phase, pagesDone/Total, queued, etc.) — Task
   1 captures the rows but not the live progress shape. Either compute
   from the sweep's in-memory ring buffer or add a `currentSweepProgress`
   getter the SSE route exposes inside the initial event.

8. **Crawler ↔ Web cross-process bus (longer-term).** Phase 1 co-locates
   the two services for SSE. If we ever need to scale them independently
   (e.g., crawler in K8s, API on the edge), revisit with Postgres
   LISTEN/NOTIFY or a small Redis pub/sub.

---

## Verification (end-to-end after Phase 4)

1. `pnpm install && pnpm prisma migrate deploy && pnpm prisma generate`
2. `pnpm dev` (boots cron + API in one process); `pnpm -C web dev` (Vite)
3. Browser: `http://localhost:5173`
   - Dashboard: real district bars, real sparkline, real new-today/price-drops feeds
   - Houses: filter rail still works (sort/q/flags backed by stubs from
     Task 5 backlog item — flag in PR description)
   - Sweeps: table populated, circuit-breaker banner, click row → detail
   - `/sweeps/:id`: for finished sweeps, all 5 tabs render real data
   - Settings: grouped sections, number+unit inputs, log.level dropdown,
     save persists
4. `RUN_ONCE=1 pnpm dev` triggers a sweep; in another terminal `curl -N
   localhost:3000/api/sweeps/<id>/stream` prints live events; browser
   `/sweeps/<id>` shows the live banner advancing.
5. `pnpm test` green. `pnpm -C web typecheck` green. `pnpm -C web test`
   green (after rewriting the 4 frontend tests in Phase 0).
6. `pnpm prisma migrate status` clean. `port-kit/` deleted.

DOD checklist from `CLAUDE_CODE_E2E.md` §C: items 1–6, 8, 9, 10 hit in
this PR set; item 7 (Listings filter rail end-to-end) deferred to backlog
Task 5.
