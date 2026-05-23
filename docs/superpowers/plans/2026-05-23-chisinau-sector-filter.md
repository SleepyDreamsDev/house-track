# Chișinău Sector Filter Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive Chișinău city sectors (Centru, Botanica, Râșcani, Ciocana, Buiucani) from listing text and expose them as a `sector` filter on the Listings and Analytics pages.

**Architecture:** `sector` becomes a persisted, nullable `Listing` column (set only for `district = 'Chișinău'`), derived by a pure function at detail-persist time and backfilled once. It is SQL-filterable exactly like `district`, so it paginates correctly on Listings and aggregates cleanly in Analytics. The filter rail surfaces a sector multi-select only when classified rows exist.

**Tech Stack:** Node 22 + TS (ESM, `.js` import suffixes), Prisma + Postgres, Hono API, Vitest + testcontainers, React 18 + Vite (happy-dom tests).

**Spec:** `docs/superpowers/specs/2026-05-23-chisinau-sector-filters-design.md`

**Conventions reminder:** TS strict + `exactOptionalPropertyTypes`; relative imports end in `.js`; Conventional Commits with scopes from CLAUDE.md (`persist`, `db`, `mcp`, `web`, …); one Gherkin `Scenario:` per `it()`; testcontainer Postgres per test file; **test seeds must set `sector` the way `persist.ts` does**.

---

### Task 1: Gherkin spec

**Files:**
- Create: `specs/chisinau-sector-filters.feature`

- [ ] **Step 1: Write the feature file**

```gherkin
Feature: Chișinău sector filter
  Derive city sectors from listing text and filter Listings/Analytics by them.

  Scenario: Explicit sector mention classifies a Chișinău listing
    Given a listing with district "Chișinău" and title "Casă cu 3 niveluri, sect. Centru"
    When the sector is derived
    Then the sector is "Centru"

  Scenario: Bare keyword in the street classifies a Chișinău listing
    Given a listing with district "Chișinău" and street "str. Buiucani"
    When the sector is derived
    Then the sector is "Buiucani"

  Scenario: Gazetteer neighborhood classifies when no sector keyword is present
    Given a listing with district "Chișinău" and street "str. Sculeni"
    When the sector is derived
    Then the sector is "Buiucani"

  Scenario: A Chișinău listing with no signal is left unclassified
    Given a listing with district "Chișinău" and street "str. Nuferilor" and no sector words
    When the sector is derived
    Then the sector is null

  Scenario: A commune listing is never assigned a sector
    Given a listing with district "Durlești"
    When the sector is derived
    Then the sector is null

  Scenario: Listings can be filtered to a single sector
    Given active Chișinău listings in sectors "Centru" and "Botanica"
    When I request "/api/listings?sector=Centru"
    Then only the "Centru" listings are returned

  Scenario: Sector facet lists only sectors that have listings
    Given active Chișinău listings only in sector "Ciocana"
    When I request "/api/listings/facets"
    Then the sectors facet contains "Ciocana" and no other sector

  Scenario: An empty sector parameter is rejected
    When I request "/api/listings?sector="
    Then the response status is 400

  Scenario: Analytics accepts the same sector filter
    Given active Chișinău listings in sectors "Centru" and "Ciocana"
    When I request "/api/analytics/overview?sector=Centru"
    Then the analytics slice covers only the "Centru" listings
```

- [ ] **Step 2: Commit**

```bash
git add specs/chisinau-sector-filters.feature
git commit -m "test(web): gherkin spec for chisinau sector filter"
```

---

### Task 2: `deriveSector` pure function

**Files:**
- Create: `src/lib/chisinau-sector.ts`
- Test: `src/lib/__tests__/chisinau-sector.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { deriveSector, CHISINAU_SECTORS } from '../chisinau-sector.js';

const base = { district: 'Chișinău', street: null, title: null, description: null };

describe('deriveSector', () => {
  it('Explicit sector mention classifies a Chișinău listing', () => {
    expect(deriveSector({ ...base, title: 'Casă cu 3 niveluri, sect. Centru' })).toBe('Centru');
  });

  it('Bare keyword in the street classifies a Chișinău listing', () => {
    expect(deriveSector({ ...base, street: 'str. Buiucani' })).toBe('Buiucani');
  });

  it('Diacritic-insensitive keyword matches Râșcani', () => {
    expect(deriveSector({ ...base, description: 'apartament in riscani' })).toBe('Râșcani');
  });

  it('Gazetteer neighborhood classifies when no sector keyword is present', () => {
    expect(deriveSector({ ...base, street: 'str. Sculeni' })).toBe('Buiucani');
  });

  it('A Chișinău listing with no signal is left unclassified', () => {
    expect(deriveSector({ ...base, street: 'str. Nuferilor', title: 'Casă, 49 m²' })).toBeNull();
  });

  it('A commune listing is never assigned a sector', () => {
    expect(deriveSector({ district: 'Durlești', street: 'str. Centru', title: null, description: null })).toBeNull();
  });

  it('Null district is never assigned a sector', () => {
    expect(deriveSector({ ...base, district: null, street: 'str. Botanica' })).toBeNull();
  });

  it('exposes the five official sectors', () => {
    expect([...CHISINAU_SECTORS]).toEqual(['Centru', 'Botanica', 'Râșcani', 'Ciocana', 'Buiucani']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/chisinau-sector.test.ts`
Expected: FAIL — cannot find module `../chisinau-sector.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/chisinau-sector.ts
//
// Best-effort derivation of Chișinău city sectors from listing free text.
// The 999.md source does NOT subdivide Chișinău (it is one flat locality),
// so sectors are inferred from street/title/description and are expected to
// miss — unclassifiable city listings return null ("Unknown"). Communes and
// non-Chișinău districts always return null.

export const CHISINAU_SECTORS = ['Centru', 'Botanica', 'Râșcani', 'Ciocana', 'Buiucani'] as const;
export type ChisinauSector = (typeof CHISINAU_SECTORS)[number];

// Generic sector keywords, diacritic- and ASCII-tolerant. Order is irrelevant
// (first hit wins); Centru is intentionally last so a neighborhood like
// "Telecentru" still resolves to Centru but more specific words win first.
const KEYWORDS: ReadonlyArray<readonly [RegExp, ChisinauSector]> = [
  [/botanica/i, 'Botanica'],
  [/r[âîi]șcani|riscani|rascani/i, 'Râșcani'],
  [/ciocana/i, 'Ciocana'],
  [/buiucani/i, 'Buiucani'],
  [/telecentru|centru/i, 'Centru'],
];

// Well-known neighborhoods/streets with no sector word in them. Best-effort,
// expected to be incomplete.
const GAZETTEER: ReadonlyArray<readonly [RegExp, ChisinauSector]> = [
  [/sculeni/i, 'Buiucani'],
  [/po[șs]ta\s+veche/i, 'Râșcani'],
  [/schinoasa/i, 'Centru'],
  [/valea\s+morilor/i, 'Centru'],
];

export function deriveSector(input: {
  district: string | null;
  street: string | null;
  title: string | null;
  description: string | null;
}): ChisinauSector | null {
  if (input.district !== 'Chișinău') return null;
  const hay = [input.street, input.title, input.description].filter(Boolean).join(' ');
  if (!hay) return null;

  // 1. Explicit "sect. X" / "sectorul X" — strongest signal.
  const explicit = hay.match(
    /sect(?:or(?:ul)?)?\.?\s*(botanica|r[âîi]șcani|riscani|rascani|ciocana|buiucani|centru)/i,
  );
  if (explicit) {
    for (const [re, sector] of KEYWORDS) if (re.test(explicit[0])) return sector;
  }

  // 2. Bare keyword anywhere.
  for (const [re, sector] of KEYWORDS) if (re.test(hay)) return sector;

  // 3. Gazetteer neighborhoods.
  for (const [re, sector] of GAZETTEER) if (re.test(hay)) return sector;

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/chisinau-sector.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: REFACTOR + typecheck**

Run: `pnpm typecheck`
Expected: no errors. Make no behavior changes; only tidy if needed, re-run the test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chisinau-sector.ts src/lib/__tests__/chisinau-sector.test.ts
git commit -m "feat(parse): deriveSector — best-effort Chișinău sector from listing text"
```

---

### Task 3: Schema column + migration

**Files:**
- Modify: `prisma/schema.prisma` (the `model Listing` block)

- [ ] **Step 1: Add the column + index**

In `model Listing`, add after the `district` field:

```prisma
  sector      String?  // derived Chișinău city sector; null for communes + unclassified
```

and add to the `@@index` block at the bottom of the model:

```prisma
  @@index([sector])
```

- [ ] **Step 2: Create + apply the migration**

Run: `pnpm prisma migrate dev --name add_listing_sector`
Expected: creates `prisma/migrations/<ts>_add_listing_sector/migration.sql` containing
`ALTER TABLE "Listing" ADD COLUMN "sector" TEXT;` and a `CREATE INDEX`, and applies it.
(If the dev DB isn't running: `docker compose up -d postgres` first.)

- [ ] **Step 3: Verify the client regenerated**

Run: `pnpm typecheck`
Expected: no errors (Prisma client now has `sector`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add Listing.sector column + index"
```

---

### Task 4: Set `sector` on persist

**Files:**
- Modify: `src/persist.ts` (the `persistDetail` method, `writable` object)
- Test: `src/__tests__/persist-sector.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Persistence } from '../persist.js';
import type { ParsedDetail } from '../types.js';

// Mirrors other persist tests: testcontainer Postgres is provisioned by
// vitest.global-setup.ts; DATABASE_URL is already set in the test env.
const prisma = new PrismaClient();

function detail(overrides: Partial<ParsedDetail>): ParsedDetail {
  return {
    id: 'sec-1',
    url: 'https://999.md/ro/sec-1',
    title: 'Casă, sect. Centru',
    priceEur: 100000,
    priceRaw: '100000 EUR',
    rooms: null,
    areaSqm: 100,
    landSqm: null,
    district: 'Chișinău',
    street: 'str. Test',
    floors: null,
    yearBuilt: null,
    heatingType: null,
    description: null,
    features: null,
    imageUrls: null,
    sellerType: null,
    postedAt: null,
    bumpedAt: null,
    rawHtmlHash: 'h1',
    filterValues: [],
    ...overrides,
  };
}

describe('persistDetail sets sector', () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await prisma.listingFilterValue.deleteMany(); await prisma.listingSnapshot.deleteMany(); await prisma.listing.deleteMany(); });

  it('derives and stores the sector for a Chișinău listing', async () => {
    await new Persistence(prisma).persistDetail(detail({ id: 'sec-1' }));
    const row = await prisma.listing.findUnique({ where: { id: 'sec-1' } });
    expect(row?.sector).toBe('Centru');
  });

  it('leaves sector null for a commune listing', async () => {
    await new Persistence(prisma).persistDetail(detail({ id: 'sec-2', district: 'Durlești', title: 'Casă Durlești', street: 'str. Centru' }));
    const row = await prisma.listing.findUnique({ where: { id: 'sec-2' } });
    expect(row?.sector).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/persist-sector.test.ts`
Expected: FAIL — `row.sector` is `null` for the first case (column not yet written).

- [ ] **Step 3: Wire `deriveSector` into `persistDetail`**

At the top of `src/persist.ts` add the import (next to the other imports):

```ts
import { deriveSector } from './lib/chisinau-sector.js';
```

In `persistDetail`, add `sector` to the `writable` object (right after the `district` line):

```ts
      district: detail.district,
      sector: deriveSector({
        district: detail.district,
        street: detail.street,
        title: detail.title,
        description: detail.description,
      }),
```

(Both `create` and `update` spread `writable`, so both paths get the value; it is recomputed on every detail refresh.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/persist-sector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persist.ts src/__tests__/persist-sector.test.ts
git commit -m "feat(persist): set Listing.sector via deriveSector on detail persist"
```

---

### Task 5: Backfill script for existing rows

**Files:**
- Create: `scripts/backfill-sectors.ts`

- [ ] **Step 1: Write the script**

```ts
// scripts/backfill-sectors.ts
// One-time/idempotent backfill: compute Listing.sector for Chișinău rows that
// don't have one yet. Safe to re-run. Usage: pnpm tsx scripts/backfill-sectors.ts
import { PrismaClient } from '@prisma/client';
import { deriveSector } from '../src/lib/chisinau-sector.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.listing.findMany({
    where: { district: 'Chișinău', sector: null },
    select: { id: true, district: true, street: true, title: true, description: true },
  });
  let updated = 0;
  for (const r of rows) {
    const sector = deriveSector(r);
    if (sector) {
      await prisma.listing.update({ where: { id: r.id }, data: { sector } });
      updated += 1;
    }
  }
  console.warn(`backfill-sectors: examined ${rows.length}, classified ${updated}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => void prisma.$disconnect());
```

- [ ] **Step 2: Run it against the dev DB**

Run: `pnpm tsx scripts/backfill-sectors.ts`
Expected: prints `examined N, classified M` (M ≈ 60–65% of Chișinău city rows). No error.

- [ ] **Step 3: Typecheck (scripts tsconfig) + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add scripts/backfill-sectors.ts
git commit -m "feat(persist): backfill-sectors script for existing Chișinău rows"
```

---

### Task 6: `sector` facet in `/api/listings/facets`

**Files:**
- Modify: `src/web/routes/listings.ts` (the `/api/listings/facets` handler)
- Test: `src/web/routes/__tests__/listings-facets-sector.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Hono } from 'hono';
import { registerListingsRoutes } from '../listings.js';

const prisma = new PrismaClient();
const app = new Hono();
registerListingsRoutes(app, prisma);

async function seed(id: string, sector: string | null) {
  const now = new Date();
  await prisma.listing.create({
    data: { id, url: `https://999.md/${id}`, title: `Casă ${id}`, priceEur: 100000, areaSqm: 100,
      district: 'Chișinău', sector, active: true, lastSeenAt: now, lastFetchedAt: now },
  });
}

describe('GET /api/listings/facets sectors', () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await prisma.listing.deleteMany(); });

  it('Sector facet lists only sectors that have listings', async () => {
    await seed('a', 'Ciocana');
    await seed('b', null);
    const res = await app.request('/api/listings/facets');
    const body = (await res.json()) as { sectors?: { name: string; count: number }[] };
    expect(body.sectors).toEqual([{ name: 'Ciocana', count: 1 }]);
  });

  it('omits the sectors key entirely when no row has a sector', async () => {
    await seed('c', null);
    const res = await app.request('/api/listings/facets');
    const body = (await res.json()) as Record<string, unknown>;
    expect('sectors' in body).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/web/routes/__tests__/listings-facets-sector.test.ts`
Expected: FAIL — `body.sectors` is `undefined`.

- [ ] **Step 3: Add the sectors aggregate to the facets handler**

In `src/web/routes/listings.ts`, inside the `/api/listings/facets` handler, before the final `return c.json({...})`, add:

```ts
    const sectorRows = await prisma.listing.groupBy({
      by: ['sector'],
      where: { active: true, sector: { not: null } },
      _count: { _all: true },
    });
    const sectors = sectorRows
      .map((r) => ({ name: r.sector as string, count: r._count._all }))
      .sort((a, b) => b.count - a.count);
```

Then add `sectors` to the returned object **only when non-empty** (auto-hide):

```ts
    return c.json({
      total: aggregates._count,
      districts,
      ...(sectors.length > 0 ? { sectors } : {}),
      price: { min: aggregates._min.priceEur, max: aggregates._max.priceEur },
      rooms: { min: aggregates._min.rooms, max: aggregates._max.rooms },
      areaSqm: { min: aggregates._min.areaSqm, max: aggregates._max.areaSqm },
      types,
      roomsValues,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/web/routes/__tests__/listings-facets-sector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/routes/listings.ts src/web/routes/__tests__/listings-facets-sector.test.ts
git commit -m "feat(web): sectors facet on /api/listings/facets (auto-hidden when empty)"
```

---

### Task 7: `sector` filter param on `searchListings` + `/api/listings`

**Files:**
- Modify: `src/mcp/queries.ts` (`SearchListingsInput` + where-building in `searchListings`)
- Modify: `src/web/routes/listings.ts` (the `/api/listings` handler)
- Test: `src/web/routes/__tests__/listings-sector-filter.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Hono } from 'hono';
import { registerListingsRoutes } from '../listings.js';

const prisma = new PrismaClient();
const app = new Hono();
registerListingsRoutes(app, prisma);

async function seed(id: string, sector: string | null) {
  const now = new Date();
  await prisma.listing.create({
    data: { id, url: `https://999.md/${id}`, title: `Casă ${id}`, priceEur: 100000, areaSqm: 100,
      district: 'Chișinău', sector, active: true, lastSeenAt: now, lastFetchedAt: now },
  });
}

describe('GET /api/listings?sector=', () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await prisma.listing.deleteMany(); });

  it('Listings can be filtered to a single sector', async () => {
    await seed('a', 'Centru');
    await seed('b', 'Botanica');
    const res = await app.request('/api/listings?sector=Centru');
    const body = (await res.json()) as { listings: { id: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.listings.map((l) => l.id)).toEqual(['a']);
  });

  it('supports multiple sectors (OR)', async () => {
    await seed('a', 'Centru');
    await seed('b', 'Botanica');
    await seed('c', 'Ciocana');
    const res = await app.request('/api/listings?sector=Centru,Botanica');
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(2);
  });

  it('An empty sector parameter is rejected', async () => {
    const res = await app.request('/api/listings?sector=');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/web/routes/__tests__/listings-sector-filter.test.ts`
Expected: FAIL — sector is ignored, `total` is 2 (or no 400).

- [ ] **Step 3a: Add `sector` to `searchListings`**

In `src/mcp/queries.ts`, add to `SearchListingsInput` (next to `district`):

```ts
  /** Single sector, comma-separated list, or array. Compiles to SQL IN(...). */
  sector?: string | string[] | undefined;
```

In `searchListings`, after the `district` block in the where-builder, add:

```ts
  if (input.sector) {
    const list = Array.isArray(input.sector)
      ? input.sector
      : input.sector.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 1) where['sector'] = list[0];
    else if (list.length > 1) where['sector'] = { in: list };
  }
```

- [ ] **Step 3b: Parse `sector` in the `/api/listings` route**

In `src/web/routes/listings.ts`, mirror the existing `district` parsing block (reuse the present-but-empty → 400 guard). After the `district` block add:

```ts
    const sectorParams = c.req.queries('sector');
    let sector: string | undefined;
    if (sectorParams !== undefined) {
      const parts = sectorParams.flatMap((raw) => raw.split(',')).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) {
        return c.json({ error: 'sector query parameter is empty or whitespace-only' }, 400);
      }
      sector = parts.join(',');
    }
```

and pass `sector` into the `searchListings(prisma, { … })` call (add `sector,` to the options object).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/web/routes/__tests__/listings-sector-filter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full backend test + typecheck**

Run: `pnpm typecheck && pnpm vitest run src/`
Expected: no type errors; all backend tests green.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/queries.ts src/web/routes/listings.ts src/web/routes/__tests__/listings-sector-filter.test.ts
git commit -m "feat(web): sector filter param on /api/listings"
```

---

### Task 8: `sector` filter on Analytics routes

**Files:**
- Modify: `src/web/routes/analytics.ts` (`AnalyticsFilters`, `parseAnalyticsFilters`, `buildListingWhere`)
- Test: `src/web/routes/__tests__/analytics-sector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { analyticsRouter } from '../analytics.js';

const prisma = new PrismaClient();

async function seed(id: string, sector: string) {
  const now = new Date();
  await prisma.listing.create({
    data: { id, url: `https://999.md/${id}`, title: `Casă ${id}`, priceEur: 100000, areaSqm: 100,
      district: 'Chișinău', sector, active: true, lastSeenAt: now, lastFetchedAt: now,
      firstSeenAt: now },
  });
}

describe('Analytics sector filter', () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await prisma.listing.deleteMany(); });

  it('Analytics accepts the same sector filter', async () => {
    await seed('a', 'Centru');
    await seed('b', 'Ciocana');
    const res = await analyticsRouter.request('/analytics/overview?sector=Centru');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kpis: { activeInventory: number } };
    expect(body.kpis.activeInventory).toBe(1);
  });

  it('rejects an empty sector parameter', async () => {
    const res = await analyticsRouter.request('/analytics/overview?sector=');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/web/routes/__tests__/analytics-sector.test.ts`
Expected: FAIL — `activeInventory` is 2 (sector ignored).

- [ ] **Step 3: Add sector to the analytics filter pipeline**

In `src/web/routes/analytics.ts`:

Add to the `AnalyticsFilters` interface:

```ts
  sectors: string[];
```

In `parseAnalyticsFilters`, after the `districts` parsing block, add a parallel `sectors` block (same present-but-empty → 400 behavior):

```ts
  const sectorParams = c.req.queries('sector');
  let sectors: string[] = [];
  if (sectorParams !== undefined) {
    sectors = sectorParams.flatMap((raw) => raw.split(',')).map((s) => s.trim()).filter(Boolean);
    if (sectors.length === 0) {
      return { ok: false, error: 'sector query parameter is empty or whitespace-only' };
    }
  }
```

and add `sectors` to the returned `filters` object.

In `buildListingWhere`, after the `districts` handling, add:

```ts
  const [onlySector] = f.sectors;
  if (f.sectors.length === 1 && onlySector !== undefined) where.sector = onlySector;
  else if (f.sectors.length > 1) where.sector = { in: f.sectors };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/web/routes/__tests__/analytics-sector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/routes/analytics.ts src/web/routes/__tests__/analytics-sector.test.ts
git commit -m "feat(web): sector filter param on analytics routes"
```

---

### Task 9: Sector multi-select on the Listings page

**Files:**
- Modify: `web/src/pages/Listings.tsx` (`ListingsFacets` type, filter state, query params, sidebar JSX)
- Test: `web/src/__tests__/ListingsSector.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Listings from '../pages/Listings.js';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><Listings /></MemoryRouter></QueryClientProvider>,
  );
}

describe('Listings sector filter', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/listings/facets')) {
        return new Response(JSON.stringify({ total: 1, districts: ['Chișinău'], sectors: [{ name: 'Centru', count: 5 }], price: { min: 0, max: 250000 }, rooms: { min: null, max: null }, areaSqm: { min: 50, max: 200 }, types: [], roomsValues: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ listings: [], total: 0 }), { status: 200 });
    });
  });

  it('renders a Sector control when the facet is present', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Sector')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Centru' })).toBeInTheDocument();
  });
});
```

(Adjust the `Listings` import to match its actual default/named export; check the top of `web/src/pages/Listings.tsx`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/__tests__/ListingsSector.test.tsx`
Expected: FAIL — no "Sector" text.

- [ ] **Step 3: Wire sector into the page**

In `web/src/pages/Listings.tsx`:

(a) Extend the `ListingsFacets` interface with:

```ts
  sectors?: { name: string; count: number }[];
```

(b) Add filter state next to the districts state:

```ts
  const [sectorsRaw, setSectorsRaw] = useState<string[]>([]);
  const setSectors = (next: string[]) => setSectorsRaw(Array.from(new Set(next)));
  const sectors = sectorsRaw;
```

(c) Derive options + reset deps. Near `const districtOptions = facets?.districts ?? [];` add:

```ts
  const sectorOptions = facets?.sectors ?? [];
```

Add `sectors.join(',')` to the page-reset `useEffect` dependency array (the one that resets `page` when filters change), and add `sectorsKey` to the listings `useQuery` key the same way `districtsKey` is used:

```ts
  const sectorsKey = sectors.join(',');
```

(d) Append the param where `district` is appended in the query function:

```ts
      if (sectors.length > 0) p.append('sector', sectors.join(','));
```

(e) Render the control in the sidebar, immediately after the District block, **guarded** so it only shows when the facet exists:

```tsx
                {sectorOptions.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        Sector
                      </span>
                      {sectors.length > 0 && (
                        <button className="text-[11px] text-neutral-500 hover:text-neutral-900" onClick={() => setSectors([])}>
                          clear
                        </button>
                      )}
                    </div>
                    {sectorOptions.map(({ name }) => {
                      const active = sectors.includes(name);
                      return (
                        <button
                          key={name}
                          aria-pressed={active}
                          onClick={() => setSectors(active ? sectors.filter((x) => x !== name) : [...sectors, name])}
                          className={`w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors ${active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/__tests__/ListingsSector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Listings.tsx web/src/__tests__/ListingsSector.test.tsx
git commit -m "feat(web): sector multi-select on Listings page (shown when facet present)"
```

---

### Task 10: Sector multi-select on the Analytics rail

**Files:**
- Modify: `web/src/components/analytics/filters.tsx` (`AnalyticsFacets`, `AnalyticsFilterRailProps`, rail body)
- Modify: `web/src/pages/Analytics.tsx` (state + props + query params)
- Test: `web/src/components/analytics/__tests__/AnalyticsFilterRailSector.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsFilterRail } from '../filters.js';

const baseProps = {
  q: '', setQ: vi.fn(), maxPrice: 250000, setMaxPrice: vi.fn(),
  districts: [], setDistricts: vi.fn(), type: 'all', setType: vi.fn(),
  rooms: 'all', setRooms: vi.fn(),
};

describe('AnalyticsFilterRail sector', () => {
  it('renders a Sector group when facets include sectors', () => {
    render(<AnalyticsFilterRail {...baseProps} sectors={[]} setSectors={vi.fn()}
      facets={{ districts: [], types: [], roomsValues: [], price: { min: 0, max: 1 }, sectors: ['Centru', 'Botanica'] }} />);
    expect(screen.getByText('Sector')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Centru' })).toBeInTheDocument();
  });

  it('omits the Sector group when no sectors are present', () => {
    render(<AnalyticsFilterRail {...baseProps} sectors={[]} setSectors={vi.fn()}
      facets={{ districts: [], types: [], roomsValues: [], price: { min: 0, max: 1 } }} />);
    expect(screen.queryByText('Sector')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/components/analytics/__tests__/AnalyticsFilterRailSector.test.tsx`
Expected: FAIL — type error on `sectors`/`setSectors` props and no "Sector" text.

- [ ] **Step 3: Add sector to the rail**

In `web/src/components/analytics/filters.tsx`:

(a) Extend `AnalyticsFacets`:

```ts
  sectors?: string[];
```

(b) Extend `AnalyticsFilterRailProps`:

```ts
  sectors: string[];
  setSectors: (v: string[]) => void;
```

(c) Destructure `sectors, setSectors` in the component params, compute `const sectorOptions = facets?.sectors ?? [];`, and render — right after the District `MultiSelectGroupVertical` — guarded:

```tsx
      {sectorOptions.length > 0 && (
        <MultiSelectGroupVertical label="Sector" values={sectors} setValues={setSectors} options={sectorOptions} />
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/components/analytics/__tests__/AnalyticsFilterRailSector.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire state into `Analytics.tsx`**

In `web/src/pages/Analytics.tsx`, mirror the existing `districts`/`setDistricts` wiring:
- add `const [sectors, setSectors] = useState<string[]>([]);`
- pass `sectors={sectors} setSectors={setSectors}` into every `<AnalyticsFilterRail … />` (or the shared `railProps` object if one exists);
- include sector in the query params builder where `districts` is appended: `if (sectors.length > 0) p.append('sector', sectors.join(','));`
- add `sectors` to the analytics `useQuery` keys alongside `districts` so a sector change refetches.

- [ ] **Step 6: Verify full web suite + typecheck**

Run: `cd web && pnpm vitest run && pnpm exec tsc --noEmit`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/analytics/filters.tsx web/src/pages/Analytics.tsx web/src/components/analytics/__tests__/AnalyticsFilterRailSector.test.tsx
git commit -m "feat(web): sector multi-select on Analytics filter rail"
```

---

### Task 11: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite, typecheck, lint**

Run: `pnpm typecheck && pnpm lint && pnpm test && (cd web && pnpm vitest run)`
Expected: all green. Print any failure output immediately; do not claim success without it.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run the API (`DATABASE_URL=… pnpm exec tsx src/web/server.ts`) + Vite (`cd web && pnpm dev`) against the dev Postgres (already backfilled in Task 5), open the Listings page, confirm a **Sector** group appears with Centru/Botanica/etc., select one, and confirm the table narrows. Repeat on Analytics.

- [ ] **Step 3: No commit** (verification task).

---

## Self-review (against the spec)

- **Sector derivation (lib + persist + backfill):** Tasks 2, 4, 5. ✓
- **Persisted `sector` column + index:** Task 3. ✓
- **Sector facet, auto-hidden when empty:** Task 6. ✓
- **Sector filter on Listings (param + UI):** Tasks 7, 9. ✓
- **Sector filter on Analytics (param + UI):** Tasks 8, 10. ✓
- **Present-but-empty → 400 guard:** Tasks 7, 8. ✓
- **Gherkin spec, one scenario per it():** Task 1 + tests across 2,7,8. ✓
- **Out of scope here (Plan 2):** ranges/enums for land/year/floors/heating/seller, `type`→regex refactor, source-native filter groups, broader facets payload. Not covered by this plan by design.

Type consistency check: facet sector shape is `{ name, count }` on `/api/listings` (Listings consumes `{name}`), and `string[]` on the analytics rail (`AnalyticsFacets.sectors`) — intentional: the analytics rail's `MultiSelectGroupVertical` takes `string[]`, so `Analytics.tsx` must map `facets.sectors?.map(s => s.name)` if it reuses the listings facet, OR the analytics facets endpoint returns `string[]`. **Implementer note:** the analytics page uses its own facets fetch; ensure whatever it fetches is reduced to `string[]` before passing as `facets.sectors` to the rail. Both filter params accept the same `?sector=A,B` wire format, so the backend is uniform.
