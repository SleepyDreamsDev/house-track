import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { genericFilterSchema } from '../../types/filter.js';
import { positiveIntId } from '../params.js';

// Operator-supplied override blobs were previously stored verbatim as `unknown`.
// Validate them at the boundary so a future consumer can't inherit junk (or a
// `__proto__`-shaped payload). `.strict()` rejects unknown keys; both fields may
// be null to clear the override.
const politenessOverridesSchema = z
  .object({
    baseDelayMs: z.number().int().nonnegative(),
    jitterMs: z.number().int().nonnegative(),
    detailDelayMs: z.number().int().nonnegative(),
    retryBackoffsMs: z.array(z.number().int().nonnegative()),
    userAgent: z.string(),
    acceptLanguage: z.string(),
    accept: z.string(),
    acceptJson: z.string(),
    origin: z.string(),
    referer: z.string(),
  })
  .partial()
  .strict()
  .nullable();

const filterOverridesSchema = genericFilterSchema.nullable();

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
      placeholder: s.adapterKey !== '999md',
      politenessOverridesJson: s.politenessOverridesJson,
      filterOverridesJson: s.filterOverridesJson,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
    return c.json(result);
  });

  app.patch('/api/sources/:id', async (c) => {
    const id = positiveIntId(c.req.param('id'));
    if (id === null) {
      return c.json({ error: 'Invalid source id' }, 400);
    }
    const body = await c.req.json<{
      enabled?: unknown;
      politenessOverridesJson?: unknown;
      filterOverridesJson?: unknown;
    }>();

    try {
      const updateData: Record<string, unknown> = {};
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') {
          return c.json({ error: 'enabled must be a boolean' }, 400);
        }
        updateData.enabled = body.enabled;
      }
      if (body.politenessOverridesJson !== undefined) {
        const parsed = politenessOverridesSchema.safeParse(body.politenessOverridesJson);
        if (!parsed.success) {
          return c.json(
            { error: 'Invalid politenessOverridesJson', details: parsed.error.issues },
            400,
          );
        }
        updateData.politenessOverridesJson = parsed.data;
      }
      if (body.filterOverridesJson !== undefined) {
        const parsed = filterOverridesSchema.safeParse(body.filterOverridesJson);
        if (!parsed.success) {
          return c.json(
            { error: 'Invalid filterOverridesJson', details: parsed.error.issues },
            400,
          );
        }
        updateData.filterOverridesJson = parsed.data;
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
