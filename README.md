# house-track

A small, polite crawler that watches **999.md** for houses and villas for sale
in **Chișinău + Durlești** under **€250,000** and **≤ 200 m²**, and stores
results in SQLite for analysis.

> POC scope. Source of truth: [`docs/poc-spec.md`](./docs/poc-spec.md).

## Stack

- Node 22 LTS · TypeScript (strict, ESM)
- `undici` · `cheerio` · `node-cron` · `pino`
- Prisma + SQLite
- Vitest · pnpm
- Docker Compose (alongside Home Assistant on the ZBook)
- TDD framework from [`claude-tdd-starter`](https://github.com/SleepyDreamsDev/claude-tdd-starter)

## Quick start

```bash
pnpm install
pnpm prisma generate
pnpm prisma migrate dev --name init   # first run only
pnpm dev                               # local watch mode
```

To run the way it'll run in prod:

```bash
docker compose up --build -d
docker compose logs -f property-crawler
```

## Before the first crawl

1. **Fill in the filter params** in `src/config.ts`. The 999.md URL params
   (`o_<id>_<id>=<value>`) are opaque and shift across category trees — open
   the site in a browser, apply filters by hand (Vând / Casă / Chișinău+Durlești
   / 0–250000 EUR / 0–200 m²), and copy the resulting URL.
2. **Verify robots.txt** — `curl -A "Mozilla/5.0..." https://999.md/robots.txt`
3. **Initial sweep is heavy** — day 1 fetches detail for all current listings
   (~200–500). Expect 30–60 min. Subsequent sweeps drop to 1–10 detail fetches.

## Layout

```
src/
  index.ts          cron entrypoint
  config.ts         hardcoded FILTER (Phase 1)
  fetch.ts          undici client w/ rate limit, retry, UA
  parse-index.ts    cheerio: index page → listing stubs
  parse-detail.ts   cheerio: detail page → full Listing
  persist.ts        Prisma upsert + snapshot diff
  circuit.ts        3×fail → 24h pause sentinel
  log.ts            pino setup
prisma/schema.prisma  Listing · ListingSnapshot · SweepRun
docs/poc-spec.md      full POC specification (read this)
```

## Acceptance criteria (POC)

POC is done when:

1. 7 consecutive days of hourly sweeps, ≥ 95% `status=ok`
2. ≥ 200 unique listings captured
3. Manual spot-check of 10 random listings: parsed fields match the live page
4. Zero 403/429 from 999.md across the week
5. Snapshots correctly capture at least one observed price change

## Data access

```bash
# Inside the container's named volume:
sqlite3 /var/lib/docker/volumes/house-track_crawler-data/_data/crawler.db
```

See [`docs/poc-spec.md`](./docs/poc-spec.md) §"Manual queries" for ready-made
SQL (today's new listings, price drops, median €/m² by district, sweep health).

## Development workflow

This project ships with the `claude-tdd-starter` TDD harness:

- `/feature <description>` — Gherkin → RED → GREEN → REFACTOR → SHIP
- `/fix <description>` — lightweight bug-fix path
- `/security` — OWASP review on unstaged changes

See [`CLAUDE.md`](./CLAUDE.md) for the full reference.

## License

MIT — see [`LICENSE`](./LICENSE).
