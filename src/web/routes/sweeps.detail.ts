// GET /api/sweeps/:id — full sweep detail including pages/details/errors/config
//
// STATUS: stub returning realistic shape so the UI can render today.
// TODO (Claude Code, Task 1): replace stub with Prisma read. After the
// migration runs, fields are: SweepRun + JSON columns
//   configSnapshot, pagesDetail, detailsDetail, eventLog
//
// Hono handler — adapt the import if the project uses Express.

import { Hono } from 'hono';
// import { prisma } from '../../db.js';

export const sweepDetailRouter = new Hono();

sweepDetailRouter.get('/sweeps/:id', async (c) => {
  const id = c.req.param('id');

  // ------------------------- REAL IMPL (uncomment after Task 1) -------------
  // const run = await prisma.sweepRun.findUnique({ where: { id } });
  // if (!run) return c.json({ error: 'not found' }, 404);
  // return c.json({
  //   id: run.id,
  //   status: run.status,
  //   startedAt: run.startedAt.toISOString(),
  //   finishedAt: run.finishedAt?.toISOString(),
  //   source: run.source,
  //   trigger: run.trigger,
  //   config: run.configSnapshot ?? {},
  //   summary: run.status !== 'running' ? {
  //     pagesFetched: run.pagesFetched,
  //     detailsFetched: run.detailsFetched,
  //     newListings: run.newListings,
  //     updatedListings: run.updatedListings,
  //     errors: run.errorCount,
  //     durationMs: run.durationMs,
  //   } : undefined,
  //   pages: run.pagesDetail ?? [],
  //   details: run.detailsDetail ?? [],
  //   errors: [], // TODO derive from eventLog where lvl=error
  //   logTail: run.eventLog ?? [],
  // });

  // ------------------------- STUB (remove after Task 1) ---------------------
  return c.json({
    id,
    status: 'success',
    startedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    finishedAt: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
    source: '999.md',
    trigger: 'cron',
    config: {
      'politeness.baseDelayMs': 2000,
      'politeness.jitterMs': 500,
      'sweep.maxPagesPerSweep': 5,
      'filter.maxPriceEur': 250000,
    },
    summary: {
      pagesFetched: 5,
      detailsFetched: 32,
      newListings: 4,
      updatedListings: 7,
      errors: 0,
      durationMs: 124000,
    },
    pages: [
      {
        n: 1,
        url: '/ro/cat/case-de-vinzare-1156/?o_2_678=1156',
        status: 200,
        bytes: 86_200,
        parseMs: 38,
        found: 30,
        took: 2_400,
      },
      {
        n: 2,
        url: '/ro/cat/case-de-vinzare-1156/?o_2_678=1156&page=2',
        status: 200,
        bytes: 84_500,
        parseMs: 41,
        found: 30,
        took: 2_300,
      },
    ],
    details: [
      {
        id: 'h-91445',
        url: '/ro/91445',
        status: 200,
        bytes: 22_800,
        parseMs: 18,
        action: 'new',
        priceEur: 145000,
      },
      {
        id: 'h-91421',
        url: '/ro/91421',
        status: 200,
        bytes: 24_100,
        parseMs: 19,
        action: 'updated',
        priceEur: 168000,
      },
    ],
    errors: [],
    logTail: [
      { t: '14:02:11', lvl: 'info', msg: 'sweep.start', meta: 'source=999.md trigger=cron' },
      { t: '14:02:13', lvl: 'info', msg: 'page.fetch', meta: 'n=1 status=200' },
      { t: '14:04:15', lvl: 'info', msg: 'sweep.end', meta: 'new=4 updated=7' },
    ],
  });
});
