import { describe, expect, it, vi } from 'vitest';

import type { Circuit } from '../circuit.js';
import { CircuitTrippingError, type Fetcher } from '../fetch.js';
import type { Persistence } from '../persist.js';
import { runSweep, type SweepDeps } from '../sweep.js';
import type { FetchResult, ListingStub, ParsedDetail } from '../types.js';

const HOUR = 60 * 60 * 1000;

const stub = (id: string): ListingStub => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '€100000',
  postedAt: null,
});

const detail = (id: string): ParsedDetail => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '€100000',
  rooms: 4,
  areaSqm: 120,
  landSqm: 600,
  district: 'Buiucani',
  street: 'Test',
  floors: 2,
  yearBuilt: 2010,
  heatingType: 'autonomă',
  description: 'desc',
  features: [],
  imageUrls: [],
  sellerType: 'private',
  postedAt: null,
  bumpedAt: null,
  rawHtmlHash: `hash-${id}`,
});

interface MockEnv {
  deps: SweepDeps;
  fetchPage: ReturnType<typeof vi.fn>;
  isOpen: ReturnType<typeof vi.fn>;
  diffAgainstDb: ReturnType<typeof vi.fn>;
  markSeen: ReturnType<typeof vi.fn>;
  markInactiveOlderThan: ReturnType<typeof vi.fn>;
  persistDetail: ReturnType<typeof vi.fn>;
  startSweep: ReturnType<typeof vi.fn>;
  finishSweep: ReturnType<typeof vi.fn>;
  parseIndex: ReturnType<typeof vi.fn>;
  parseDetail: ReturnType<typeof vi.fn>;
}

function makeEnv(): MockEnv {
  const fetchPage = vi.fn<(url: string) => Promise<FetchResult>>();
  const isOpen = vi.fn().mockResolvedValue(false);
  const diffAgainstDb = vi
    .fn()
    .mockImplementation(async (s: ListingStub[]) => ({ new: s, seen: [] }));
  const markSeen = vi.fn().mockResolvedValue(undefined);
  const markInactiveOlderThan = vi.fn().mockResolvedValue(0);
  const persistDetail = vi.fn().mockResolvedValue(undefined);
  const startSweep = vi.fn().mockResolvedValue({ id: 1 });
  const finishSweep = vi.fn().mockResolvedValue(undefined);
  const parseIndex = vi.fn<(html: string) => ListingStub[]>();
  const parseDetail = vi.fn<(url: string, html: string) => ParsedDetail>();

  const deps: SweepDeps = {
    fetcher: { fetchPage } as unknown as Fetcher,
    persist: {
      diffAgainstDb,
      markSeen,
      markInactiveOlderThan,
      persistDetail,
      startSweep,
      finishSweep,
    } as unknown as Persistence,
    circuit: { isOpen } as unknown as Circuit,
    parseIndex,
    parseDetail,
    buildIndexUrl: (n: number) => `https://test/index?page=${n}`,
    maxPagesPerSweep: 5,
    missingThresholdMs: 3 * HOUR,
  };

  return {
    deps,
    fetchPage,
    isOpen,
    diffAgainstDb,
    markSeen,
    markInactiveOlderThan,
    persistDetail,
    startSweep,
    finishSweep,
    parseIndex,
    parseDetail,
  };
}

describe('runSweep', () => {
  it('Pre-flight short-circuits when the breaker is already open', async () => {
    const env = makeEnv();
    env.isOpen.mockResolvedValueOnce(true);

    await runSweep(env.deps);

    expect(env.fetchPage).not.toHaveBeenCalled();
    expect(env.startSweep).toHaveBeenCalledOnce();
    expect(env.finishSweep).toHaveBeenCalledOnce();
    expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'circuit_open' });
  });

  it('Happy path: 1 page with 2 stubs, both new and persisted', async () => {
    const env = makeEnv();
    env.fetchPage.mockResolvedValueOnce({ url: 'idx', status: 200, body: '<idx>' });
    env.parseIndex.mockReturnValueOnce([stub('A'), stub('B')]);
    env.parseIndex.mockReturnValueOnce([]); // page 2 empty → stop pagination
    env.fetchPage.mockResolvedValueOnce({ url: 'idx2', status: 200, body: '<empty>' });
    env.fetchPage.mockResolvedValueOnce({ url: 'detA', status: 200, body: '<a>' });
    env.fetchPage.mockResolvedValueOnce({ url: 'detB', status: 200, body: '<b>' });
    env.parseDetail.mockReturnValueOnce(detail('A')).mockReturnValueOnce(detail('B'));

    await runSweep(env.deps);

    expect(env.persistDetail).toHaveBeenCalledTimes(2);
    expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'ok', newListings: 2 });
  });

  it('Empty index page stops pagination', async () => {
    const env = makeEnv();
    env.fetchPage.mockResolvedValueOnce({ url: 'idx', status: 200, body: '<empty>' });
    env.parseIndex.mockReturnValueOnce([]);

    await runSweep(env.deps);

    expect(env.fetchPage).toHaveBeenCalledOnce();
  });

  it('A CircuitTrippingError mid-sweep aborts and marks status circuit_open', async () => {
    const env = makeEnv();
    env.fetchPage.mockResolvedValueOnce({ url: 'idx', status: 200, body: '<idx>' });
    env.parseIndex.mockReturnValueOnce([stub('A')]);
    env.parseIndex.mockReturnValueOnce([]);
    env.fetchPage.mockResolvedValueOnce({ url: 'idx2', status: 200, body: '' });
    env.fetchPage.mockRejectedValueOnce(new CircuitTrippingError(429, 'detA'));

    await runSweep(env.deps);

    expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'circuit_open' });
  });

  it('parseDetail throwing on one listing does not kill the sweep', async () => {
    const env = makeEnv();
    env.fetchPage.mockResolvedValueOnce({ url: 'idx', status: 200, body: '<idx>' });
    env.parseIndex.mockReturnValueOnce([stub('A'), stub('B')]);
    env.parseIndex.mockReturnValueOnce([]);
    env.fetchPage.mockResolvedValueOnce({ url: 'idx2', status: 200, body: '' });
    env.fetchPage.mockResolvedValueOnce({ url: 'detA', status: 200, body: '<a>' });
    env.fetchPage.mockResolvedValueOnce({ url: 'detB', status: 200, body: '<b>' });
    env.parseDetail
      .mockImplementationOnce(() => {
        throw new Error('schema drift');
      })
      .mockReturnValueOnce(detail('B'));

    await runSweep(env.deps);

    expect(env.persistDetail).toHaveBeenCalledOnce();
    expect(env.persistDetail.mock.calls[0]?.[0].id).toBe('B');
    const result = env.finishSweep.mock.calls[0]?.[1];
    expect(result.status).toBe('partial');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ msg: expect.stringContaining('schema drift') });
  });

  it('404 on a detail is not a failure', async () => {
    const env = makeEnv();
    env.fetchPage.mockResolvedValueOnce({ url: 'idx', status: 200, body: '<idx>' });
    env.parseIndex.mockReturnValueOnce([stub('A')]);
    env.parseIndex.mockReturnValueOnce([]);
    env.fetchPage.mockResolvedValueOnce({ url: 'idx2', status: 200, body: '' });
    env.fetchPage.mockResolvedValueOnce({ url: 'detA', status: 404, body: '' });

    await runSweep(env.deps);

    expect(env.persistDetail).not.toHaveBeenCalled();
    expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'ok' });
    expect(env.finishSweep.mock.calls[0]?.[1].errors).toHaveLength(0);
  });

  it('Seen ids get markSeen and stale ids get aged out', async () => {
    const env = makeEnv();
    env.fetchPage.mockResolvedValueOnce({ url: 'idx', status: 200, body: '<idx>' });
    env.parseIndex.mockReturnValueOnce([stub('A'), stub('B')]);
    env.parseIndex.mockReturnValueOnce([]);
    env.fetchPage.mockResolvedValueOnce({ url: 'idx2', status: 200, body: '' });
    env.fetchPage.mockResolvedValueOnce({ url: 'detB', status: 200, body: '<b>' });
    env.parseDetail.mockReturnValueOnce(detail('B'));
    env.diffAgainstDb.mockResolvedValueOnce({ new: [stub('B')], seen: [stub('A')] });

    await runSweep(env.deps);

    expect(env.markSeen).toHaveBeenCalledOnce();
    expect(env.markSeen.mock.calls[0]?.[0].map((s: ListingStub) => s.id)).toEqual(['A']);
    expect(env.markInactiveOlderThan).toHaveBeenCalledWith(3 * HOUR);
  });
});
