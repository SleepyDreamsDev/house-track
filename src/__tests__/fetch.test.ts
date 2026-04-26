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

  it('A 403 trips the circuit and aborts the sweep', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/locked' }).reply(403, 'no');
    const recordFailure = vi.spyOn(circuit, 'recordFailure');

    await expect(makeFetcher().fetchPage(`${ORIGIN}/locked`)).rejects.toBeInstanceOf(
      CircuitTrippingError,
    );
    expect(recordFailure).toHaveBeenCalledOnce();
  });

  it('A 429 trips the circuit and aborts the sweep', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/throttled' }).reply(429, 'slow');
    const recordFailure = vi.spyOn(circuit, 'recordFailure');

    const err = await makeFetcher()
      .fetchPage(`${ORIGIN}/throttled`)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CircuitTrippingError);
    expect((err as CircuitTrippingError).status).toBe(429);
    expect(recordFailure).toHaveBeenCalledOnce();
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
});
