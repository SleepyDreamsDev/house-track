// Cheerio: parse a 999.md detail page into a full ParsedDetail row.
//
// Source: docs/poc-spec.md §"Database schema" + §"Crawl flow" step 7:
//   "Parse details — extract full schema fields; compute rawHtmlHash."

import type { ParsedDetail } from './types.js';

/**
 * Parse one detail-page HTML into a full ParsedDetail row.
 *
 * TODO(scaffold): implement.
 *  - Save 2–3 real detail pages to `src/__tests__/fixtures/detail-*.html`.
 *  - Compute `rawHtmlHash` as `sha256(normalizedHtml)` — strip nav/footer/ads
 *    so unrelated A/B test changes don't trip change detection.
 *  - Per spec §"Failure handling": on schema drift (a required field missing),
 *    log a warning with a sample HTML snippet and return PARTIAL data — do not
 *    throw. Better to capture incomplete data than lose the listing.
 *  - Always populate `priceRaw` even when `priceEur` is null (currency = MDL/USD).
 */
export function parseDetail(_url: string, _html: string): ParsedDetail {
  throw new Error('not implemented — see TODO in src/parse-detail.ts');
}
