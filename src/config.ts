// Hardcoded filter (Phase 1). YAML loader comes later.
//
// Source: docs/poc-spec.md §"Hardcoded filter (Phase 1)".
//
// 999.md uses GraphQL at https://999.md/graphql (POST, Content-Type: application/json).
// Filter IDs were discovered by intercepting browser network requests with Playwright.
//
// KEY DISCOVERY: The URL param ID space (o_41_1=903) is DIFFERENT from the GraphQL
// optionId space. Example: URL param 903 = daily rental; GraphQL optionId 776 = "Vând"
// (for sale). Always verify by reading `offerType.value.translated` on actual results.
//
// Verified GraphQL filter IDs (2026-04-26):
//   subCategoryId 1406         → house-and-garden subcategory
//   filterId 41, featureId 1:
//     optionId 776             → "Vând" (for sale) ✅
//     optionId 903             → "De închiriat pe zi" (daily rental) — NOT sale
//   filterId 40, featureId 7:
//     optionId 12900           → Chișinău municipality ✅
//   Pagination:                → limit + skip (0-indexed offset)
//
// Listing URL format:  https://999.md/ro/<id>  (NOT /advert/<id>)
//
// STILL UNKNOWN — cannot be discovered without more exploration:
//   - area filter param key (would cut sweep size ~4-6x)
//   - price range filter param key
//
// Strategy: fetch all Chișinău houses for sale (3302 listings), drop the ones over
// budget / too large in parse-index.ts after parsing title ("Casă, 140 m², Colonița").

export const GRAPHQL_ENDPOINT = 'https://999.md/graphql';

export const FILTER = {
  // Listing URL base — append /<id> for detail pages.
  listingBaseUrl: 'https://999.md/ro',

  // GraphQL search input for SearchAds operation.
  searchInput: {
    subCategoryId: 1406,
    source: 'AD_SOURCE_DESKTOP' as const,
    filters: [
      // Sale listings only ("Vând").
      { filterId: 16, features: [{ featureId: 1, optionIds: [776] }] },
      // Chișinău municipality (includes Durlești, Codru, Colonița, etc.).
      { filterId: 32, features: [{ featureId: 7, optionIds: [12900] }] },
    ],
  },

  // Client-side filters applied AFTER parse-index, since URL-level price/area
  // params are still unknown. See module header.
  postFilter: {
    maxPriceEur: 250_000,
    maxAreaSqm: 200,
  },

  // Listings per GraphQL page. 78 matches the browser default; keep it.
  pageSize: 78,
  maxPagesPerSweep: 50, // 50 * 78 = 3900 — covers the full 3302 count with headroom
} as const;

export const POLITENESS = {
  baseDelayMs: 8_000,
  jitterMs: 2_000,
  detailDelayMs: 10_000,
  retryBackoffsMs: [10_000, 30_000, 90_000] as const,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  acceptLanguage: 'ro-RO,ru-RU;q=0.9,en;q=0.8',
  accept: 'text/html,application/xhtml+xml',
  // Sent on POST (GraphQL) requests. Real Firefox sends */* but axios-style
  // libraries narrow it to JSON; "application/json, text/plain, */*" matches
  // what 999.md's web app emits on its own GraphQL requests.
  acceptJson: 'application/json, text/plain, */*',
  // Sent on every GraphQL request to look like a same-origin XHR from the
  // listings page rather than a direct API probe.
  origin: 'https://999.md',
  referer: 'https://999.md/ro/list/real-estate/houses-and-yards',
  // Adaptive soft-throttle defaults (PR 1 plumbing). When the rolling-window
  // observer (lands in PR 2) detects a 5xx-rate / latency-spike /
  // connection-reset signal it multiplies the active delay by this factor
  // for softThrottleDurationMinutes before the hard 24h circuit can ever
  // trip. Both knobs are runtime-mutable via the Setting table.
  softThrottleMultiplier: 3,
  softThrottleDurationMinutes: 30,
} as const;

export const CIRCUIT = {
  // 3 consecutive 4xx (excluding 404) trips the breaker for 24h.
  consecutiveFailureThreshold: 3,
  pauseDurationMs: 24 * 60 * 60 * 1_000,
  sentinelPath: '/data/.circuit_open',
} as const;

export const SWEEP = {
  // How many consecutive sweeps a listing must be missing from the index
  // before we mark it inactive. See spec §"Crawl flow (per sweep)" step 5.
  missingSweepsBeforeInactive: 3,
  // Per-tick cap on backfill of legacy listings with NULL filterValuesEnrichedAt.
  // 30/sweep × 24/day = 720/day → ~5 days to fully backfill ~3,300 listings.
  // 0 disables backfill. Each backfill request shares the same 8s±2s gap so
  // the request shape is indistinguishable from a sweep with extra new listings.
  backfillPerSweep: 30,
  // Per-tick cap on stale-refresh rotation (watchlist + oldest lastFetchedAt).
  // 50/sweep × 24/day = 1200/day stale rotations → keeps a 10k DB on a roughly
  // 8-day cycle, with watchlist always priority. 0 disables.
  staleRefreshPerSweep: 50,
  // Cron quiet hours [start, end) in Europe/Chisinau local time. Sweeps
  // fired by cron are suppressed during this window — browsing 999.md
  // from the same IP overnight is suspicious. Manual triggers bypass.
  // Set start == end to disable.
  quietHoursStart: 2,
  quietHoursEnd: 6,
  // Variable sweep size: each tick targets a random draw from
  // [mean - jitter, mean + jitter] listings; pagination stops once
  // accumulated listings cross the draw. Set jitter to 0 to disable.
  targetListingsPerSweep: 400,
  targetListingsJitter: 130,
  // Cron-fire jitter: the actual tick is deferred by setTimeout(random(0, N))
  // after the cron expression fires. Defangs pattern-detection on fixed
  // firing times. 0 = fire immediately.
  cronWindowJitterMs: 60 * 60 * 1000, // 1h
  // Expected sweeps/day. Decoupled from the cron expression because the
  // cron is user-mutable but the missing-listings threshold needs a stable
  // anchor. Phase B's forecast panel surfaces inconsistencies between
  // these two values.
  expectedPerDay: 2,

  // ── Two-tier cadence defaults (PR 1 plumbing) ──────────────────────────
  // No code reads these yet — PR 2 wires the index ticker + detail trickle
  // schedulers. Stored here so settings.ts has a single defaults source.
  // See plans/reassess-the-politeness-approach-partitioned-plum.md.

  // Feature flag: 'legacy' = current runSweep() monolith; 'two_tier' =
  // index ticker + detail trickle. PR 2 honours this; PR 3 flips it.
  mode: 'legacy' as 'legacy' | 'two_tier',

  // Tier 1 — Index ticker
  indexTickIntervalMinutesMin: 60,
  indexTickIntervalMinutesMax: 120,
  indexTickTargetListings: 100,

  // Tier 2 — Detail trickle
  detailTrickleIntervalSecondsMin: 180,
  detailTrickleIntervalSecondsMax: 360,
  detailTrickleQueueRefillThreshold: 40,

  // Queue seeding policy
  staleThresholdHours: 168, // 7 days
  watchlistRefreshHours: 6,
} as const;
