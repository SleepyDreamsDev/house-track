// One sweep tick: pre-flight → paginate index → diff → fetch+parse+persist
// details for new ids → markSeen / markInactiveOlderThan → finishSweep.
//
// Spec: docs/poc-spec.md §"Crawl flow (per sweep)".

import type { Circuit } from './circuit.js';
import { CircuitTrippingError, type Fetcher } from './fetch.js';
import type { Logger } from './log.js';
import type { Persistence, SweepResult } from './persist.js';
import type { ListingStub, ParsedDetail, SweepError, SweepStatus } from './types.js';

export interface SweepDeps {
  fetcher: Pick<Fetcher, 'fetchPage'>;
  persist: Pick<
    Persistence,
    | 'diffAgainstDb'
    | 'markSeen'
    | 'markInactiveOlderThan'
    | 'persistDetail'
    | 'startSweep'
    | 'finishSweep'
  >;
  circuit: Pick<Circuit, 'isOpen'>;
  parseIndex: (html: string) => ListingStub[];
  parseDetail: (url: string, html: string) => ParsedDetail;
  buildIndexUrl: (page: number) => string;
  maxPagesPerSweep: number;
  missingThresholdMs: number;
  log?: Logger;
}

export async function runSweep(deps: SweepDeps): Promise<void> {
  if (await deps.circuit.isOpen()) {
    deps.log?.warn({ event: 'sweep.skip', reason: 'circuit_open' });
    const { id } = await deps.persist.startSweep();
    await deps.persist.finishSweep(id, emptyResult('circuit_open'));
    return;
  }

  const { id: sweepId } = await deps.persist.startSweep();
  const result: SweepResult = emptyResult('ok');

  try {
    const stubs = await collectIndexStubs(deps, result);
    const { new: newStubs, seen: seenStubs } = await deps.persist.diffAgainstDb(stubs);
    result.newListings = newStubs.length;

    await fetchAndPersistDetails(deps, newStubs, result);

    await deps.persist.markSeen(seenStubs);
    result.updatedListings = seenStubs.length;
    await deps.persist.markInactiveOlderThan(deps.missingThresholdMs);
  } catch (err) {
    if (err instanceof CircuitTrippingError) {
      result.status = 'circuit_open';
    } else {
      result.status = 'failed';
      result.errors.push({ url: '<sweep>', status: null, msg: String(err) });
    }
  } finally {
    await deps.persist.finishSweep(sweepId, result);
    deps.log?.info({ event: 'sweep.done', ...result });
  }
}

async function collectIndexStubs(deps: SweepDeps, result: SweepResult): Promise<ListingStub[]> {
  const all: ListingStub[] = [];
  for (let page = 1; page <= deps.maxPagesPerSweep; page++) {
    const url = deps.buildIndexUrl(page);
    const res = await deps.fetcher.fetchPage(url); // CircuitTrippingError bubbles
    result.pagesFetched += 1;

    let stubs: ListingStub[];
    try {
      stubs = deps.parseIndex(res.body);
    } catch (err) {
      record(result, { url, status: res.status, msg: `parseIndex: ${String(err)}` });
      result.status = 'partial';
      break;
    }

    if (stubs.length === 0) break;
    all.push(...stubs);
  }
  return all;
}

async function fetchAndPersistDetails(
  deps: SweepDeps,
  newStubs: ListingStub[],
  result: SweepResult,
): Promise<void> {
  for (const s of newStubs) {
    let res;
    try {
      res = await deps.fetcher.fetchPage(s.url);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url: s.url, status: null, msg: String(err) });
      result.status = 'partial';
      continue;
    }
    result.detailsFetched += 1;

    if (res.status === 404) continue; // delisted between index and detail — not an error

    let parsed: ParsedDetail;
    try {
      parsed = deps.parseDetail(s.url, res.body);
    } catch (err) {
      record(result, { url: s.url, status: res.status, msg: `parseDetail: ${String(err)}` });
      result.status = 'partial';
      continue;
    }

    try {
      await deps.persist.persistDetail(parsed);
    } catch (err) {
      record(result, { url: s.url, status: res.status, msg: `persist: ${String(err)}` });
      result.status = 'partial';
    }
  }
}

function record(result: SweepResult, error: SweepError): void {
  result.errors.push(error);
}

function emptyResult(status: SweepStatus): SweepResult {
  return {
    status,
    pagesFetched: 0,
    detailsFetched: 0,
    newListings: 0,
    updatedListings: 0,
    errors: [],
  };
}
