// Hardcoded filter (Phase 1). YAML loader comes later.
//
// IMPORTANT: 999.md URL params use opaque `o_<id>_<id>=<value>` form and
// shift across category trees. Do NOT guess — open 999.md in a browser, apply
// filters by hand (Vând / Casă / Chișinău+Durlești / 0–250000 EUR / 0–200 m²),
// and copy the resulting query-string keys into `params` below.
//
// Source: docs/poc-spec.md §"Hardcoded filter (Phase 1)".

export const FILTER = {
  baseUrl: 'https://999.md/ro/list/real-estate/houses-and-villas',

  // TODO(scaffold): replace these placeholder param names with the real
  // `o_<id>_<id>` keys copied from a real browser session.
  params: {
    deal_type: 'sale', // VERIFY: e.g. o_30_237=775
    location_chisinau: true, // VERIFY: location_id for Chișinău
    location_durlesti: true, // VERIFY: location_id for Durlești (may be a sub-filter under Chișinău)
    price_eur_max: 250_000, // VERIFY: price param + EUR currency code
    area_sqm_max: 200, // VERIFY
  },

  maxPagesPerSweep: 20, // safety cap; the index typically has ~10 pages
} as const;

export const POLITENESS = {
  baseDelayMs: 8_000,
  jitterMs: 2_000,
  detailDelayMs: 10_000,
  retryBackoffsMs: [10_000, 30_000, 90_000] as const,
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
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
