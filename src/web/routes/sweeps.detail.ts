// GET /api/sweeps/:id — full sweep detail including pages/details/errors/config.
// Powers the SweepDetail page's overview/HTTP/events/errors/config tabs.

import { Hono } from 'hono';
import { getPrisma } from '../../db.js';
import { getActiveSweepId, getCurrentlyFetching, getQueueDepth } from '../../sweep.js';
import { toUiStatus } from '../sweep-status.js';

export const sweepDetailRouter = new Hono();

sweepDetailRouter.get('/sweeps/:id', async (c) => {
  const idParam = c.req.param('id');
  const id = parseInt(idParam, 10);

  // Validate: id must be a positive integer
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid sweep ID' }, 400);
  }

  // Real implementation: fetch from database
  const prisma = getPrisma();
  const run = await prisma.sweepRun.findUnique({ where: { id } });
  if (!run) return c.json({ error: 'not found' }, 404);

  const pagesDetail = Array.isArray(run.pagesDetail) ? (run.pagesDetail as unknown[]) : [];
  const detailsDetail = Array.isArray(run.detailsDetail) ? (run.detailsDetail as unknown[]) : [];

  // Live counters: while a sweep is running we surface the incrementally-flushed
  // pagesFetched/detailsFetched/newListings/updatedListings as a "summary" too,
  // so the SweepDetail page renders progress in-flight (not just at completion).
  const liveSummary = {
    pagesFetched: run.pagesFetched,
    detailsFetched: run.detailsFetched,
    newListings: run.newListings,
    updatedListings: run.updatedListings,
    errors: Array.isArray(run.errors) ? run.errors.length : 0,
    durationMs: run.finishedAt
      ? run.finishedAt.getTime() - run.startedAt.getTime()
      : Date.now() - run.startedAt.getTime(),
  };

  return c.json({
    id: run.id,
    status: toUiStatus(run.status),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString(),
    source: run.source || '999.md',
    trigger: run.trigger || 'cron',
    config: run.configSnapshot ?? {},
    summary: liveSummary,
    pages: pagesDetail,
    details: detailsDetail,
    errors: Array.isArray(run.errors) ? run.errors : [],
    logTail: run.eventLog ?? [],
    progress: {
      phase: toUiStatus(run.status),
      pagesDone: pagesDetail.length,
      // pagesTotal = the cap this sweep was started with (smoke=1, full~8).
      // Falls back to pagesDone for legacy rows missing the snapshot key so
      // the bar still renders (just doesn't show "out of N" on old runs).
      pagesTotal:
        (run.configSnapshot && typeof run.configSnapshot === 'object'
          ? (run.configSnapshot as Record<string, unknown>)['sweep.maxPagesPerSweep']
          : null) ?? pagesDetail.length,
      detailsDone: run.detailsFetched,
      // detailsQueued reflects the in-memory queue depth only for the
      // currently-active sweep (process restart wipes it); finished or
      // post-restart rows fall back to 0.
      detailsQueued:
        run.status === 'in_progress' && getActiveSweepId() === run.id ? getQueueDepth() : 0,
      newCount: run.newListings,
      updatedCount: run.updatedListings,
      queued: 0, // legacy field kept for backward-compat with existing tests
    },
    // Only the truly-active sweep (in_progress AND matches in-memory state)
    // surfaces the current in-flight URL. After process restart the in-memory
    // state is gone even if the DB row is still in_progress, so we return null.
    currentlyFetching:
      run.status === 'in_progress' && getActiveSweepId() === run.id ? getCurrentlyFetching() : null,
  });
});
