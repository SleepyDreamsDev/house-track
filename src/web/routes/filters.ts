import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { listFilters } from '../../mcp/queries.js';

export function registerFiltersRoutes(app: Hono, prisma: PrismaClient): void {
  app.get('/api/filters', async (c) => {
    const result = await listFilters(prisma);
    return c.json(result);
  });
}
