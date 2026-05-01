import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Circuit } from '../circuit.js';
import { CircuitTrippingError, Fetcher, type FetcherConfig } from '../fetch.js';

const ORIGIN = 'https://example.test';

const CONFIG: FetcherConfig = {
  baseDelayMs: 8_000,
  jitterMs: 2_000,
  retryBackoffsMs: [10, 30, 90],
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  acceptLanguage: 'ro-RO,ru-RU;q=0.9,en;q=0.8',
  accept: 'text/html,application/xhtml+xml',
};

const HOUR = 60 * 60 * 1000;

function makeCircuit(sentinelPath: string) {
  return new Circuit({
    sentinelPath,
    threshold: 3,
    pauseDurationMs: 24 * HOUR,
  });
}

describe('Fetcher', () => {
  let dir: string;
  let mockAgent: MockAgent;
  let sleep: ReturnType<typeof vi.fn>;
  let circuit: Circuit;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fetcher-'));
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    sleep = vi.fn().mockResolvedValue(undefined);
    circuit = makeCircuit(join(dir, '.circuit_open'));
  });

  afterEach(async () => {
    await mockAgent.close();
    await rm(dir, { recursive: true, force: true });
  });

  function makeFetcher(jitter = () => 0) {
    return new Fetcher({
      circuit,
      config: CONFIG,
      sleep,
      jitter,
      dispatcher: mockAgent,
    });
  }

  it('A 200 OK is returned to the caller and counts as a success', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/p' }).reply(200, '<html>hi</html>');
    const recordSuccess = vi.spyOn(circuit, 'recordSuccess');

    const result = await makeFetcher().fetchPage(`${ORIGIN}/p`);

    expect(result).toEqual({ url: `${ORIGIN}/p`, status: 200, body: '<html>hi</html>' });
    expect(recordSuccess).toHaveBeenCalledOnce();
  });

  it('A 404 is returned to the caller (delisted listings are normal)', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/gone' }).reply(404, 'Not Found');

    const result = await makeFetcher().fetchPage(`${ORIGIN}/gone`);

    expect(result.status).toBe(404);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('5xx is retried with exponential backoff and then succeeds', async () => {
    const pool = mockAgent.get(ORIGIN);
    pool.intercept({ path: '/flaky' }).reply(503, 'down');
    pool.intercept({ path: '/flaky' }).reply(502, 'down');
    pool.intercept({ path: '/flaky' }).reply(200, 'OK');

    const result = await makeFetcher().fetchPage(`${ORIGIN}/flaky`);

    expect(result.status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(10);
    expect(sleep).toHaveBeenCalledWith(30);
    expect(sleep).not.toHaveBeenCalledWith(90);
  });

  it('5xx retried until the budget is exhausted, then throws', async () => {
    const pool = mockAgent.get(ORIGIN);
    for (let i = 0; i < 4; i++) {
      pool.intercept({ path: '/dead' }).reply(500, 'boom');
    }

    await expect(makeFetcher().fetchPage(`${ORIGIN}/dead`)).rejects.toThrow(/5xx after retries/);
    expect(sleep).toHaveBeenCalledWith(10);
    expect(sleep).toHaveBeenCalledWith(30);
    expect(sleep).toHaveBeenCalledWith(90);
  });

  it('A 403 immediately opens the breaker (no threshold) and aborts the sweep', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/locked' }).reply(403, 'no');
    const tripImmediately = vi.spyOn(circuit, 'tripImmediately');

    await expect(makeFetcher().fetchPage(`${ORIGIN}/locked`)).rejects.toBeInstanceOf(
      CircuitTrippingError,
    );
    expect(tripImmediately).toHaveBeenCalledOnce();
    expect(await circuit.isOpen()).toBe(true);
  });

  it('A 429 immediately opens the breaker (no threshold) and aborts the sweep', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/throttled' }).reply(429, 'slow');
    const tripImmediately = vi.spyOn(circuit, 'tripImmediately');

    const err = await makeFetcher()
      .fetchPage(`${ORIGIN}/throttled`)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CircuitTrippingError);
    expect((err as CircuitTrippingError).status).toBe(429);
    expect(tripImmediately).toHaveBeenCalledOnce();
    expect(await circuit.isOpen()).toBe(true);
  });

  it('A non-404 4xx (400/401/405) records a failure but does not trip immediately', async () => {
    const pool = mockAgent.get(ORIGIN);
    pool.intercept({ path: '/bad' }).reply(400, 'bad');
    pool.intercept({ path: '/auth' }).reply(401, 'auth');
    pool.intercept({ path: '/method' }).reply(405, 'method');
    const recordFailure = vi.spyOn(circuit, 'recordFailure');
    const recordSuccess = vi.spyOn(circuit, 'recordSuccess');

    const fetcher = makeFetcher();
    const r1 = await fetcher.fetchPage(`${ORIGIN}/bad`);
    const r2 = await fetcher.fetchPage(`${ORIGIN}/auth`);
    const r3 = await fetcher.fetchPage(`${ORIGIN}/method`);

    expect(r1.status).toBe(400);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(405);
    expect(recordFailure).toHaveBeenCalledTimes(3);
    expect(recordSuccess).not.toHaveBeenCalled();
    // Threshold is 3, so the 3rd failure should have opened the breaker via the threshold path.
    expect(await circuit.isOpen()).toBe(true);
  });

  it('A 404 still counts as success (delisted listings are normal)', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/gone' }).reply(404, '');
    const recordSuccess = vi.spyOn(circuit, 'recordSuccess');
    const recordFailure = vi.spyOn(circuit, 'recordFailure');

    await makeFetcher().fetchPage(`${ORIGIN}/gone`);

    expect(recordSuccess).toHaveBeenCalledOnce();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('Every request carries the polite headers', async () => {
    let captured: Record<string, string | string[] | undefined> = {};
    mockAgent
      .get(ORIGIN)
      .intercept({ path: '/h' })
      .reply(200, (opts) => {
        captured = opts.headers as Record<string, string | string[] | undefined>;
        return '';
      });

    await makeFetcher().fetchPage(`${ORIGIN}/h`);

    expect(captured['user-agent']).toBe(CONFIG.userAgent);
    expect(captured['accept-language']).toBe(CONFIG.acceptLanguage);
    expect(captured['accept']).toBe(CONFIG.accept);
  });

  it('The first request in a session is not delayed', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/first' }).reply(200, '');

    await makeFetcher().fetchPage(`${ORIGIN}/first`);

    // sleep is only called for retry backoffs; no inter-request delay on attempt 1
    expect(sleep).not.toHaveBeenCalled();
  });

  it('Subsequent requests respect the inter-request delay (with jitter)', async () => {
    const pool = mockAgent.get(ORIGIN);
    pool.intercept({ path: '/a' }).reply(200, '');
    pool.intercept({ path: '/b' }).reply(200, '');

    const fetcher = makeFetcher(() => 500); // +500ms jitter

    await fetcher.fetchPage(`${ORIGIN}/a`);
    await fetcher.fetchPage(`${ORIGIN}/b`);

    // The interleaving sleep call should be base + jitter (8000 + 500),
    // possibly minus a tiny amount of elapsed wall time. Assert near 8500.
    const interRequestSleeps = sleep.mock.calls
      .map((c) => c[0] as number)
      .filter((ms) => ms >= 5_000); // anything >5s is the inter-request wait
    expect(interRequestSleeps).toHaveLength(1);
    expect(interRequestSleeps[0]).toBeGreaterThan(8_000);
    expect(interRequestSleeps[0]).toBeLessThanOrEqual(8_500);
  });

  it('A network error is retried then bubbles', async () => {
    const pool = mockAgent.get(ORIGIN);
    for (let i = 0; i < 4; i++) {
      pool.intercept({ path: '/eof' }).replyWithError(new Error('socket hang up'));
    }

    await expect(makeFetcher().fetchPage(`${ORIGIN}/eof`)).rejects.toThrow(/socket hang up/);
    expect(sleep).toHaveBeenCalledWith(10);
    expect(sleep).toHaveBeenCalledWith(30);
    expect(sleep).toHaveBeenCalledWith(90);
  });

  describe('fetchGraphQL', () => {
    it('POSTs application/json with the operationName, variables, and query', async () => {
      let captured: { method?: string; headers?: Record<string, unknown>; body?: unknown } = {};
      mockAgent
        .get(ORIGIN)
        .intercept({ path: '/graphql', method: 'POST' })
        .reply(200, (opts) => {
          captured = {
            method: opts.method,
            headers: opts.headers as Record<string, unknown>,
            body: opts.body,
          };
          return JSON.stringify({ data: { ok: true } });
        });

      await makeFetcher().fetchGraphQL(`${ORIGIN}/graphql`, 'SearchAds', { page: 1 }, 'query Q {}');

      expect(captured.method).toBe('POST');
      expect(captured.headers?.['content-type']).toMatch(/^application\/json/);
      const body = JSON.parse(String(captured.body));
      expect(body).toEqual({
        operationName: 'SearchAds',
        variables: { page: 1 },
        query: 'query Q {}',
      });
    });

    it('Returns the parsed JSON body on 200', async () => {
      mockAgent
        .get(ORIGIN)
        .intercept({ path: '/graphql', method: 'POST' })
        .reply(200, JSON.stringify({ data: { searchAds: { ads: [], count: 0 } } }));

      const json = await makeFetcher().fetchGraphQL(`${ORIGIN}/graphql`, 'Op', {}, 'q');

      expect(json).toEqual({ data: { searchAds: { ads: [], count: 0 } } });
    });

    it('Retries 5xx with exponential backoff then succeeds', async () => {
      const pool = mockAgent.get(ORIGIN);
      pool.intercept({ path: '/graphql', method: 'POST' }).reply(503, 'down');
      pool.intercept({ path: '/graphql', method: 'POST' }).reply(502, 'down');
      pool
        .intercept({ path: '/graphql', method: 'POST' })
        .reply(200, JSON.stringify({ data: 'ok' }));

      const json = await makeFetcher().fetchGraphQL(`${ORIGIN}/graphql`, 'Op', {}, 'q');

      expect(json).toEqual({ data: 'ok' });
      expect(sleep).toHaveBeenCalledWith(10);
      expect(sleep).toHaveBeenCalledWith(30);
    });

    it('A 429 immediately opens the breaker', async () => {
      mockAgent.get(ORIGIN).intercept({ path: '/graphql', method: 'POST' }).reply(429, 'slow');
      const tripImmediately = vi.spyOn(circuit, 'tripImmediately');

      await expect(
        makeFetcher().fetchGraphQL(`${ORIGIN}/graphql`, 'Op', {}, 'q'),
      ).rejects.toBeInstanceOf(CircuitTrippingError);
      expect(tripImmediately).toHaveBeenCalledOnce();
    });

    it('A 403 trips the circuit', async () => {
      mockAgent.get(ORIGIN).intercept({ path: '/graphql', method: 'POST' }).reply(403, 'no');

      await expect(
        makeFetcher().fetchGraphQL(`${ORIGIN}/graphql`, 'Op', {}, 'q'),
      ).rejects.toBeInstanceOf(CircuitTrippingError);
    });

    it('Records success on 200', async () => {
      mockAgent
        .get(ORIGIN)
        .intercept({ path: '/graphql', method: 'POST' })
        .reply(200, JSON.stringify({ data: 'ok' }));
      const recordSuccess = vi.spyOn(circuit, 'recordSuccess');

      await makeFetcher().fetchGraphQL(`${ORIGIN}/graphql`, 'Op', {}, 'q');

      expect(recordSuccess).toHaveBeenCalledOnce();
    });

    it('Inter-request delay applies between a fetchPage and a subsequent fetchGraphQL', async () => {
      mockAgent.get(ORIGIN).intercept({ path: '/p' }).reply(200, '');
      mockAgent
        .get(ORIGIN)
        .intercept({ path: '/graphql', method: 'POST' })
        .reply(200, JSON.stringify({ data: 'ok' }));

      const fetcher = makeFetcher(() => 0);
      await fetcher.fetchPage(`${ORIGIN}/p`);
      await fetcher.fetchGraphQL(`${ORIGIN}/graphql`, 'Op', {}, 'q');

      const interRequestSleeps = sleep.mock.calls
        .map((c) => c[0] as number)
        .filter((ms) => ms >= 5_000);
      expect(interRequestSleeps).toHaveLength(1);
    });
  });
});
