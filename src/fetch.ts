// undici-based fetcher with rate limiting, retries, and a realistic UA.
//
// Spec: docs/poc-spec.md §"Politeness budget" + §"Failure handling".
//   - 8s ± 2s jitter between requests, concurrency 1
//   - retry on 5xx (and network errors) with backoff 10s/30s/90s
//   - 403/429 → records failure on the circuit and throws CircuitTrippingError
//   - realistic Firefox UA, ro-RO/ru-RU/en Accept-Language, no cookies

import { request, type Dispatcher } from 'undici';

import type { Circuit } from './circuit.js';
import type { FetchResult } from './types.js';

export interface FetcherConfig {
  baseDelayMs: number;
  jitterMs: number;
  retryBackoffsMs: readonly number[];
  userAgent: string;
  acceptLanguage: string;
  accept: string;
  /** Accept header for JSON/POST requests. Falls back to `accept` if absent. */
  acceptJson?: string;
  /** Origin header sent on GraphQL POSTs (same-origin XHR mimicry). */
  origin?: string;
  /** Referer header sent on GraphQL POSTs. */
  referer?: string;
}

export interface FetcherDeps {
  circuit: Circuit;
  config: FetcherConfig;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  dispatcher?: Dispatcher;
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

interface RequestOptions {
  method: 'GET' | 'POST';
  body?: string;
  extraHeaders?: Record<string, string>;
  /** Override `baseDelayMs` for the inter-request wait before this call. */
  delayMs?: number;
  /** Reject 200-OK responses whose content-type starts with this value (HTML interstitial). */
  rejectContentTypePrefix?: string;
}

export class Fetcher {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly jitter: () => number;
  private lastRequestAt = 0;

  constructor(private readonly deps: FetcherDeps) {
    this.sleep = deps.sleep ?? defaultSleep;
    this.jitter = deps.jitter ?? defaultJitter(deps.config.jitterMs);
  }

  async fetchPage(url: string): Promise<FetchResult> {
    return this.run(url, { method: 'GET' });
  }

  /**
   * POSTs a GraphQL operation with same-origin-XHR-shaped headers (Origin,
   * Referer, Sec-Fetch-*) and an Accept that matches what 999.md's own client
   * sends. If `delayMs` is set, the inter-request wait before this call uses
   * it instead of `baseDelayMs` (used to slow detail fetches relative to
   * index pages).
   *
   * If 999.md returns an HTML body on this endpoint (a CAPTCHA or block
   * interstitial), we trip the breaker and throw rather than letting
   * `JSON.parse` corrupt the call site with a parser error.
   */
  async fetchGraphQL(
    endpoint: string,
    operationName: string,
    variables: Record<string, unknown>,
    query: string,
    options: { delayMs?: number } = {},
  ): Promise<unknown> {
    const body = JSON.stringify({ operationName, variables, query });
    const { config } = this.deps;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: config.acceptJson ?? config.accept,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };
    if (config.origin) headers['origin'] = config.origin;
    if (config.referer) headers['referer'] = config.referer;

    const opts: RequestOptions = {
      method: 'POST',
      body,
      extraHeaders: headers,
      rejectContentTypePrefix: 'text/html',
    };
    if (options.delayMs !== undefined) opts.delayMs = options.delayMs;
    const res = await this.run(endpoint, opts);
    return JSON.parse(res.body);
  }

  private async run(url: string, opts: RequestOptions): Promise<FetchResult> {
    await this.maybeWaitBetweenRequests(opts.delayMs);
    return this.attempt(url, opts, 0);
  }

  private async maybeWaitBetweenRequests(overrideMs?: number): Promise<void> {
    if (this.lastRequestAt === 0) {
      this.lastRequestAt = Date.now();
      return;
    }
    const elapsed = Date.now() - this.lastRequestAt;
    const base = overrideMs ?? this.deps.config.baseDelayMs;
    const target = base + this.jitter();
    const wait = Math.max(0, target - elapsed);
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async attempt(
    url: string,
    opts: RequestOptions,
    attemptIdx: number,
  ): Promise<FetchResult> {
    let res: FetchResult;
    let contentType: string | undefined;
    try {
      ({ res, contentType } = await this.doRequest(url, opts));
    } catch (err) {
      const backoff = this.deps.config.retryBackoffsMs[attemptIdx];
      if (backoff !== undefined) {
        await this.sleep(backoff);
        return this.attempt(url, opts, attemptIdx + 1);
      }
      throw err;
    }

    if (res.status === 403 || res.status === 429) {
      // Unambiguous block signal — open the breaker immediately so the next tick
      // skips entirely. Risking another hit could escalate to an IP-level block.
      await this.deps.circuit.tripImmediately();
      throw new CircuitTrippingError(res.status, url);
    }

    if (res.status >= 500) {
      const backoff = this.deps.config.retryBackoffsMs[attemptIdx];
      if (backoff !== undefined) {
        await this.sleep(backoff);
        return this.attempt(url, opts, attemptIdx + 1);
      }
      throw new Error(`5xx after retries: ${res.status} ${url}`);
    }

    // Per spec: "3 consecutive 4xx (excluding 404) → pause". 404 is normal
    // (delisted listings); other 4xx (400/401/405/...) count toward the threshold.
    if (res.status >= 400 && res.status < 500 && res.status !== 404) {
      await this.deps.circuit.recordFailure();
      return res;
    }

    // 2xx body that violates the expected content-type (e.g. HTML CAPTCHA on a
    // GraphQL endpoint) is a soft block — trip the breaker before the caller
    // can JSON.parse a CAPTCHA page and crash on its own.
    if (
      opts.rejectContentTypePrefix &&
      contentType?.toLowerCase().startsWith(opts.rejectContentTypePrefix.toLowerCase())
    ) {
      await this.deps.circuit.tripImmediately();
      throw new CircuitTrippingError(res.status, url);
    }

    this.deps.circuit.recordSuccess();
    return res;
  }

  private async doRequest(
    url: string,
    opts: RequestOptions,
  ): Promise<{ res: FetchResult; contentType: string | undefined }> {
    const { config } = this.deps;
    const { statusCode, headers, body } = await request(url, {
      method: opts.method,
      headers: {
        'user-agent': config.userAgent,
        'accept-language': config.acceptLanguage,
        accept: config.accept,
        ...(opts.extraHeaders ?? {}),
      },
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(this.deps.dispatcher ? { dispatcher: this.deps.dispatcher } : {}),
    });
    const text = await body.text();
    const ct = headers['content-type'];
    const contentType = Array.isArray(ct) ? ct[0] : ct;
    return { res: { url, status: statusCode, body: text }, contentType };
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultJitter =
  (range: number): (() => number) =>
  () =>
    Math.floor(Math.random() * (2 * range + 1)) - range;
