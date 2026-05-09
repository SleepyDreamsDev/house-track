# Analytics design — drop-in for house-track

Mockups for the new **Analytics** module (Overview / Best buys / Price drops),
built against the existing design system in `web/DESIGN.md`.

## Files

- `House Track UI Redesign.html` — open in a browser, all four pages + new Analytics tabs
- `analytics.jsx` — Analytics page, charts, tables (visual spec for the port)
- `shell.jsx` / `pages.jsx` / `data.jsx` / `design-canvas.jsx` — supporting code (already ported earlier, included for reference)

## Where this goes in the repo

Copy this folder into the repo as `web/design/analytics/` (or wherever you keep design specs).
The actual port lives under `web/src/pages/Analytics/` and its tests under `web/src/__tests__/Analytics.test.tsx`,
matching the pattern used for Dashboard/Sweeps/Settings/Listings.

## Hand-off to Claude Code

Add this to `.claude/plans/ui-redesign-port-kit.md` (or as a new plan
`.claude/plans/analytics-port.md`) and run `/run-backlog`:

> Implement the Analytics module per `web/design/analytics/analytics.jsx`.
>
> - New route + page: `web/src/pages/Analytics.tsx` with three tabs (Overview, Best buys, Price drops).
> - Charts are hand-rolled SVG (MultiLineChart, Heatmap, Scatter, FlowChart, DOMHistogram) — copy as-is.
> - Backend: add `GET /api/analytics/overview`, `GET /api/analytics/best-buys`, `GET /api/analytics/price-drops`
>   under `src/web/routes/analytics.ts`. Queries hit Prisma `Listing` + `PriceSnapshot`.
> - Add `Analytics` nav item in the sidebar (chart icon already in shell.jsx).
> - Tests: follow `Dashboard.test.tsx` pattern.
