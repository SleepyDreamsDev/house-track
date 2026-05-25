# Per-Listing Price History — Design

**Date:** 2026-05-25
**Status:** Approved (design), pending implementation plan
**Branch:** `feature/price-history-per-listing`

## Problem

Price history is already captured: `ListingSnapshot` rows store `priceEur` +
`capturedAt`, written on every detail fetch where the normalized-HTML hash
changed (`src/persist.ts:242-257`). Because a price move always changes the
HTML, **both increases and decreases are recorded** — the full per-listing
price timeline already lives in the database.

But it is not surfaced:

- `GET /api/listings/:id` → `getListing()` includes only `filterValues`, not
  `snapshots` (`src/mcp/queries.ts:358-361`). The history is never exposed.
- `web/src/pages/Listings.tsx` shows only a single `priceWas` + drop badge,
  derived from the 7-day price-drops feed (earliest vs latest). There is no
  per-listing timeline and no view of price increases.

The capture is done. This feature exposes the stored history and adds a small
per-listing history UI.

## Goals

- Expose the full, all-time price-distinct timeline for a single listing.
- Render it inline in the Listings page as an expandable panel, showing each
  change (old → new direction, delta %, date), both ups and downs.

## Non-Goals (YAGNI)

- No chart / sparkline — text change-list only.
- No detail drawer or new route — reuse the existing inline selection state.
- No capping to "last N changes" — full all-time history.
- No changes to capture logic; snapshots are already written correctly.

## Design

### 1. Query layer — `src/mcp/queries.ts`

New `getPriceHistory(prisma, id)`:

- Read all `ListingSnapshot` rows for `listingId = id`, `priceEur != null`,
  ordered by `capturedAt asc`.
- **Collapse to price-distinct points:** keep a row only when its `priceEur`
  differs from the previous *kept* point's price. This dedupes the snapshot
  stream, which contains a new row for *any* HTML change (description edits,
  bumps) — not just price moves.
- Return shape:

  ```ts
  interface PricePoint {
    priceEur: number;
    capturedAt: string; // ISO
    deltaPct: number | null; // vs prior kept price; null for the baseline
    direction: 'up' | 'down' | 'baseline';
  }
  type PriceHistory = PricePoint[]; // ascending by capturedAt
  ```

- `deltaPct = round(((priceEur - priorKept.priceEur) / priorKept.priceEur) * 100, 1)`.
  First point is the baseline (`deltaPct = null`, `direction = 'baseline'`).
- Listing not found → distinguish from "found, no snapshots". Returns `null`
  when the listing row does not exist; returns `[]` when it exists with no
  priced snapshots. (Route maps `null` → 404.)

Edge cases:

- Listing with one priced snapshot → one baseline point.
- All snapshots same price → one baseline point (consecutive equals collapse).
- Snapshots with `priceEur = null` → skipped entirely.

### 2. API — `src/web/routes/listings.ts`

New `GET /api/listings/:id/price-history` → `{ points: PricePoint[] }`.

- Dedicated endpoint rather than extending `getListing`, so the expandable
  panel fetches only what it renders.
- `null` from `getPriceHistory` → `404 { error: 'Listing not found' }`.
- Must be registered **before** the generic `/api/listings/:id` route so the
  concrete path wins — matches the existing ordering note in
  `src/web/server.ts:28`.

### 3. UI — `web/src/pages/Listings.tsx`

- On card expand (reuse the existing `selectedId` state — clicking a card sets
  it), render an inline panel directly below the selected card.
- The panel uses a React Query query keyed `['price-history', id]`, **enabled
  only when that card is the open one**, so history is fetched lazily per card.
- Render the change list **newest-first** (reverse the ascending response):

  ```
  €48,000   ▼ −4.0%       May 20
  €50,000   ▲ +2.0%       May 12
  €49,000   first seen    Apr 30
  ```

  - Up → green ▲; down → red ▼; baseline → muted "first seen".
  - Empty (`[]`) or single point → "No price changes recorded yet."
  - Loading / error states handled (spinner; inline error text).

## Data Flow

```
ListingSnapshot rows ──getPriceHistory()──► price-distinct PricePoint[]
        │                                            │
        └─ already written by persist.ts             ▼
                                   GET /api/listings/:id/price-history
                                                     │
                                                     ▼
                          Listings.tsx expand panel (lazy React Query) → change list
```

## Testing

Per project TDD rules (integration > unit > edge), and the seed-mirroring rule:
snapshot test seeds must mirror `persist.ts` (include a current-price snapshot).

- **`src/mcp/__tests__` (unit) — dedup logic:**
  - consecutive equal prices collapse to one point;
  - both ups and downs are kept with correct `direction` + `deltaPct`;
  - `priceEur = null` snapshots skipped;
  - single priced snapshot → one baseline point;
  - unknown id → `null`; existing listing with no priced snapshots → `[]`.
- **Route integration:**
  - `200 { points }` for a listing with history;
  - `404` for unknown id;
  - route precedence: `/api/listings/:id/price-history` resolves to the
    history handler, not the generic `:id` handler.
- **UI behavior (`web`):**
  - expanding a card renders the change list;
  - single-point / empty renders the "no changes" message.

## Files

| File | Change |
| --- | --- |
| `src/mcp/queries.ts` | add `getPriceHistory` + `PricePoint` type |
| `src/web/routes/listings.ts` | add `GET /api/listings/:id/price-history` (before generic `:id`) |
| `web/src/pages/Listings.tsx` | inline expandable history panel + lazy query |
| `src/mcp/__tests__/*.test.ts` | dedup unit tests |
| `src/web/routes/__tests__/listings.test.ts` | route integration tests |
| `web/src/pages/__tests__/*.test.tsx` | expand-panel behavior test |
