# 999.md House Crawler — POC Spec

## Scope (locked)

| | |
|---|---|
| **Source** | 999.md only |
| **Category** | Houses & villas (not apartments) |
| **Deal** | Sale (cumpărare/vânzare) |
| **Location** | Chișinău + Durlești |
| **Constraints** | ≤ 200 m², ≤ €250,000 |
| **Cadence** | Hourly cron, 1 sweep/h |
| **Output** | SQLite, manual queries only |
| **Goal** | Build clean dataset for analysis phase later |

## Stack

- **Runtime**: Node 22 LTS, TypeScript
- **Fetcher**: `undici` (built-in fetch is fine, but undici has clean retry hooks); fallback Playwright if any page returns JS-only content
- **Parser**: `cheerio`
- **Scheduler**: `node-cron`
- **DB**: SQLite via Prisma
- **Logging**: `pino` (JSON to stdout → `docker logs`)
- **Container**: Docker Compose alongside HA on ZBook
- **Total LOC estimate**: ~250 lines

## File structure

```
property-crawler/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── index.ts          # cron entrypoint
│   ├── config.ts         # hardcoded filter (Phase 1), YAML loader later
│   ├── fetch.ts          # undici client w/ rate limit, retry, UA
│   ├── parse-index.ts    # cheerio: index page → listing stubs
│   ├── parse-detail.ts   # cheerio: detail page → full listing
│   ├── persist.ts        # upsert via Prisma
│   ├── circuit.ts        # 3×fail → 24h pause
│   └── log.ts            # pino setup
├── data/                 # bind mount → SQLite file lives here
│   └── crawler.db
└── README.md
```

## Database schema (Prisma)

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:/data/crawler.db"
}

generator client { provider = "prisma-client-js" }

model Listing {
  id              String   @id            // 999.md numeric ID, e.g. "76543210"
  url             String   @unique
  firstSeenAt     DateTime @default(now())
  lastSeenAt      DateTime
  lastFetchedAt   DateTime
  active          Boolean  @default(true) // false when no longer in index sweeps

  // Core fields (parsed)
  title           String
  priceEur        Int?     // null if not parseable
  priceRaw        String?  // original price string for audit
  rooms           Int?
  areaSqm         Float?
  landSqm         Float?   // houses have land
  district        String?  // raw value from breadcrumb/filter
  street          String?
  floors          Int?     // for houses: number of floors
  yearBuilt       Int?
  heatingType     String?  // raw text
  description     String?  // full body text
  features        String?  // JSON array of feature tags
  imageUrls       String?  // JSON array of CDN URLs (NOT downloaded)
  sellerType      String?  // private / agency (heuristic)
  postedAt        DateTime?
  bumpedAt        DateTime?

  // Versioning: track price/desc changes over time
  snapshots       ListingSnapshot[]

  @@index([active, lastSeenAt])
  @@index([priceEur])
}

model ListingSnapshot {
  id           Int      @id @default(autoincrement())
  listingId    String
  capturedAt   DateTime @default(now())
  priceEur     Int?
  description  String?
  rawHtmlHash  String   // sha256 of normalized HTML, for change detection
  listing      Listing  @relation(fields: [listingId], references: [id])

  @@index([listingId, capturedAt])
}

model SweepRun {
  id              Int      @id @default(autoincrement())
  startedAt       DateTime @default(now())
  finishedAt      DateTime?
  status          String   // ok / partial / failed / circuit_open
  pagesFetched    Int      @default(0)
  detailsFetched  Int      @default(0)
  newListings     Int      @default(0)
  updatedListings Int      @default(0)
  errors          String?  // JSON array of {url, status, msg}
}
```

## Hardcoded filter (Phase 1)

`src/config.ts`:

```ts
export const FILTER = {
  baseUrl: 'https://999.md/ro/list/real-estate/houses-and-villas',
  // Verify these param names by opening 999.md in browser, applying
  // filters, and copying the URL — param names use o_<id>_<id> format
  // and shift across category trees.
  params: {
    deal_type: 'sale',           // VERIFY: e.g. o_30_237=775
    location_chisinau: true,     // VERIFY: location_id for Chișinău
    location_durlesti: true,     // VERIFY: location_id for Durlești
    price_eur_max: 250000,       // VERIFY: price param + EUR currency code
    area_sqm_max: 200,           // VERIFY
  },
  maxPagesPerSweep: 20,          // safety cap; index has ~10 pages typically
};
```

**One-time setup task before first run**: open 999.md, apply filters by hand (Vând / Casă / Chișinău+Durlești / 0–250000 EUR / 0–200 m²), copy the resulting URL, paste param names into `config.ts`. Don't guess — param IDs vary by category.

## Crawl flow (per sweep)

1. **Pre-flight** — check circuit breaker. If open → log skip, exit.
2. **Build index URLs** — page 1..N from `FILTER.baseUrl + params`.
3. **Fetch index pages** sequentially:
   - 8s base delay + jitter ±2s between requests
   - Retry on 5xx: 3 attempts with exponential backoff (10s, 30s, 90s)
   - 403/429 → trip circuit breaker, abort sweep
4. **Parse stubs** — extract `{id, url, title, priceEur, postedAt}` per card.
5. **Diff against DB** — compute three sets:
   - `new` (id not in DB)
   - `seen` (id exists, present in this sweep → update `lastSeenAt`)
   - `gone` (id exists, active=true, missing for 3 consecutive sweeps → mark active=false)
6. **Fetch details** — only for `new` IDs (10s delay between detail fetches).
7. **Parse details** — extract full schema fields; compute `rawHtmlHash`.
8. **Persist** — upsert listing; insert snapshot if hash changed vs latest.
9. **Mark sweep complete** — write `SweepRun` row.

## Politeness budget

| | |
|---|---|
| Base inter-request delay | 8s + jitter ±2s |
| Concurrency | 1 |
| Max requests per sweep | ~20 index + N new details (typically 0–30) |
| Typical sweep duration | 5–10 min |
| Circuit breaker | 3 consecutive 4xx (excl. 404) → 24h pause |
| User-Agent | Realistic Firefox/Chrome on Linux, e.g. `Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0` |
| Headers | `Accept-Language: ro-RO,ru-RU;q=0.9,en;q=0.8`, `Accept: text/html,application/xhtml+xml`, no cookies |
| robots.txt | Re-run `pnpm verify-robots` (verified 2026-05-02 — `/graphql` not disallowed for `User-agent: *`; `/ro/<id>` is reference-only, not crawled). |

## Failure handling

- **Network error** → retry per backoff schedule, then log to `SweepRun.errors`, continue.
- **Parse error on a single listing** → log, skip that listing, continue sweep. Don't kill the run for one bad page.
- **Schema drift** (a required field missing) → log warning with sample HTML snippet, store partial data, flag for manual review. Better to capture incomplete data than lose the listing entirely.
- **Circuit open** → write `status=circuit_open`, exit. Manually clear by deleting the sentinel file `data/.circuit_open`.

## Docker Compose

```yaml
services:
  property-crawler:
    build: .
    container_name: property-crawler
    restart: unless-stopped
    volumes:
      - crawler-data:/data           # named volume (avoid bind mount perf issues on Win/WSL)
    environment:
      - NODE_ENV=production
      - TZ=Europe/Chisinau
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
volumes:
  crawler-data:
```

## Manual queries (Phase 1 analysis)

Connect via `sqlite3 /var/lib/docker/volumes/<vol>/_data/crawler.db` or expose a read-only DBeaver tunnel via Tailscale.

```sql
-- Today's new listings
SELECT id, title, priceEur, areaSqm, district, url
FROM Listing
WHERE firstSeenAt > datetime('now', '-1 day')
ORDER BY priceEur ASC;

-- Price drops in last 7 days
SELECT l.id, l.title,
       (SELECT priceEur FROM ListingSnapshot
        WHERE listingId=l.id ORDER BY capturedAt ASC LIMIT 1) AS firstPrice,
       l.priceEur AS currentPrice,
       l.url
FROM Listing l
WHERE l.active=1
  AND l.priceEur < (SELECT priceEur FROM ListingSnapshot
                    WHERE listingId=l.id ORDER BY capturedAt ASC LIMIT 1)
ORDER BY (currentPrice * 1.0 / firstPrice) ASC;

-- Median €/m² by district
SELECT district, COUNT(*) AS n,
       ROUND(AVG(priceEur * 1.0 / areaSqm)) AS avg_eur_per_sqm
FROM Listing
WHERE active=1 AND areaSqm > 0 AND priceEur > 0
GROUP BY district HAVING n >= 5
ORDER BY avg_eur_per_sqm DESC;

-- Sweep health
SELECT date(startedAt) AS day, COUNT(*) AS sweeps, SUM(newListings) AS new_total,
       SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) AS ok_count
FROM SweepRun GROUP BY day ORDER BY day DESC LIMIT 14;
```

## Acceptance criteria

POC is done when:

1. ✅ 7 consecutive days of hourly sweeps, ≥ 95% `status=ok`
2. ✅ ≥ 200 unique listings captured
3. ✅ Manual spot-check of 10 random listings: parsed fields match the live page
4. ✅ Zero 403/429 from 999.md across the week
5. ✅ Snapshots correctly capture at least one observed price change

## High-level backlog (post-POC, deferred)

**Phase 2 — Analysis layer**
- LLM scoring against natural-language prefs (Haiku 4.5, prompt cached rubric)
- Hash cache on normalized listing text (skip rescoring unchanged)
- Statistical underprice flag per (district × area-bucket × land-bucket) cohort

**Phase 3 — Delivery**
- Telegram bot (reuse @eg_ainews_bot pattern): per-listing alert OR daily digest
- Acknowledge/reject buttons → label store for prompt tuning

**Phase 4 — UI**
- React/Vite/Tailwind PWA on Cloudflare Pages
- Filter profile editor (replaces hardcoded config)
- Match feed, score+rationale display, manual review queue

**Phase 5 — Coverage**
- Add makler.md (Cloudflare-fronted, watch for challenges)
- Add lara.md (trivial, agency-only)
- Cross-source dedup (pHash on first image, fuzzy title+price+area)

**Phase 6 — Mobile / push**
- Capacitor wrap → Android first (FCM), iOS later if needed
- Web Push (VAPID) for desktop in PWA

**Phase 7 — Optional**
- Telegram channel ingestion via Telethon
- Photo analysis via vision LLM
- Sold-price calibration when MD's Registrul prețurilor goes live

## Risks for POC specifically

- **Param IDs in 999.md URLs are opaque** (`o_30_237=775`). Do not trust; copy from a real browser session.
- **Durlești location coding**: may be a sub-filter under Chișinău or a separate region. Verify in URL.
- **Price normalization**: ~90% of houses are in EUR but watch for MDL/USD listings — store `priceRaw` always, normalize separately.
- **Container time zone**: SQLite stores naive datetimes. Set `TZ=Europe/Chisinau` in compose so `datetime('now')` matches local cron behavior.
- **First-time index page volume**: day 1 will fetch detail for *all* current listings (~200–500). Expect a 30–60 min initial sweep. Subsequent sweeps drop to 1–10 details.

---

## Phase 4 — Operator UI (delivered ahead of schedule)

The UI shipped earlier than planned, consolidating work from slices 2–6:

**What's delivered:**

- **Postgres migration** (slice 1): SQLite → Postgres/testcontainers. All 146 existing tests green. Clean schema with `Setting` (runtime config), `Source` (crawl sources), and JSON column support.
- **Settings layer** (slice 2): `getSetting`/`setSetting` API. Crawler reads politeness, filter, cron, circuit breaker, and logging settings at sweep-start. Defaults in `src/config.ts`, overrides in Postgres. Keys namespaced: `politeness.baseDelayMs`, `sweep.maxPagesPerSweep`, etc.
- **Hono API** (slice 3): `/api/sweeps`, `/api/listings`, `/api/filters`, `/api/settings`, `/api/sources`, `/api/circuit`. Integration tests for each route.
- **Vite SPA** (slice 4): React 18 + TS strict + Tailwind v4 + shadcn/ui. Four pages: Dashboard, Houses, Sweeps, Settings. TanStack Query + react-hook-form + zod. Server-side pagination, optimistic updates.
- **Grafana provisioning** (slice 6): Postgres datasource, dashboard JSON (stats, time series, histogram). Embedded iframe on Dashboard page. Read-only, anonymously accessible on `127.0.0.1:3001`.

**Not in this slice:**

- Pluggable source adapters — UI ready, but only `999md` implemented.
- Cron reschedule hot-reload — operator restarts crawler after editing schedule.
- Auth / TLS.

**How to run:**

See [`docs/operator-ui.md`](./operator-ui.md).

