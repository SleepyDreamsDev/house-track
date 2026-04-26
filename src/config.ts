// Hardcoded filter (Phase 1). YAML loader comes later.
//
// Source: docs/poc-spec.md §"Hardcoded filter (Phase 1)".
//
// 999.md URL FACTS — extracted from real (search-indexed) listing URLs:
//
//   Category path:    /ro/list/real-estate/house-and-garden
//                     ^^^^ NOT "houses-and-villas" — that path 404s.
//
//   Location is path-based:
//     City wide:       /ro/Chisinau/list/real-estate/house-and-garden
//     City + suburb:   /ro/Kishiniov/Durleshty/list/real-estate/house-and-garden
//                      (note 999.md uses both Romanian and Russian transliteration;
//                      both work, both return the same listings.)
//
//   Filter param keys are 3-segment opaque IDs: o_<group>_<sub>=<value>
//   or o_<group>_<sub>_<context>=<value>. Values are also opaque numeric ids.
//
//     o_41_1=903                 → "vânzare" (sale)        ✅ verified
//     o_41_1=912                 → monthly rental (don't use)
//     o_38_249=1641              → 1 level
//     o_38_249=1643              → 2 levels
//     o_40_7=12900               → top-level Chișinău location
//     o_40_8_12900=13917         → Durlești inside Chișinău
//     o_40_8_12900=13942         → Codru inside Chișinău
//     applied=1                  → "filters applied" flag
//     view_type=detail|photo     → presentation only, no effect on results
//     selected_currency=eur|mdl  → display currency; doesn't filter
//     ef=40, eo=12900            → location-context echoes; usually safe to omit
//     page=N                     → 1-indexed pagination
//
//   STILL UNKNOWN — cannot be discovered without browser access:
//     - price filter param key (something like o_60_125_min / _max)
//     - area filter param key  (something like o_50_*  _min / _max)
//
//   The unknowns mean we can't pre-filter on €250k or 200 m² at the URL layer.
//   Strategy: fetch ALL Chișinău houses for sale, drop the ones over budget /
//   too large in `parse-index.ts` after parsing the price + area fields.
//   When you can paste a URL with those filters applied, drop the keys here
//   and we move pre-filtering back to the URL layer (cuts sweep size 4-6x).

export const FILTER = {
  // Chișinău includes Durlești as a sub-locality, so this single base URL
  // covers both targeted areas.
  baseUrl: 'https://999.md/ro/Chisinau/list/real-estate/house-and-garden',

  params: {
    // Sale only ("vânzare"). Verified.
    o_41_1: '903',
    // Apply the filters. Without this 999.md sometimes ignores the o_* params.
    applied: '1',
    // Force EUR display so price normalization in parse-index has a chance.
    selected_currency: 'eur',
    // Echo the location context so 999.md doesn't second-guess our path.
    ef: '40',
    eo: '12900',
  },

  // Client-side filters applied AFTER parse-index, since the URL-level
  // price/area params are unknown. See module header.
  postFilter: {
    maxPriceEur: 250_000,
    maxAreaSqm: 200,
  },

  maxPagesPerSweep: 30, // bumped from 20 — without URL-level filters, sweeps return more
} as const;

export const POLITENESS = {
  baseDelayMs: 8_000,
  jitterMs: 2_000,
  detailDelayMs: 10_000,
  retryBackoffsMs: [10_000, 30_000, 90_000] as const,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  acceptLanguage: 'ro-RO,ru-RU;q=0.9,en;q=0.8',
  accept: 'text/html,application/xhtml+xml',
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
} as const;
