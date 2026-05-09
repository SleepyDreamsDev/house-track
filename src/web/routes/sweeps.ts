import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { getSweepAbortControllers } from '../../sweep.js';
import { runSweep } from '../../sweep.js';
import { Circuit } from '../../circuit.js';
import { CIRCUIT, FILTER, GRAPHQL_ENDPOINT, POLITENESS, SWEEP } from '../../config.js';
import { Fetcher } from '../../fetch.js';
import {
  buildAdvertVariables,
  buildSearchVariables,
  GET_ADVERT_QUERY,
  SEARCH_ADS_QUERY,
} from '../../graphql.js';
import { log } from '../../log.js';
import { parseDetail } from '../../parse-detail.js';
import { applyPostFilter, parseIndex } from '../../parse-index.js';
import { Persistence } from '../../persist.js';
import { resolveActiveFilter } from '../../filter-resolver.js';
import { getSetting } from '../../settings.js';
import { runSmokeAssertions } from '../../smoke-assertions.js';
import type { SweepDeps } from '../../sweep.js';
import { toUiStatus } from '../sweep-status.js';

// Smoke test caps. Spec:
// docs/superpowers/specs/2026-05-09-operator-ui-smoke-test-design.md
const SMOKE_MAX_PAGES = 1;
const SMOKE_TARGET_LISTINGS = 3;

export function registerSweepsRoutes(app: Hono, prisma: PrismaClient): void {
  async function buildDeps(): Promise<SweepDeps> {
    const persist = new Persistence(prisma);
    const circuit = new Circuit({
      sentinelPath: CIRCUIT.sentinelPath,
      threshold: CIRCUIT.consecutiveFailureThreshold,
      pauseDurationMs: CIRCUIT.pauseDurationMs,
    });

    const baseDelayMs = await getSetting('politeness.baseDelayMs', POLITENESS.baseDelayMs);
    const jitterMs = await getSetting('politeness.jitterMs', POLITENESS.jitterMs);
    const detailDelayMs = await getSetting('politeness.detailDelayMs', POLITENESS.detailDelayMs);
    const maxPagesPerSweep = await getSetting('sweep.maxPagesPerSweep', FILTER.maxPagesPerSweep);
    const backfillPerSweep = await getSetting('sweep.backfillPerSweep', SWEEP.backfillPerSweep);
    const staleRefreshPerSweep = await getSetting(
      'sweep.staleRefreshPerSweep',
      SWEEP.staleRefreshPerSweep,
    );
    const targetMean = await getSetting(
      'sweep.targetListingsPerSweep',
      SWEEP.targetListingsPerSweep,
    );
    const targetJitter = await getSetting('sweep.targetListingsJitter', SWEEP.targetListingsJitter);
    const expectedPerDay = await getSetting('sweep.expectedPerDay', SWEEP.expectedPerDay);

    const targetListingsThisSweep =
      targetJitter > 0
        ? targetMean + Math.floor((Math.random() * 2 - 1) * targetJitter)
        : targetMean;
    const missingThresholdMs =
      SWEEP.missingSweepsBeforeInactive * (24 / expectedPerDay) * 60 * 60 * 1000;

    const fetcher = new Fetcher({
      circuit,
      config: {
        baseDelayMs,
        jitterMs,
        retryBackoffsMs: POLITENESS.retryBackoffsMs,
        userAgent: POLITENESS.userAgent,
        acceptLanguage: POLITENESS.acceptLanguage,
        accept: POLITENESS.accept,
        acceptJson: POLITENESS.acceptJson,
        origin: POLITENESS.origin,
        referer: POLITENESS.referer,
      },
    });

    const resolved = await resolveActiveFilter();
    const searchInputOverride = resolved.searchInput;
    const postFilterOverride = resolved.postFilter;

    return {
      fetchSearchPage: (pageIdx, signal) => {
        const opts = signal ? { signal } : {};
        return fetcher.fetchGraphQL(
          GRAPHQL_ENDPOINT,
          'SearchAds',
          buildSearchVariables(pageIdx, searchInputOverride),
          SEARCH_ADS_QUERY,
          opts,
        );
      },
      fetchAdvert: (id, signal) => {
        const opts = signal ? { delayMs: detailDelayMs, signal } : { delayMs: detailDelayMs };
        return fetcher.fetchGraphQL(
          GRAPHQL_ENDPOINT,
          'GetAdvert',
          buildAdvertVariables(id),
          GET_ADVERT_QUERY,
          opts,
        );
      },
      persist,
      circuit,
      parseIndex,
      parseDetail,
      applyPostFilter: (stubs) => applyPostFilter(stubs, postFilterOverride),
      maxPagesPerSweep,
      missingThresholdMs,
      backfillPerSweep,
      staleRefreshPerSweep,
      targetListingsThisSweep,
      log,
    };
  }
  app.get('/api/sweeps', async (c) => {
    const limit = parseInt(c.req.query('limit') || '20');
    const offsetRaw = c.req.query('offset');
    const offset = offsetRaw ? Math.max(0, parseInt(offsetRaw)) : 0;

    const [sweeps, total] = await Promise.all([
      prisma.sweepRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.sweepRun.count(),
    ]);

    const result = sweeps.map((s) => ({
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      finishedAt: s.finishedAt?.toISOString() || null,
      status: toUiStatus(s.status),
      trigger: s.trigger,
      pagesFetched: s.pagesFetched,
      detailsFetched: s.detailsFetched,
      newListings: s.newListings,
      updatedListings: s.updatedListings,
      errorCount: Array.isArray(s.errors) ? (s.errors as unknown[]).length : 0,
      // Always compute durationMs as elapsed time (now - startedAt for running, finishedAt - startedAt for finished)
      durationMs: s.finishedAt
        ? s.finishedAt.getTime() - s.startedAt.getTime()
        : Date.now() - s.startedAt.getTime(),
    }));

    return c.json({ sweeps: result, total, limit, offset });
  });

  app.get('/api/sweeps/latest', async (c) => {
    const sweep = await prisma.sweepRun.findFirst({
      orderBy: { startedAt: 'desc' },
    });

    if (!sweep) {
      return c.json({ error: 'No sweeps found' }, 404);
    }

    return c.json({
      id: sweep.id,
      startedAt: sweep.startedAt.toISOString(),
      finishedAt: sweep.finishedAt?.toISOString() || null,
      status: toUiStatus(sweep.status),
      pagesFetched: sweep.pagesFetched,
      detailsFetched: sweep.detailsFetched,
      newListings: sweep.newListings,
      updatedListings: sweep.updatedListings,
    });
  });

  app.get('/api/sweeps/:id/errors', async (c) => {
    try {
      const id = parseInt(c.req.param('id'));
      const sweep = await prisma.sweepRun.findUnique({ where: { id } });

      if (!sweep) {
        return c.json({ error: 'Sweep not found' }, 404);
      }

      const errors = Array.isArray(sweep.errors) ? sweep.errors : [];
      return c.json(errors);
    } catch (error) {
      console.error('Error fetching sweep errors:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.post('/api/sweeps', async (c) => {
    try {
      const deps = await buildDeps();

      // startSweep creates with status:'in_progress' (correct state before work starts)
      const sweep = await deps.persist.startSweep({ source: '999.md', trigger: 'manual' });

      // Launch runSweep non-blocking with the pre-created sweep ID
      void (async () => {
        try {
          await runSweep(deps, sweep.id);
        } catch (err) {
          console.error('Error in non-blocking runSweep:', err);
        }
      })();

      return c.json(
        {
          id: sweep.id,
          startedAt: sweep.startedAt.toISOString(),
        },
        201,
      );
    } catch (error) {
      console.error('Error triggering sweep:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.post('/api/sweeps/smoke', async (c) => {
    try {
      const deps = await buildDeps();

      // Defense-in-depth: refuse if breaker is open. UI also disables the
      // button, but a stale UI state shouldn't be able to hammer 999.md.
      if (await deps.circuit.isOpen()) {
        return c.json({ error: 'circuit_open' }, 409);
      }

      const smokeDeps: SweepDeps = {
        ...deps,
        maxPagesPerSweep: SMOKE_MAX_PAGES,
        targetListingsThisSweep: SMOKE_TARGET_LISTINGS,
        backfillPerSweep: 0,
        staleRefreshPerSweep: 0,
      };

      const sweep = await deps.persist.startSweep({ source: '999.md', trigger: 'smoke' });

      // Non-blocking: returns the sweep id immediately so the UI can
      // navigate to /sweeps/:id and live-track via SSE (same UX as the
      // full Run-sweep-now flow). Assertions are computed lazily by
      // GET /api/sweeps/:id/smoke-assertions once the sweep is done.
      void (async () => {
        try {
          await runSweep(smokeDeps, sweep.id);
        } catch (err) {
          console.error('Error in smoke runSweep:', err);
        }
      })();

      return c.json(
        {
          id: sweep.id,
          startedAt: sweep.startedAt.toISOString(),
        },
        201,
      );
    } catch (error) {
      console.error('Error running smoke:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // On-demand smoke assertions for a finished smoke sweep. Used by
  // SweepDetail to render the pass/fail panel for trigger='smoke' rows.
  // Re-runs the same DB queries the synchronous /smoke endpoint used to
  // run inline; cheap enough to compute on each request.
  app.get('/api/sweeps/:id/smoke-assertions', async (c) => {
    try {
      const id = parseInt(c.req.param('id'));
      const sweep = await prisma.sweepRun.findUnique({ where: { id } });
      if (!sweep) return c.json({ error: 'Sweep not found' }, 404);
      if (sweep.trigger !== 'smoke') {
        return c.json({ error: 'Not a smoke sweep' }, 409);
      }
      if (!sweep.finishedAt) {
        return c.json({ pending: true, sweepId: id });
      }
      const since = new Date(sweep.startedAt.getTime() - 1000);
      const assertions = await runSmokeAssertions(prisma, since, { minListingsTouched: 1 });
      const passed = assertions.every((a) => a.ok);
      const durationMs = sweep.finishedAt.getTime() - sweep.startedAt.getTime();
      return c.json({ sweepId: id, durationMs, passed, assertions });
    } catch (error) {
      console.error('Error computing smoke assertions:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.post('/api/sweeps/:id/cancel', async (c) => {
    try {
      const id = parseInt(c.req.param('id'));
      const sweep = await prisma.sweepRun.findUnique({ where: { id } });

      if (!sweep) {
        return c.json({ error: 'Sweep not found' }, 404);
      }

      // Only allow cancelling if sweep is still running
      if (sweep.status !== 'in_progress') {
        return c.json({ error: 'Can only cancel running sweeps' }, 409);
      }

      // If there's an active AbortController for this sweep, signal abort
      // The sweep will finish with 'cancelled' status in its finally block
      const controllers = getSweepAbortControllers();
      const controller = controllers.get(id);
      if (controller) {
        controller.abort();
      } else {
        // If sweep is marked running but not active, mark as cancelled now
        await prisma.sweepRun.update({
          where: { id },
          data: { status: 'cancelled', finishedAt: new Date() },
        });
      }

      return c.json({ id, status: 'cancelled' });
    } catch (error) {
      console.error('Error cancelling sweep:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });
}
