// Cron entrypoint — one sweep per tick (hourly in production).
//
// Source: docs/poc-spec.md §"Crawl flow (per sweep)".
//
// Flow:
//   1. Pre-flight — check circuit breaker. If open → log skip, exit.
//   2. Build index URLs from FILTER (page 1..N).
//   3. Fetch index pages sequentially with politeness delays.
//   4. parseIndex() each page → stubs.
//   5. diffAgainstDb() → { new, seen, gone }.
//   6. Fetch detail HTML for new ids only.
//   7. parseDetail() each detail.
//   8. persistDetail() + markSeen() + markInactive().
//   9. finishSweep().

import cron from 'node-cron';
import { log } from './log.js';

const SCHEDULE = process.env['CRON_SCHEDULE'] ?? '0 * * * *'; // every hour, on the hour

async function runSweep(): Promise<void> {
  log.info({ event: 'sweep.start' });
  // TODO(scaffold): orchestrate steps 1–9 from the spec.
  log.warn({ event: 'sweep.skipped', reason: 'not implemented' });
}

function bootstrap(): void {
  log.info({ event: 'crawler.boot', schedule: SCHEDULE });

  if (process.env['RUN_ONCE'] === '1') {
    void runSweep().then(() => process.exit(0));
    return;
  }

  cron.schedule(SCHEDULE, () => {
    void runSweep().catch((err: unknown) => {
      log.error({ event: 'sweep.unhandled', err });
    });
  });
}

bootstrap();
