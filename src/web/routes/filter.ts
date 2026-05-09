import type { Hono } from 'hono';
import { z } from 'zod';

import { resolveActiveFilter } from '../../filter-resolver.js';
import { ACTIVE_SOURCE_SLUG, listSources } from '../../sources/index.js';
import { UnknownGenericFilterValueError } from '../../sources/types.js';
import { genericFilterSchema } from '../../types/filter.js';
import { setSetting } from '../../settings.js';

export function registerFilterRoutes(app: Hono): void {
  app.get('/api/filter', async (c) => {
    const resolved = await resolveActiveFilter();
    return c.json({
      generic: resolved.generic,
      sources: listSources().map((s) => ({
        slug: s.slug,
        name: s.name,
        active: s.slug === resolved.sourceSlug,
      })),
      resolved: {
        searchInput: resolved.searchInput,
        postFilter: resolved.postFilter,
      },
      sourceSlug: resolved.sourceSlug,
    });
  });

  app.put('/api/filter', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = genericFilterSchema.safeParse((body as { generic?: unknown })?.generic ?? body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => ({
        path: i.path.join('.') || (i.path[0] as string | undefined) || '',
        message: i.message,
      }));
      return c.json({ error: 'Validation failed', details }, 400);
    }

    try {
      await setSetting('filter.generic', parsed.data);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const details = err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        return c.json({ error: 'Validation failed', details }, 400);
      }
      throw err;
    }

    let resolved;
    try {
      resolved = await resolveActiveFilter();
    } catch (err) {
      if (err instanceof UnknownGenericFilterValueError) {
        return c.json(
          {
            error: `Unknown ${err.field} value "${err.value}" — not in source mapping`,
            details: [{ path: err.field, message: err.message, value: err.value }],
          },
          400,
        );
      }
      throw err;
    }

    return c.json({
      generic: resolved.generic,
      sources: listSources().map((s) => ({
        slug: s.slug,
        name: s.name,
        active: s.slug === resolved.sourceSlug,
      })),
      resolved: {
        searchInput: resolved.searchInput,
        postFilter: resolved.postFilter,
      },
      sourceSlug: resolved.sourceSlug,
    });
  });

  app.get('/api/filter/sources', (c) => {
    return c.json(
      listSources().map((s) => ({
        slug: s.slug,
        name: s.name,
        active: s.slug === ACTIVE_SOURCE_SLUG,
      })),
    );
  });
}
