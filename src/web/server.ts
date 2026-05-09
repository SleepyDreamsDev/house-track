import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { getPrisma } from '../db.js';
import { registerSweepsRoutes } from './routes/sweeps.js';
import { registerListingsRoutes } from './routes/listings.js';
import { registerFiltersRoutes } from './routes/filters.js';
import { registerFilterRoutes } from './routes/filter.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSourcesRoutes } from './routes/sources.js';
import { registerCircuitRoutes } from './routes/circuit.js';
import { sweepDetailRouter } from './routes/sweeps.detail.js';
import { sweepStreamRouter } from './routes/sweeps.stream.js';
import { statsRouter } from './routes/stats.js';
import { listingsFeedRouter } from './routes/listings.feed.js';

const app = new Hono();

export function createApiApp(): Hono {
  const prisma = getPrisma();

  registerSweepsRoutes(app, prisma);

  // UI redesign Phase 0 (stub-backed): SweepDetail, SSE stream, Dashboard
  // stats/feeds. Real impls land in subsequent phases — see
  // .claude/plans/ui-redesign-port-kit.md. Order matters: register the
  // feed routers BEFORE the generic /api/listings/:id route so concrete
  // sub-paths (`new-today`, `price-drops`) win the prefix match.
  app.route('/api', sweepDetailRouter);
  app.route('/api', sweepStreamRouter);
  app.route('/api', statsRouter);
  app.route('/api', listingsFeedRouter);

  registerListingsRoutes(app, prisma);
  registerFiltersRoutes(app, prisma);
  registerFilterRoutes(app);
  registerSettingsRoutes(app);
  registerSourcesRoutes(app, prisma);
  registerCircuitRoutes(app);

  // Health check endpoint
  app.get('/api/health', (c) => {
    return c.json({ status: 'ok' });
  });

  return app;
}

// Start server when run directly. `import.meta.main` is Bun-only; Node 22
// needs the argv[1]-vs-module-URL comparison.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApiApp();
  const port = 3000;
  const host = '127.0.0.1';

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info) => {
      console.warn(`Server listening on http://${info.address}:${info.port}`);
    },
  );
}

export default app;
