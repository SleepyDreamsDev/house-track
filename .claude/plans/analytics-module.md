# Plan: Analytics Module

## Goal
Ship the Analytics module per `design/analytics.jsx`: new `/analytics` route with three tabs (Overview, Best buys, Price drops), hand-rolled SVG charts, and three Hono endpoints over `Listing` + `ListingSnapshot`.

## Acceptance Criteria
- [ ] Sidebar has new `Analytics` nav item routing to `/analytics`; `AppShell.navItems` order matches design (Dashboard, Listings, Sweeps, Filter, Analytics, Settings).
- [ ] `/analytics` renders `PageHeader` "Analytics" with subtitle changing per tab and `Tabs` (Overview / Best buys / Price drops); URL stays `/analytics` (tab state local; `initialTab` prop optional).
- [ ] Overview tab renders 5-tile KStat strip, Filters card (Region/Type/Rooms/PriceRange/YearBuilt), `MultiLineChart`, `FlowChart`, `DOMHistogram`, `Scatter`, `Heatmap`, plus two Top-10 preview tables that drill into Best buys / Price drops.
- [ ] Best buys tab: 4-tile KStat strip, Filters card, sortable table (Score / Discount / Newest / €/m²), filter by region+type+rooms.
- [ ] Price drops tab: 4-tile KStat strip, Filters card with Period segmented (7d/30d/90d), sortable table (% drop / € drop / Newest).
- [ ] `GET /api/analytics/overview` returns `{kpis, trendByDistrict, heatmap, domBuckets, inventory12w, newPerWeek, gonePerWeek, scatter}` derived from Prisma.
- [ ] `GET /api/analytics/best-buys?region=&type=&rooms=` returns ranked listing rows with `district, type, priceEur, areaSqm, yearBuilt, daysOnMkt, eurPerSqm, medianEurPerSqm, discount, z, score, priceDrop, dropPct`.
- [ ] `GET /api/analytics/price-drops?period=7d|30d|90d&region=&type=` returns drops in the window with `priceWas, priceEur, dropPct, dropEur, when` (relative).
- [ ] Page tolerates pending queries (renders title) and empty arrays without crashing.
- [ ] Vitest suites pass: backend route tests (testcontainers per stats.test.ts pattern) + page test (Dashboard.test.tsx pattern).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all green.

## Tasks
1. RED — backend route tests in `src/web/routes/__tests__/analytics.test.ts` covering overview/best-buys/price-drops endpoints (seed Listing + ListingSnapshot rows; assert shape, filter params, ranking math).
2. RED — page tests `web/src/__tests__/Analytics.test.tsx` mirroring Dashboard.test.tsx (tab switching, headers visible, pending state).
3. GREEN backend — create `src/web/routes/analytics.ts` (`analyticsRouter`), mount in `src/web/server.ts` BEFORE the generic `/api/listings/:id` route. Use Prisma raw SQL where helpful (district medians, scatter, DOM histogram from `firstSeenAt`).
4. GREEN frontend — port `design/analytics.jsx`:
   - Page: `web/src/pages/Analytics.tsx` (host + 3 tab subcomponents + `Tabs`).
   - Charts: keep inline OR extract to `web/src/components/analytics/{MultiLineChart,Heatmap,Scatter,FlowChart,DOMHistogram}.tsx` (extract — keeps page <300 lines, mirrors `ui/Sparkline.tsx`).
   - Tables: `BestBuysTable`, `PriceDropsTable`, `ScoreBar`, `FilterGroupVertical`, `Segmented`, `Legend` co-located in page or `components/analytics/`.
   - Replace mock `BEST_BUYS`/`PRICE_DROPS`/`HEATMAP`/`TREND_BY_DISTRICT` with `useQuery` + `apiCall('/analytics/...')`.
   - Strip `cx` helper if not present — repo uses Tailwind class strings directly; check `web/src/lib/` for `cx`/`clsx` and import or fall back to template literals.
   - Use existing `Card`, `Button`, `Badge`, `KStat`, `PageHeader`, `SectionHeader` from `@/components/ui/`.
5. GREEN nav — add `{ label: 'Analytics', path: '/analytics' }` to `AppShell.navItems` (between Filter and Settings) and `{ path: 'analytics', element: <Analytics /> }` to `web/src/router.tsx`.
6. REFACTOR — extract chart helpers (yScale/xScale) if duplicated, ensure `noUncheckedIndexedAccess` strict mode passes (lots of array indexing in chart code), normalize district color map import.
7. Verify — `pnpm typecheck && pnpm lint && pnpm test` and visual smoke via `cd web && pnpm dev`.

## File Map
| Action | File | Notes |
|--------|------|-------|
| create | `src/web/routes/analytics.ts` | `analyticsRouter` Hono with 3 GET endpoints |
| create | `src/web/routes/__tests__/analytics.test.ts` | testcontainer-backed contract tests, mirror `stats.test.ts` |
| edit   | `src/web/server.ts` | import + `app.route('/api', analyticsRouter)` before generic listings router |
| create | `web/src/pages/Analytics.tsx` | page host + 3 tab subcomponents + `Tabs` |
| create | `web/src/components/analytics/MultiLineChart.tsx` | SVG line chart, props `{series, w?, h?}` |
| create | `web/src/components/analytics/Heatmap.tsx` | district × rooms table |
| create | `web/src/components/analytics/Scatter.tsx` | price vs area SVG scatter |
| create | `web/src/components/analytics/FlowChart.tsx` | inventory + new/gone bars |
| create | `web/src/components/analytics/DOMHistogram.tsx` | DOM bucket bars |
| create | `web/src/components/analytics/tables.tsx` | `BestBuysTable`, `PriceDropsTable`, `ScoreBar` |
| create | `web/src/components/analytics/filters.tsx` | `FilterGroupVertical`, `Segmented`, `Legend`, `DIST_COLORS` |
| create | `web/src/__tests__/Analytics.test.tsx` | mirrors Dashboard.test.tsx (RouterProvider + QueryClientProvider, mock `apiCall`) |
| edit   | `web/src/components/layout/AppShell.tsx` | add Analytics nav item |
| edit   | `web/src/router.tsx` | add `/analytics` route |

## Domain Split (hint for PHASE 2b)
| Domain | Files | Depends on |
|--------|-------|------------|
| backend-analytics | `src/web/routes/analytics.ts`, `src/web/routes/__tests__/analytics.test.ts`, `src/web/server.ts` mount edit | nothing (uses existing Prisma models) |
| frontend-analytics | `web/src/pages/Analytics.tsx`, all `web/src/components/analytics/*.tsx`, `web/src/__tests__/Analytics.test.tsx` | API contracts only (mocked in tests via `vi.mock('../lib/api.js')`); can develop in parallel against TypeScript interfaces agreed in plan |
| nav-wiring | `web/src/components/layout/AppShell.tsx`, `web/src/router.tsx` | needs `Analytics` page export to exist; trivial — sequence after frontend skeleton lands or merge-conflict resolve |

Both backend and frontend can run in parallel because tests mock `apiCall`. Nav-wiring is small enough to fold into the frontend agent's task list to avoid a third worktree.

**Recommended split**: 2 parallel agents (backend, frontend+nav). Agree on the API response TypeScript interfaces upfront (interfaces below) and pin them in both worktrees.

### API Response Interfaces (contract — both agents must honor)
```ts
// GET /api/analytics/overview
interface OverviewResponse {
  kpis: { medianEurPerSqm: number; activeInventory: number; medianDomDays: number; bestDealsCount: number; recentDropsCount: number };
  trendByDistrict: Record<string /*district*/, number[] /*12 months, oldest first*/>;
  months: string[]; // 12 short labels
  heatmap: Record<string /*district*/, Record<string /*rooms bucket*/, number>>;
  domBuckets: { label: string; count: number; hot?: boolean; stale?: boolean }[];
  inventory12w: number[]; newPerWeek: number[]; gonePerWeek: number[];
  scatter: { id: string; areaSqm: number; priceK: number; district: string }[];
}
// GET /api/analytics/best-buys
interface BestBuyRow { id: string; title: string; district: string; type: string; priceEur: number; areaSqm: number; yearBuilt: number; daysOnMkt: number; eurPerSqm: number; medianEurPerSqm: number; discount: number; z: number; score: number; priceDrop: boolean; dropPct: number }
// GET /api/analytics/price-drops
interface PriceDropRow { id: string; title: string; district: string; type: string; priceWas: number; priceEur: number; dropPct: number; dropEur: number; when: string /*'3h' | '12d'*/ }
```

### Backend implementation hints
- District medians: `SELECT district, percentile_cont(0.5) WITHIN GROUP (ORDER BY priceEur::float / NULLIF(areaSqm,0)) FROM "Listing" WHERE active GROUP BY district`.
- Trend (12mo): bucket `firstSeenAt` by `date_trunc('month', ...)`, compute median €/m² per district per month over snapshot+listing join (or active listings as of month end).
- DOM = `EXTRACT(DAY FROM now() - "firstSeenAt")` for active listings; bucket in SQL or JS.
- Scatter: 20 most-recent active listings with `priceEur` and `areaSqm`, project `{areaSqm, priceK: priceEur/1000, district}`.
- Best buys score: `score = -z + (daysOnMkt<1d?0.4:daysOnMkt<7d?0.2:0) + |dropPct|*4`; `z = (eurPerSqm - districtMedian) / districtStdDev`. Filter by query params; sort by score desc; cap 50.
- Price drops: latest 2 `ListingSnapshot` per listing in window, `dropPct = round((1 - latest/earliest)*100)`; require dropPct ≥ 3; `when` from `latest.capturedAt` via `fmt.rel`-style relative string in route.
- Type field: schema has no `type` column — derive from `Listing.title` regex (`/casă|casa/i` → House, `/vil[ăa]/i` → Villa, `/townhouse/i` → Townhouse) OR add a stub returning `'House'` and document as TODO. Recommend regex derivation in route helper to keep design parity.
- Rooms bucket: `Listing.rooms` → `'1–2'|'3'|'4'|'5+'`.

### Frontend hints
- Use `cx` from `clsx` if present (`pnpm ls clsx` in `web/`); otherwise inline a 5-line `cx(...args)`. Check `web/src/lib/` first.
- Types: keep API response interfaces in `web/src/pages/Analytics.tsx` or new `web/src/lib/analytics-types.ts`.
- `noUncheckedIndexedAccess` is on — guard every `arr[i]` with `?? 0` or non-null assertion when math demands it.
- ESM `.js` extensions on relative imports.

## Verification
- `pnpm test src/web/routes/__tests__/analytics.test.ts` — green
- `cd web && pnpm test src/__tests__/Analytics.test.tsx` — green
- `pnpm typecheck && pnpm lint` — clean (strict mode, NodeNext ESM)
- `pnpm test` — full suite stays green (no regression in existing routes)
- Manual smoke: `pnpm dev` + `cd web && pnpm dev`, click Analytics nav → all 3 tabs render with real data; switch tabs preserves filter state in page-level `useState`.
- Conventional Commit scope: `web` (frontend) + `web` (backend route still under `src/web/`); single squash-merge to `main`.
