# Per-Listing Price History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose each listing's full, all-time price-distinct timeline and render it as an inline expandable panel (a dated change list) in the Listings page, for both increases and decreases.

**Architecture:** A new read-only query `getPriceHistory` collapses the already-captured `ListingSnapshot` stream into price-distinct points. A dedicated `GET /api/listings/:id/price-history` endpoint serves them. A reusable `PriceHistoryPanel` React component fetches them lazily (only for the open listing) and renders a newest-first change list, wired into both the cards and table views via the existing `selectedId` state.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import extensions), Prisma + Postgres, Hono, Vitest (backend: testcontainers Postgres; web: jsdom + Testing Library), React 18 + TanStack Query + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-25-price-history-per-listing-design.md`

**Branch:** `feature/price-history-per-listing` (already created).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/mcp/queries.ts` | Read-only Prisma helpers | Add `PricePoint` interface + `getPriceHistory()` |
| `src/__tests__/price-history.test.ts` | Unit tests for the dedup logic | Create |
| `src/web/routes/listings.ts` | Listings HTTP routes | Add `GET /api/listings/:id/price-history` |
| `src/web/routes/__tests__/price-history-route.test.ts` | Route integration tests | Create |
| `web/src/components/listings/PriceHistoryPanel.tsx` | Lazy-fetching change-list panel | Create |
| `web/src/components/listings/__tests__/PriceHistoryPanel.test.tsx` | Panel behavior tests | Create |
| `web/src/components/listings/ListingsTable.tsx` | Sortable table | Add optional `renderExpanded` prop + expanded `<tr>` |
| `web/src/pages/Listings.tsx` | Listings page | Render panel under selected card + pass `renderExpanded` to table |
| `web/src/__tests__/Listings.test.tsx` | Page behavior tests | Add expand-panel test |

**Test commands:**
- Backend: `pnpm test <path>` (run from repo root `house-track/`).
- Web: `pnpm test <path>` run from `web/` (i.e. `cd web && pnpm test ...`).

---

## Task 1: `getPriceHistory` query + dedup logic

**Files:**
- Modify: `src/mcp/queries.ts` (add interface near `GetListingResult` at line ~125; add function after `getListing` which ends at line 393)
- Test: `src/__tests__/price-history.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/price-history.test.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPriceHistory } from '../mcp/queries.js';

let prisma: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.listingSnapshot.deleteMany();
  await prisma.listing.deleteMany();
});

// Mirrors persist.ts: a listing always has a "current price" snapshot. Each
// snapshot row carries the price observed at capturedAt. rawHtmlHash is
// required by the schema; the dedup logic never reads it, so any unique-ish
// value is fine here.
async function seedListing(id: string) {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      title: `Title ${id}`,
      firstSeenAt: now,
      lastSeenAt: now,
      lastFetchedAt: now,
      active: true,
    },
  });
}

async function seedSnapshot(listingId: string, priceEur: number | null, daysAgo: number) {
  await prisma.listingSnapshot.create({
    data: {
      listingId,
      priceEur,
      capturedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      rawHtmlHash: `${listingId}-${daysAgo}-${priceEur ?? 'null'}`,
    },
  });
}

describe('getPriceHistory', () => {
  it('returns null for an unknown listing', async () => {
    expect(await getPriceHistory(prisma, 'nope')).toBeNull();
  });

  it('returns [] for a listing with no priced snapshots', async () => {
    await seedListing('h-empty');
    await seedSnapshot('h-empty', null, 1); // null-priced snapshots are skipped
    expect(await getPriceHistory(prisma, 'h-empty')).toEqual([]);
  });

  it('returns a single baseline point for one priced snapshot', async () => {
    await seedListing('h-one');
    await seedSnapshot('h-one', 50_000, 3);
    const points = await getPriceHistory(prisma, 'h-one');
    expect(points).toHaveLength(1);
    expect(points![0]).toMatchObject({
      priceEur: 50_000,
      deltaPct: null,
      direction: 'baseline',
    });
  });

  it('collapses consecutive equal prices to one point', async () => {
    await seedListing('h-flat');
    await seedSnapshot('h-flat', 50_000, 5);
    await seedSnapshot('h-flat', 50_000, 3); // unchanged price (e.g. description edit)
    await seedSnapshot('h-flat', 50_000, 1);
    const points = await getPriceHistory(prisma, 'h-flat');
    expect(points).toHaveLength(1);
    expect(points![0]!.direction).toBe('baseline');
  });

  it('keeps both increases and decreases with correct direction and deltaPct', async () => {
    await seedListing('h-moves');
    await seedSnapshot('h-moves', 50_000, 10); // baseline
    await seedSnapshot('h-moves', 51_000, 7); // +2.0% up
    await seedSnapshot('h-moves', 51_000, 5); // unchanged → collapsed
    await seedSnapshot('h-moves', 48_960, 2); // -4.0% down
    const points = await getPriceHistory(prisma, 'h-moves');
    expect(points).toHaveLength(3);
    expect(points!.map((p) => [p.priceEur, p.direction, p.deltaPct])).toEqual([
      [50_000, 'baseline', null],
      [51_000, 'up', 2.0],
      [48_960, 'down', -4.0],
    ]);
  });

  it('orders points ascending by capturedAt', async () => {
    await seedListing('h-order');
    await seedSnapshot('h-order', 70_000, 1); // most recent inserted first
    await seedSnapshot('h-order', 60_000, 9); // oldest
    const points = await getPriceHistory(prisma, 'h-order');
    expect(points!.map((p) => p.priceEur)).toEqual([60_000, 70_000]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/__tests__/price-history.test.ts`
Expected: FAIL — `getPriceHistory` is not exported from `../mcp/queries.js` (import/type error or "is not a function").

- [ ] **Step 3: Add the `PricePoint` interface**

In `src/mcp/queries.ts`, immediately after the `GetListingResult` interface (ends at line 125, before `const DEFAULT_LIMIT`), add:

```ts
export interface PricePoint {
  /** Price at this point, in EUR. */
  priceEur: number;
  /** ISO timestamp of the snapshot that introduced this price. */
  capturedAt: string;
  /** Percent change vs the prior kept point, rounded to 1 decimal. Null for the baseline. */
  deltaPct: number | null;
  /** 'baseline' for the first point; 'up'/'down' for subsequent changes. */
  direction: 'up' | 'down' | 'baseline';
}
```

- [ ] **Step 4: Implement `getPriceHistory`**

In `src/mcp/queries.ts`, append after `getListing` (after line 393):

```ts
/**
 * Full, all-time price timeline for one listing, collapsed to price-distinct
 * points. The snapshot stream contains a new row for ANY HTML change (price,
 * description, bump), so consecutive equal prices are deduped here. Null-priced
 * snapshots are skipped. Both increases and decreases are kept.
 *
 * Returns null when the listing does not exist; [] when it exists but has no
 * priced snapshots.
 */
export async function getPriceHistory(
  prisma: PrismaClient,
  id: string,
): Promise<PricePoint[] | null> {
  const listing = await prisma.listing.findUnique({ where: { id }, select: { id: true } });
  if (!listing) return null;

  const snapshots = await prisma.listingSnapshot.findMany({
    where: { listingId: id, priceEur: { not: null } },
    orderBy: { capturedAt: 'asc' },
    select: { priceEur: true, capturedAt: true },
  });

  const points: PricePoint[] = [];
  for (const s of snapshots) {
    const price = s.priceEur as number; // non-null by the where clause
    const prev = points[points.length - 1];
    if (prev && prev.priceEur === price) continue; // collapse consecutive equals
    if (!prev) {
      points.push({
        priceEur: price,
        capturedAt: s.capturedAt.toISOString(),
        deltaPct: null,
        direction: 'baseline',
      });
    } else {
      const deltaPct = Math.round(((price - prev.priceEur) / prev.priceEur) * 1000) / 10;
      points.push({
        priceEur: price,
        capturedAt: s.capturedAt.toISOString(),
        deltaPct,
        direction: price > prev.priceEur ? 'up' : 'down',
      });
    }
  }
  return points;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/__tests__/price-history.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/queries.ts src/__tests__/price-history.test.ts
git commit -m "feat(mcp): add getPriceHistory price-distinct timeline query"
```

---

## Task 2: `GET /api/listings/:id/price-history` route

**Files:**
- Modify: `src/web/routes/listings.ts` (import on line 3; add route inside `registerListingsRoutes`, immediately after the `GET /api/listings/:id` handler at lines 182-191)
- Test: `src/web/routes/__tests__/price-history-route.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/web/routes/__tests__/price-history-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

interface PricePoint {
  priceEur: number;
  capturedAt: string;
  deltaPct: number | null;
  direction: 'up' | 'down' | 'baseline';
}

describe('GET /api/listings/:id/price-history', () => {
  let prisma: PrismaClient;
  let app: Hono;

  beforeAll(() => {
    prisma = getPrisma();
    app = createApiApp();
  });

  beforeEach(async () => {
    await prisma.listingSnapshot.deleteMany();
    await prisma.listingFilterValue.deleteMany();
    await prisma.listing.deleteMany();
  });

  it('returns the price-distinct timeline for a listing', async () => {
    const now = Date.now();
    await prisma.listing.create({
      data: {
        id: 'h-1',
        url: 'https://999.md/h-1',
        title: 'Test',
        active: true,
        firstSeenAt: new Date(now),
        lastSeenAt: new Date(now),
        lastFetchedAt: new Date(now),
        snapshots: {
          create: [
            { priceEur: 50_000, capturedAt: new Date(now - 5 * 86_400_000), rawHtmlHash: 'a' },
            { priceEur: 48_000, capturedAt: new Date(now - 1 * 86_400_000), rawHtmlHash: 'b' },
          ],
        },
      },
    });

    const res = await app.request('/api/listings/h-1/price-history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { points: PricePoint[] };
    expect(body.points).toHaveLength(2);
    expect(body.points[0]).toMatchObject({ priceEur: 50_000, direction: 'baseline' });
    expect(body.points[1]).toMatchObject({ priceEur: 48_000, direction: 'down', deltaPct: -4.0 });
  });

  it('returns 404 for an unknown listing', async () => {
    const res = await app.request('/api/listings/does-not-exist/price-history');
    expect(res.status).toBe(404);
  });

  it('returns 200 with an empty array when the listing has no priced snapshots', async () => {
    const now = Date.now();
    await prisma.listing.create({
      data: {
        id: 'h-empty',
        url: 'https://999.md/h-empty',
        title: 'Empty',
        active: true,
        firstSeenAt: new Date(now),
        lastSeenAt: new Date(now),
        lastFetchedAt: new Date(now),
      },
    });
    const res = await app.request('/api/listings/h-empty/price-history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { points: PricePoint[] };
    expect(body.points).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/web/routes/__tests__/price-history-route.test.ts`
Expected: FAIL — route returns 404/HTML for the first test (handler not registered), so `body.points` is undefined.

- [ ] **Step 3: Import `getPriceHistory` in the route module**

In `src/web/routes/listings.ts`, change line 3 from:

```ts
import { searchListings, getListing } from '../../mcp/queries.js';
```

to:

```ts
import { searchListings, getListing, getPriceHistory } from '../../mcp/queries.js';
```

- [ ] **Step 4: Register the route**

In `src/web/routes/listings.ts`, immediately after the `GET /api/listings/:id` handler (after its closing `});` at line 191), add:

```ts
  // Full price-distinct timeline for one listing (both ups and downs). A
  // dedicated endpoint so the inline history panel fetches only what it shows,
  // rather than the whole listing detail. Two path segments, so it never
  // collides with the single-segment `/api/listings/:id` route above.
  app.get('/api/listings/:id/price-history', async (c) => {
    const id = c.req.param('id');
    const points = await getPriceHistory(prisma, id);
    if (points === null) {
      return c.json({ error: 'Listing not found' }, 404);
    }
    return c.json({ points });
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/web/routes/__tests__/price-history-route.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/web/routes/listings.ts src/web/routes/__tests__/price-history-route.test.ts
git commit -m "feat(web): add GET /api/listings/:id/price-history endpoint"
```

---

## Task 3: `PriceHistoryPanel` web component

**Files:**
- Create: `web/src/components/listings/PriceHistoryPanel.tsx`
- Test: `web/src/components/listings/__tests__/PriceHistoryPanel.test.tsx`

> NOTE: All commands in this task run from the `web/` directory.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/listings/__tests__/PriceHistoryPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PriceHistoryPanel } from '../PriceHistoryPanel.js';
import { queryClient } from '../../../lib/query.js';

vi.mock('../../../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

function renderPanel(listingId: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PriceHistoryPanel listingId={listingId} />
    </QueryClientProvider>,
  );
}

describe('PriceHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders each price-distinct point with its delta', async () => {
    const { apiCall } = await import('../../../lib/api.js');
    (apiCall as any).mockResolvedValue({
      points: [
        { priceEur: 50_000, capturedAt: '2026-05-10T10:00:00Z', deltaPct: null, direction: 'baseline' },
        { priceEur: 51_000, capturedAt: '2026-05-15T10:00:00Z', deltaPct: 2.0, direction: 'up' },
        { priceEur: 48_960, capturedAt: '2026-05-20T10:00:00Z', deltaPct: -4.0, direction: 'down' },
      ],
    });

    renderPanel('h-1');

    // Newest first: the -4.0% change is shown before the baseline.
    expect(await screen.findByText('€48,960')).toBeInTheDocument();
    expect(screen.getByText('€51,000')).toBeInTheDocument();
    expect(screen.getByText('€50,000')).toBeInTheDocument();
    expect(screen.getByText(/-4\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/\+2\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/first seen/i)).toBeInTheDocument();
    expect((apiCall as any).mock.calls[0][0]).toBe('/listings/h-1/price-history');
  });

  it('shows a "no changes" message for a single-point history', async () => {
    const { apiCall } = await import('../../../lib/api.js');
    (apiCall as any).mockResolvedValue({
      points: [
        { priceEur: 50_000, capturedAt: '2026-05-10T10:00:00Z', deltaPct: null, direction: 'baseline' },
      ],
    });

    renderPanel('h-2');

    expect(await screen.findByText(/no price changes recorded yet/i)).toBeInTheDocument();
  });

  it('shows a "no changes" message for an empty history', async () => {
    const { apiCall } = await import('../../../lib/api.js');
    (apiCall as any).mockResolvedValue({ points: [] });

    renderPanel('h-3');

    expect(await screen.findByText(/no price changes recorded yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `pnpm test src/components/listings/__tests__/PriceHistoryPanel.test.tsx`
Expected: FAIL — cannot resolve `../PriceHistoryPanel.js` (module does not exist).

- [ ] **Step 3: Implement the component**

Create `web/src/components/listings/PriceHistoryPanel.tsx`:

```tsx
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiCall } from '@/lib/api.js';
import { fmt } from '@/lib/format.js';

interface PricePoint {
  priceEur: number;
  capturedAt: string;
  deltaPct: number | null;
  direction: 'up' | 'down' | 'baseline';
}

interface PriceHistoryResponse {
  points: PricePoint[];
}

interface PriceHistoryPanelProps {
  listingId: string;
}

export const PriceHistoryPanel: React.FC<PriceHistoryPanelProps> = ({ listingId }) => {
  const { data, isLoading, error } = useQuery<PriceHistoryResponse>({
    queryKey: ['price-history', listingId],
    queryFn: () => apiCall<PriceHistoryResponse>(`/listings/${listingId}/price-history`),
  });

  return (
    <div className="bg-neutral-50 px-3 py-3 text-xs" data-testid="price-history-panel">
      <div className="mb-2 font-medium text-neutral-500">Price history</div>
      {isLoading && <p className="text-neutral-400">Loading…</p>}
      {error && <p className="text-error">Failed to load price history</p>}
      {data && (data.points.length <= 1 ? (
        <p className="text-neutral-400">No price changes recorded yet.</p>
      ) : (
        <ul className="space-y-1">
          {[...data.points].reverse().map((p) => (
            <li
              key={p.capturedAt}
              className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-4 tabular-nums"
            >
              <span className="font-medium text-neutral-900">{fmt.eur(p.priceEur)}</span>
              {p.direction === 'baseline' ? (
                <span className="text-neutral-400">first seen</span>
              ) : (
                <span className={p.direction === 'up' ? 'text-error' : 'text-success'}>
                  {p.direction === 'up' ? '▲' : '▼'}{' '}
                  {p.deltaPct! > 0 ? '+' : ''}
                  {p.deltaPct!.toFixed(1)}%
                </span>
              )}
              <span className="text-right text-neutral-400">{fmt.date(p.capturedAt)}</span>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
};
```

> Color note: a price *increase* uses `text-error` (red) and a *decrease* uses `text-success` (green) — from a buyer's perspective a price drop is the good signal. If `text-success` is not defined in the Tailwind theme, use `text-green-600` / `text-red-600` instead; check `web/tailwind.config.ts` for the available semantic colors and match the existing `text-error` usage seen in `Listings.tsx`.

- [ ] **Step 4: Run the test to verify it passes**

Run (from `web/`): `pnpm test src/components/listings/__tests__/PriceHistoryPanel.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/listings/PriceHistoryPanel.tsx \
        web/src/components/listings/__tests__/PriceHistoryPanel.test.tsx
git commit -m "feat(web): add PriceHistoryPanel change-list component"
```

---

## Task 4: Wire the panel into the cards and table views

**Files:**
- Modify: `web/src/components/listings/ListingsTable.tsx` (props at lines 38-45; signature at 47-54; expanded row in `<tbody>` map ending at line 229)
- Modify: `web/src/pages/Listings.tsx` (import; cards map at lines 359-368; table render at 369-377)
- Test: `web/src/__tests__/Listings.test.tsx` (append a test)

> NOTE: All commands in this task run from the `web/` directory.

- [ ] **Step 1: Write the failing test**

Append to `web/src/__tests__/Listings.test.tsx` (inside the top-level `describe('Listings', ...)` block, after the existing tests):

```tsx
  it('expanding a table row shows its price history', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint.includes('/price-history')) {
        return Promise.resolve({
          points: [
            { priceEur: 50_000, capturedAt: '2026-05-10T10:00:00Z', deltaPct: null, direction: 'baseline' },
            { priceEur: 48_000, capturedAt: '2026-05-20T10:00:00Z', deltaPct: -4.0, direction: 'down' },
          ],
        });
      }
      if (endpoint.startsWith('/listings/facets')) {
        return Promise.resolve({
          total: 1, districts: ['Centru'], price: { min: 0, max: 0 },
          rooms: { min: 1, max: 5 }, areaSqm: { min: 30, max: 200 }, types: [], roomsValues: [],
        });
      }
      return Promise.resolve({
        listings: [
          {
            id: 'h-1', url: 'https://example.test/1', title: 'Row one',
            priceEur: 48_000, areaSqm: 50, rooms: 3, district: 'Centru',
            firstSeenAt: '2026-05-01T10:00:00Z',
          },
        ],
        total: 1,
      });
    });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const row = await screen.findByText('Row one');
    await userEvent.click(row);

    expect(await screen.findByTestId('price-history-panel')).toBeInTheDocument();
    expect(await screen.findByText('€48,000')).toBeInTheDocument();
    expect(screen.getByText(/-4\.0%/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `pnpm test src/__tests__/Listings.test.tsx -t "expanding a table row"`
Expected: FAIL — no element with `data-testid="price-history-panel"` (panel not wired in).

- [ ] **Step 3: Add a `renderExpanded` prop to `ListingsTable`**

In `web/src/components/listings/ListingsTable.tsx`, add to `ListingsTableProps` (after `onToggleExclude?` at line 44):

```ts
  /** Optional content rendered as a full-width row beneath the selected row. */
  renderExpanded?: (r: ListingsTableRow) => React.ReactNode;
```

Add `renderExpanded` to the destructured props (after `onToggleExclude,` at line 53):

```ts
  renderExpanded,
```

- [ ] **Step 4: Render the expanded row**

In `web/src/components/listings/ListingsTable.tsx`, the `<tbody>` map currently returns a single `<tr>` per row (lines 145-228, `return ( <tr ...>...</tr> );`). Wrap it in a fragment and append the expanded row. Change the `return (` at line 145 and the closing `);` at line 228 so the block reads:

```tsx
            return (
              <React.Fragment key={r.id}>
                <tr
                  data-listing-id={r.id}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={`hover:bg-neutral-50 ${onRowClick ? 'cursor-pointer' : ''} ${isSelected ? 'bg-accent/5' : ''}`}
                >
                  {/* ...all existing <td> cells unchanged... */}
                </tr>
                {isSelected && renderExpanded && (
                  <tr className="bg-neutral-50">
                    <td colSpan={9} className="p-0">
                      {renderExpanded(r)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
```

Notes for the implementer:
- Remove the `key={r.id}` that was on the original `<tr>` (line 147) — the key now lives on the `<React.Fragment>`.
- Keep every existing `<td>` inside the first `<tr>` exactly as-is; only the wrapping changed.
- `colSpan={9}` matches the table's 9 columns (Title, District, Price, €/m², Area, Rooms, Land, First seen, actions).

- [ ] **Step 5: Wire the panel into `Listings.tsx`**

In `web/src/pages/Listings.tsx`, add the import after line 9 (`import { ListingsTable } ...`):

```ts
import { PriceHistoryPanel } from '@/components/listings/PriceHistoryPanel.js';
```

Replace the cards-view map (lines 359-368) so the panel renders under the open card:

```tsx
          {view === 'cards' &&
            visibleListings.map((l) => (
              <React.Fragment key={l.id}>
                <ListingCard
                  l={l}
                  selected={selectedId === l.id}
                  autoScroll={highlightId === l.id}
                  onSelect={() => setSelectedId((cur) => (cur === l.id ? null : l.id))}
                />
                {selectedId === l.id && <PriceHistoryPanel listingId={l.id} />}
              </React.Fragment>
            ))}
```

Pass `renderExpanded` to the table (in the `<ListingsTable ... />` block at lines 369-377), adding this prop:

```tsx
              renderExpanded={(r) => <PriceHistoryPanel listingId={r.id} />}
```

- [ ] **Step 6: Run the test to verify it passes**

Run (from `web/`): `pnpm test src/__tests__/Listings.test.tsx -t "expanding a table row"`
Expected: PASS.

- [ ] **Step 7: Run the full web + backend suites and typecheck**

Run (from `web/`): `pnpm test`
Run (from repo root): `pnpm test && pnpm typecheck`
Expected: all green; no type errors. (Watch for the seed-mirroring rule — snapshot-based tests already include current-price snapshots.)

- [ ] **Step 8: Commit**

```bash
git add web/src/components/listings/ListingsTable.tsx \
        web/src/pages/Listings.tsx \
        web/src/__tests__/Listings.test.tsx
git commit -m "feat(web): show inline price history under selected listing"
```

---

## Verification Checklist (after all tasks)

- [ ] `pnpm test` (root) and `cd web && pnpm test` both green.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint` clean (run `pnpm lint:fix` if needed).
- [ ] Manual: `cd web && pnpm dev`, open Listings, click a row → history panel expands with dated change list; click again → collapses. Verify a listing with one snapshot shows "No price changes recorded yet."
- [ ] Open PR with `--base main` (integration branch is `main`).

## Self-Review Notes

- **Spec coverage:** query dedup (Task 1) ✓; all-time + ups & downs ✓; dedicated endpoint + 404/[] semantics (Task 2) ✓; inline expandable change-list UI, newest-first, lazy per-card fetch, "no changes" empty state (Tasks 3-4) ✓; tests at all three layers ✓.
- **Type consistency:** `PricePoint` fields (`priceEur`, `capturedAt`, `deltaPct`, `direction`) identical across `queries.ts`, the route test, the web component, and the panel/page tests. `getPriceHistory` returns `PricePoint[] | null` everywhere it's referenced.
- **No placeholders:** every code/command step is concrete.
