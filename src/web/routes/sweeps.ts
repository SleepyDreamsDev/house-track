import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';

export function registerSweepsRoutes(app: Hono, prisma: PrismaClient): void {
  app.get('/api/sweeps', async (c) => {
    const limit = parseInt(c.req.query('limit') || '20');
    const sweeps = await prisma.sweepRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    const result = sweeps.map((s) => ({
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      finishedAt: s.finishedAt?.toISOString() || null,
      status: s.status,
      pagesFetched: s.pagesFetched,
      detailsFetched: s.detailsFetched,
      newListings: s.newListings,
      updatedListings: s.updatedListings,
      errorCount: Array.isArray(s.errors) ? (s.errors as unknown[]).length : 0,
      durationMs: s.finishedAt ? s.finishedAt.getTime() - s.startedAt.getTime() : null,
    }));

    return c.json(result);
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
      status: sweep.status,
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
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          source: '999.md',
          trigger: 'manual',
        },
      });

      return c.json(
        {
          id: sweep.id,
          startedAt: sweep.startedAt.toISOString(),
        },
        201,
      );
    } catch (error) {
      console.error('Error creating sweep:', error);
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

      await prisma.sweepRun.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      return c.json({ id, status: 'cancelled' });
    } catch (error) {
      console.error('Error cancelling sweep:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });
}
