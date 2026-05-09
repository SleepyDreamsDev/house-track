// pino logger — JSON to stdout, captured by `docker logs` and rotated by the
// json-file driver (10MB × 5, configured in docker-compose.yml).
// Teed to EventEmitter for live SSE streaming during sweeps.
//
// Source: docs/poc-spec.md §"Logging".

import { Writable } from 'node:stream';
import pino from 'pino';

import { sweepEvents } from './web/events.js';
import { getActiveSweepId } from './sweep.js';

// Custom write stream that tees to both stdout and the sweepEvents EventEmitter.
const teeStream = new Writable({
  write(chunk, _, cb) {
    // Try to parse as JSON and emit to EventEmitter if a sweep is active
    // Do this before stdout write to avoid blocking on backpressure
    try {
      const line = JSON.parse(chunk.toString());
      const sweepId = getActiveSweepId();
      if (sweepId !== null) {
        // Map pino level (10-60) to string: 10→debug, 20→debug, 30→info, 40→warn, 50→error, 60→fatal
        const levelNum = line.level ?? 30;
        const levelMap: Record<number, 'debug' | 'info' | 'warn' | 'error' | 'fatal'> = {
          10: 'debug',
          20: 'debug',
          30: 'info',
          40: 'warn',
          50: 'error',
          60: 'fatal',
        };
        const lvl = levelMap[levelNum] || 'info';

        const date = new Date(line.time ?? Date.now());
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        const time = `${hh}:${mm}:${ss}`;

        sweepEvents.emitEvent({
          sweepId: String(sweepId),
          t: time,
          lvl,
          msg: line.event ?? line.msg ?? '',
          meta: line.meta ? JSON.stringify(line.meta) : JSON.stringify(line),
        });
      }
    } catch {
      // Non-JSON line or parse error — just skip EventEmitter emission
    }

    // Write to stdout and honor backpressure by passing callback
    process.stdout.write(chunk, cb);
  },
});

export const log = pino(
  {
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { service: 'house-track' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  teeStream,
);

export type Logger = typeof log;
