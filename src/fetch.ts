// undici-based fetcher with rate limiting, retries, and a realistic UA.
//
// Politeness budget — see docs/poc-spec.md §"Politeness budget":
//   - 8s ± 2s jitter between requests, concurrency 1
//   - retry on 5xx with backoff 10s/30s/90s (3 attempts)
//   - 403/429 → trip circuit breaker, abort sweep
//   - realistic Firefox UA, ro-RO/ru-RU/en Accept-Language, no cookies

import type { FetchResult } from './types.js';

/**
 * Fetch a single URL with the politeness rules above.
 *
 * TODO(scaffold): implement.
 *  - Use `undici.request` with Pool (concurrency 1, keep-alive).
 *  - Apply 8s±2s sleep BEFORE each request (caller can opt out for the very
 *    first request of a sweep).
 *  - Retry on 5xx per `POLITENESS.retryBackoffsMs`.
 *  - On 403 or 429 throw a `CircuitTrippingError` so the sweep aborts and
 *    `circuit.ts` can record the failure.
 *  - Return `{ url, status, body }` on any non-throwing outcome (including 404,
 *    which is expected for delisted listings).
 */
export async function fetchPage(_url: string): Promise<FetchResult> {
  throw new Error('not implemented — see TODO in src/fetch.ts');
}

export class CircuitTrippingError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`Circuit-tripping status ${status} from ${url}`);
    this.name = 'CircuitTrippingError';
  }
}
