// Cheerio: parse a 999.md index page into listing stubs.
//
// Source: docs/poc-spec.md §"Crawl flow (per sweep)" step 4:
//   "Parse stubs — extract `{id, url, title, priceEur, postedAt}` per card."

import type { ListingStub } from './types.js';

/**
 * Parse one rendered index HTML page into a list of stubs.
 *
 * TODO(scaffold): implement.
 *  - Save a real index page to `src/__tests__/fixtures/index.html` first.
 *  - Use `cheerio.load(html)` and select listing cards (selector TBD from the
 *    saved fixture).
 *  - For each card, extract:
 *      id        — numeric ID parsed out of the listing URL
 *      url       — absolute URL (base on https://999.md)
 *      title     — visible card title
 *      priceEur  — integer EUR; null if currency is MDL/USD or unparseable
 *      postedAt  — Date if posted-time is on the card; null otherwise
 *  - Always store the raw price string in the persistence layer for audit;
 *    don't lose it here. Return null `priceEur` if normalization is uncertain.
 */
export function parseIndex(_html: string): ListingStub[] {
  throw new Error('not implemented — see TODO in src/parse-index.ts');
}
