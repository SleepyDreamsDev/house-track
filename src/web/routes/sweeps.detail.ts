// GET /api/sweeps/:id — full sweep detail including pages/details/errors/config
//
// STATUS: stub returning realistic shape so the UI can render today.
// TODO (Claude Code, Task 1): replace stub with Prisma read. After the
// migration runs, fields are: SweepRun + JSON columns
//   configSnapshot, pagesDetail, detailsDetail, eventLog
//
// Hono handler — adapt the import if the project uses Express.

import { Hono } from 'hono';
import { getPrisma } from '../../db.js';

export const sweepDetailRouter = new Hono();

sweepDetailRouter.get('/sweeps/:id', async (c) => {
  const idParam = c.req.param('id');
  const id = parseInt(idParam, 10);

  // Real implementation: fetch from database
  const prisma = getPrisma();
  const run = await prisma.sweepRun.findUnique({ where: { id } });
  if (!run) return c.json({ error: 'not found' }, 404);

  return c.json({
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString(),
    source: '999.md',
    trigger: 'cron',
    config: run.configSnapshot ?? {},
    summary: run.finishedAt
      ? {
          pagesFetched: run.pagesFetched,
          detailsFetched: run.detailsFetched,
          newListings: run.newListings,
          updatedListings: run.updatedListings,
          errors: Array.isArray(run.errors) ? run.errors.length : 0,
          durationMs: run.finishedAt.getTime() - run.startedAt.getTime(),
        }
      : undefined,
    pages: run.pagesDetail ?? [],
    details: run.detailsDetail ?? [],
    errors: Array.isArray(run.errors) ? run.errors : [],
    logTail: run.eventLog ?? [],
  });
});
