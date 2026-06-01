// Spec reconciliation: executable assertions that pin the real-code contracts
// the SPEC-*.feature/SPEC-*.md drafts disagreed on. Each it() maps to a
// Scenario in the SPEC features and proves which spec variant is correct.
// DB-free by construction (no testcontainer needed): diffAgainstDb's empty
// branch returns before touching Prisma, and route shape is read off Hono's
// `app.routes` after registration with a stub client.

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { FILTER, SWEEP } from '../config.js';
import { Persistence } from '../persist.js';
import { registerCircuitRoutes } from '../web/routes/circuit.js';
import { registerFilterRoutes } from '../web/routes/filter.js';
import { registerFiltersRoutes } from '../web/routes/filters.js';
import { registerListingsRoutes } from '../web/routes/listings.js';

const stubPrisma = {} as never;

function buildRoutes(): Array<{ method: string; path: string }> {
  const app = new Hono();
  registerListingsRoutes(app, stubPrisma);
  registerFiltersRoutes(app, stubPrisma);
  registerFilterRoutes(app);
  registerCircuitRoutes(app);
  return app.routes.map((r) => ({ method: r.method, path: r.path }));
}

const has = (
  routes: Array<{ method: string; path: string }>,
  method: string,
  path: string,
): boolean => routes.some((r) => r.method === method && r.path === path);

describe('SPEC reconciliation — persistence layer', () => {
  it('Persistence is a class, not a module of free functions', () => {
    expect(typeof Persistence).toBe('function');
    expect(typeof Persistence.prototype.diffAgainstDb).toBe('function');
    expect(typeof Persistence.prototype.persistDetail).toBe('function');
  });

  it('diffAgainstDb returns { new, seen } and never a `gone` key', async () => {
    const persist = new Persistence(stubPrisma);
    const result = await persist.diffAgainstDb([]);
    expect(Object.keys(result).sort()).toEqual(['new', 'seen']);
    expect('gone' in result).toBe(false);
  });

  it('age-out lives in a separate markInactiveOlderThan(ageMs) method', () => {
    expect(typeof Persistence.prototype.markInactiveOlderThan).toBe('function');
    // single positional arg: the age threshold in ms
    expect(Persistence.prototype.markInactiveOlderThan.length).toBe(1);
  });

  it('persistDetail takes exactly one argument (the ParsedDetail), not three', () => {
    expect(Persistence.prototype.persistDetail.length).toBe(1);
  });
});

describe('SPEC reconciliation — sweep default settings', () => {
  it('default sweep knobs match config.ts (700/30/50/2/168h/legacy), not 100/5/10/24', () => {
    expect(FILTER.maxPagesPerSweep).toBe(50);
    expect(SWEEP.backfillPerSweep).toBe(30);
    expect(SWEEP.staleRefreshPerSweep).toBe(50);
    expect(SWEEP.targetListingsPerSweep).toBe(700);
    expect(SWEEP.expectedPerDay).toBe(2);
    expect(SWEEP.staleThresholdHours).toBe(168);
    expect(SWEEP.mode).toBe('legacy');
  });
});

describe('SPEC reconciliation — web API route shapes', () => {
  it('watchlist toggle is PUT /api/listings/:id/watchlist (not PATCH)', () => {
    const routes = buildRoutes();
    expect(has(routes, 'PUT', '/api/listings/:id/watchlist')).toBe(true);
    expect(has(routes, 'PATCH', '/api/listings/:id/watchlist')).toBe(false);
  });

  it('circuit reset is DELETE /api/circuit — no POST /api/circuit/reset exists', () => {
    const routes = buildRoutes();
    expect(has(routes, 'GET', '/api/circuit')).toBe(true);
    expect(has(routes, 'DELETE', '/api/circuit')).toBe(true);
    expect(routes.some((r) => r.path.includes('circuit/reset'))).toBe(false);
  });

  it('/api/filter (singular) and /api/filters (plural) are distinct endpoints', () => {
    const routes = buildRoutes();
    expect(has(routes, 'GET', '/api/filter')).toBe(true);
    expect(has(routes, 'PUT', '/api/filter')).toBe(true);
    expect(has(routes, 'GET', '/api/filters')).toBe(true);
  });
});
