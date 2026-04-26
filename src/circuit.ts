// Circuit breaker — sentinel-file based.
//
// Source: docs/poc-spec.md §"Politeness budget" + §"Failure handling":
//   3 consecutive 4xx (excluding 404) → 24h pause.
//   Manual clear by deleting `data/.circuit_open`.

/**
 * TODO(scaffold): implement.
 *
 * Suggested API (subject to change as we wire `src/index.ts`):
 *
 *   isOpen()        : Promise<boolean>   — true if sentinel exists AND its
 *                                          mtime is within the pause window
 *   recordFailure() : Promise<void>      — bumps the in-process counter;
 *                                          when it hits the threshold, writes
 *                                          the sentinel file
 *   recordSuccess() : void               — resets the in-process counter
 *
 * Notes:
 *  - The counter is process-local on purpose. The breaker is meant to stop
 *    THIS sweep's run; the sentinel file is what carries state between cron
 *    ticks.
 *  - The sentinel path comes from `CIRCUIT.sentinelPath` in `src/config.ts`.
 *  - When `isOpen()` returns true, write a SweepRun row with
 *    `status='circuit_open'` and exit (spec step 1 of crawl flow).
 */

export class Circuit {
  // TODO(scaffold)
}
