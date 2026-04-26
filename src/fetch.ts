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

export class Fetcher {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly jitter: () => number;
  private lastRequestAt = 0;

  constructor(private readonly deps: FetcherDeps) {
    this.sleep = deps.sleep ?? defaultSleep;
    this.jitter = deps.jitter ?? defaultJitter(deps.config.jitterMs);
  }

  async fetchPage(url: string): Promise<FetchResult> {
    await this.maybeWaitBetweenRequests();
    return this.attempt(url, 0);
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

  private async attempt(url: string, attemptIdx: number): Promise<FetchResult> {
    let res: FetchResult;
    try {
      res = await this.doRequest(url);
    } catch (err) {
      // Network error: retry with the same backoff schedule as 5xx.
      const backoff = this.deps.config.retryBackoffsMs[attemptIdx];
      if (backoff !== undefined) {
        await this.sleep(backoff);
        return this.attempt(url, attemptIdx + 1);
      }
      throw err;
    }

    if (res.status === 403 || res.status === 429) {
      await this.deps.circuit.recordFailure();
      throw new CircuitTrippingError(res.status, url);
    }

    if (res.status >= 500) {
      const backoff = this.deps.config.retryBackoffsMs[attemptIdx];
      if (backoff !== undefined) {
        await this.sleep(backoff);
        return this.attempt(url, attemptIdx + 1);
      }
      throw new Error(`5xx after retries: ${res.status} ${url}`);
    }

    this.deps.circuit.recordSuccess();
    return res;
  }

  private async doRequest(url: string): Promise<FetchResult> {
    const { config } = this.deps;
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: {
        'user-agent': config.userAgent,
        'accept-language': config.acceptLanguage,
        accept: config.accept,
      },
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
