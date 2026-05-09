// Test helper: redirect CIRCUIT.sentinelPath to a per-test tmpdir.
//
// Route tests can't inject Circuit deps without refactoring buildDeps,
// so they reach into the global CIRCUIT object and swap the path. Doing
// that requires a type assertion (CIRCUIT is `as const`), and forgetting
// to restore the original on teardown leaks state across tests.
//
// Usage:
//   import { useTempCircuitSentinel } from '../../../__tests__/helpers/circuit-sentinel.js';
//
//   describe('my route', () => {
//     const sentinel = useTempCircuitSentinel();
//
//     it('handles open breaker', () => {
//       sentinel.tripBreaker();
//       // ...route hits sentinel.path — circuit reads as open
//     });
//   });

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { CIRCUIT } from '../../config.js';

export interface TempCircuitSentinel {
  /** Current per-test sentinel path. Stable for the duration of one `it()`. */
  readonly path: string;
  /** Touch the sentinel file so Circuit.isOpen() returns true. */
  tripBreaker(): void;
}

export function useTempCircuitSentinel(): TempCircuitSentinel {
  let dir = '';
  let originalSentinel = '';
  const handle: TempCircuitSentinel = {
    get path(): string {
      return join(dir, '.circuit_open');
    },
    tripBreaker(): void {
      writeFileSync(this.path, '');
    },
  };

  beforeAll(() => {
    originalSentinel = CIRCUIT.sentinelPath;
  });

  afterAll(() => {
    (CIRCUIT as { sentinelPath: string }).sentinelPath = originalSentinel;
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'circuit-sentinel-'));
    (CIRCUIT as { sentinelPath: string }).sentinelPath = handle.path;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return handle;
}
