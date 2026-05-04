// One sweep tick: pre-flight → paginate index → diff → fetch+parse+persist
// details for new ids → markSeen / markInactiveOlderThan → finishSweep.
//
// Spec: docs/poc-spec.md §"Crawl flow (per sweep)".
// Now GraphQL-native: the sweep takes opaque `fetchSearchPage(pageIdx)` and
// `fetchAdvert(id)` callbacks rather than raw URLs, so it doesn't have to know
// the operation strings or variable shapes.

import type { Circuit } from './circuit.js';
import { CircuitTrippingError } from './fetch.js';
import type { Logger } from './log.js';
import type { Persistence, SweepResult } from './persist.js';
import { AdvertNotFoundError } from './parse-detail.js';
import type { PostFilter } from './parse-index.js';
import type { ListingStub, ParsedDetail, SweepError, SweepStatus } from './types.js';

export interface SweepDeps {
  fetchSearchPage: (pageIdx: number) => Promise<unknown>;
  fetchAdvert: (id: string) => Promise<unknown>;
  persist: Pick<
    Persistence,
    | 'diffAgainstDb'
    | 'markSeen'
    | 'markInactiveOlderThan'
    | 'persistDetail'
    | 'startSweep'
    | 'finishSweep'
    | 'findUnenrichedListings'
    | 'snapshotConfig'
  >;
  circuit: Pick<Circuit, 'isOpen'>;
  parseIndex: (json: unknown) => ListingStub[];
  parseDetail: (id: string, json: unknown) => ParsedDetail;
  applyPostFilter?: (stubs: ListingStub[]) => ListingStub[];
  postFilter?: PostFilter;
  maxPagesPerSweep: number;
  missingThresholdMs: number;
  /** Cap on per-sweep backfill of listings with NULL filterValuesEnrichedAt. 0 disables. */
  backfillPerSweep?: number;
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

  // Capture config snapshot at sweep start
  result.configSnapshot = await deps.persist.snapshotConfig();

  try {
    const allStubs = await collectIndexStubs(deps, result);
    const stubs = deps.applyPostFilter ? deps.applyPostFilter(allStubs) : allStubs;
    const { new: newStubs, seen: seenStubs } = await deps.persist.diffAgainstDb(stubs);
    result.newListings = newStubs.length;

    await fetchAndPersistDetails(deps, newStubs, seenStubs, result);
    await backfillUnenriched(deps, result);

    await deps.persist.markSeen(seenStubs);
    result.updatedListings = seenStubs.length;
    // Only age out when this sweep saw a complete index. A partial sweep means
    // some listings would be missing for a reason unrelated to delisting, so
    // aging them out would corrupt the active set.
    if (result.status === 'ok') {
      await deps.persist.markInactiveOlderThan(deps.missingThresholdMs);
    }
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
  if (!result.pagesDetail) result.pagesDetail = [];

  for (let page = 0; page < deps.maxPagesPerSweep; page++) {
    const pageStart = Date.now();
    const json = await deps.fetchSearchPage(page); // CircuitTrippingError bubbles
    result.pagesFetched += 1;

    let stubs: ListingStub[];
    const parseStart = Date.now();
    try {
      stubs = deps.parseIndex(json);
    } catch (err) {
      record(result, {
        url: `<search-page-${page}>`,
        status: null,
        msg: `parseIndex: ${String(err)}`,
      });
      result.status = 'partial';
      break;
    }
    const parseMs = Date.now() - parseStart;

    // Capture page detail
    const jsonBytes = JSON.stringify(json).length;
    const pageDetail = {
      n: page,
      url: `<search-page-${page}>`,
      status: 200,
      bytes: jsonBytes,
      parseMs,
      found: stubs.length,
      took: Date.now() - pageStart,
    };
    result.pagesDetail.push(pageDetail);

    if (stubs.length === 0) break;
    all.push(...stubs);
  }
  return all;
}

async function fetchAndPersistDetails(
  deps: SweepDeps,
  newStubs: ListingStub[],
  seenStubs: ListingStub[],
  result: SweepResult,
): Promise<void> {
  if (!result.detailsDetail) result.detailsDetail = [];

  // Process new listings: fetch, parse, persist, and capture details
  for (const s of newStubs) {
    let json: unknown;
    try {
      json = await deps.fetchAdvert(s.id);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url: s.url, status: null, msg: String(err) });
      result.status = 'partial';
      continue;
    }
    result.detailsFetched += 1;

    let parsed: ParsedDetail;
    const parseStart = Date.now();
    try {
      parsed = deps.parseDetail(s.id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue; // delisted between index and detail — not an error
      record(result, { url: s.url, status: null, msg: `parseDetail: ${String(err)}` });
      result.status = 'partial';
      continue;
    }
    const parseMs = Date.now() - parseStart;

    // Capture detail info for new listing
    const jsonBytes = JSON.stringify(json).length;
    const detailRecord = {
      id: s.id,
      url: s.url,
      status: 200,
      bytes: jsonBytes,
      parseMs,
      action: 'new' as const,
      priceEur: parsed.priceEur ?? null,
    };
    result.detailsDetail.push(detailRecord);

    try {
      await deps.persist.persistDetail(parsed);
    } catch (err) {
      record(result, { url: s.url, status: null, msg: `persist: ${String(err)}` });
      result.status = 'partial';
    }
  }

  // Capture detail records for seen listings (fetch + parse only, no persist)
  for (const s of seenStubs) {
    let json: unknown;
    try {
      json = await deps.fetchAdvert(s.id);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url: s.url, status: null, msg: String(err) });
      result.status = 'partial';
      continue;
    }

    let parsed: ParsedDetail;
    const parseStart = Date.now();
    try {
      parsed = deps.parseDetail(s.id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue; // delisted between index and detail — not an error
      record(result, { url: s.url, status: null, msg: `parseDetail: ${String(err)}` });
      result.status = 'partial';
      continue;
    }
    const parseMs = Date.now() - parseStart;

    // Capture detail info for seen listing
    const jsonBytes = JSON.stringify(json).length;
    const detailRecord = {
      id: s.id,
      url: s.url,
      status: 200,
      bytes: jsonBytes,
      parseMs,
      action: 'updated' as const,
      priceEur: parsed.priceEur ?? null,
    };
    result.detailsDetail.push(detailRecord);
  }
}

// Re-fetches up to `deps.backfillPerSweep` listings whose filterValuesEnrichedAt
// is NULL (legacy rows from before the schema enrichment landed). Each call goes
// through the same fetch+parse+persist path as a new-listing detail, so it
// respects the politeness budget and adds nothing new to the request shape.
async function backfillUnenriched(deps: SweepDeps, result: SweepResult): Promise<void> {
  const limit = deps.backfillPerSweep ?? 0;
  if (limit <= 0) return;
  const ids = await deps.persist.findUnenrichedListings(limit);
  for (const id of ids) {
    const url = `<backfill:${id}>`;
    let json: unknown;
    try {
      json = await deps.fetchAdvert(id);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url, status: null, msg: String(err) });
      result.status = 'partial';
      continue;
    }
    result.detailsFetched += 1;

    let parsed: ParsedDetail;
    try {
      parsed = deps.parseDetail(id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue;
      record(result, { url, status: null, msg: `parseDetail: ${String(err)}` });
      result.status = 'partial';
      continue;
    }

    try {
      await deps.persist.persistDetail(parsed);
    } catch (err) {
      record(result, { url, status: null, msg: `persist: ${String(err)}` });
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
    configSnapshot: null,
    pagesDetail: [],
    detailsDetail: [],
    eventLog: null,
  };
}
