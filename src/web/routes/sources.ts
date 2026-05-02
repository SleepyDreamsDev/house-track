import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';

export function registerSourcesRoutes(app: Hono, prisma: PrismaClient): void {
  app.get('/api/sources', async (c) => {
    const sources = await prisma.source.findMany();
    const result = sources.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      baseUrl: s.baseUrl,
      adapterKey: s.adapterKey,
      enabled: s.enabled,
      politenessOverridesJson: s.politenessOverridesJson,
      filterOverridesJson: s.filterOverridesJson,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
    return c.json(result);
  });

  app.patch('/api/sources/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    const body = await c.req.json<{
      enabled?: boolean;
      politenessOverridesJson?: unknown;
      filterOverridesJson?: unknown;
    }>();

    try {
      const updateData: Record<string, unknown> = {};
      if (body.enabled !== undefined) {
        updateData.enabled = body.enabled;
      }
      if (body.politenessOverridesJson !== undefined) {
        updateData.politenessOverridesJson = body.politenessOverridesJson;
      }
      if (body.filterOverridesJson !== undefined) {
        updateData.filterOverridesJson = body.filterOverridesJson;
      }

      const updated = await prisma.source.update({
        where: { id },
        data: updateData,
      });

      return c.json({
        id: updated.id,
        slug: updated.slug,
        enabled: updated.enabled,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('not found') || error.message.includes('No Source'))
      ) {
        return c.json({ error: 'Source not found' }, 404);
      }
      console.error('Error updating source:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });
}
