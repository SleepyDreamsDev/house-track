// pino logger — JSON to stdout, captured by `docker logs` and rotated by the
// json-file driver (10MB × 5, configured in docker-compose.yml).
//
// Source: docs/poc-spec.md §"Logging".

import pino from 'pino';

export const log = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: 'house-track' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof log;
