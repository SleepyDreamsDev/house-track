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

  async fetchGraphQL(
    endpoint: string,
    operationName: string,
    variables: Record<string, unknown>,
    query: string,
  ): Promise<unknown> {
    const body = JSON.stringify({ operationName, variables, query });
    const res = await this.run(endpoint, {
      method: 'POST',
      body,
      extraHeaders: { 'content-type': 'application/json' },
    });
    return JSON.parse(res.body);
  }

  private async run(url: string, opts: RequestOptions): Promise<FetchResult> {
    await this.maybeWaitBetweenRequests();
    return this.attempt(url, opts, 0);
  }

  private async maybeWaitBetweenRequests(): Promise<void> {
    if (this.lastRequestAt === 0) {
      this.lastRequestAt = Date.now();
      return;
    }
    const elapsed = Date.now() - this.lastRequestAt;
    const target = this.deps.config.baseDelayMs + this.jitter();
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
    try {
      res = await this.doRequest(url, opts);
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

    this.deps.circuit.recordSuccess();
    return res;
  }

  private async doRequest(url: string, opts: RequestOptions): Promise<FetchResult> {
    const { config } = this.deps;
    const { statusCode, body } = await request(url, {
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
    return { url, status: statusCode, body: text };
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultJitter =
  (range: number): (() => number) =>
  () =>
    Math.floor(Math.random() * (2 * range + 1)) - range;
