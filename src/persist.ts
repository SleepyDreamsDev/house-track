// Persistence layer: Prisma upserts + snapshot diffing + sweep bookkeeping.
//
// Source: docs/poc-spec.md §"Crawl flow (per sweep)" steps 5, 8, 9.

import type { ListingStub, ParsedDetail, SweepError, SweepStatus } from './types.js';

/**
 * TODO(scaffold): instantiate `PrismaClient` once and reuse. Don't import
 * `@prisma/client` at module load if you want the parser/fetch tests to stay
 * fast — pass the client in from `src/index.ts`.
 */

/**
 * Diff parsed index stubs against the DB. See spec step 5:
 *   - new   : id not in DB
 *   - seen  : id exists, present in this sweep → bump `lastSeenAt`
 *   - gone  : id exists, active=true, missing for N consecutive sweeps → mark inactive
 */
export interface DiffResult {
  new: ListingStub[];
  seen: ListingStub[];
  gone: string[]; // ids
}

export async function diffAgainstDb(_stubs: ListingStub[]): Promise<DiffResult> {
  throw new Error('not implemented — see TODO in src/persist.ts');
}

/**
 * Upsert a fully parsed detail. Insert a `ListingSnapshot` only if `rawHtmlHash`
 * changed vs the latest snapshot — keeps the table from growing for unchanged
 * pages. (Spec step 8.)
 */
export async function persistDetail(_detail: ParsedDetail): Promise<void> {
  throw new Error('not implemented — see TODO in src/persist.ts');
}

/** Bump `lastSeenAt` for every stub that re-appeared in this sweep. */
export async function markSeen(_stubs: ListingStub[]): Promise<void> {
  throw new Error('not implemented — see TODO in src/persist.ts');
}

/** Flip `active=false` for ids missing for N consecutive sweeps. */
export async function markInactive(_ids: string[]): Promise<void> {
  throw new Error('not implemented — see TODO in src/persist.ts');
}

/** Open a SweepRun row at the start of a sweep. */
export async function startSweep(): Promise<{ id: number }> {
  throw new Error('not implemented — see TODO in src/persist.ts');
}

/** Close the SweepRun row with results. */
export async function finishSweep(
  _id: number,
  _result: {
    status: SweepStatus;
    pagesFetched: number;
    detailsFetched: number;
    newListings: number;
    updatedListings: number;
    errors: SweepError[];
  },
): Promise<void> {
  throw new Error('not implemented — see TODO in src/persist.ts');
}
