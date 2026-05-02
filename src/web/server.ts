import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { getPrisma } from '../db.js';
import { registerSweepsRoutes } from './routes/sweeps.js';
import { registerListingsRoutes } from './routes/listings.js';
import { registerFiltersRoutes } from './routes/filters.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSourcesRoutes } from './routes/sources.js';
import { registerCircuitRoutes } from './routes/circuit.js';

const app = new Hono();

export function createApiApp(): Hono {
  const prisma = getPrisma();

  registerSweepsRoutes(app, prisma);
  registerListingsRoutes(app, prisma);
  registerFiltersRoutes(app, prisma);
  registerSettingsRoutes(app);
  registerSourcesRoutes(app, prisma);
  registerCircuitRoutes(app);

  // Health check endpoint
  app.get('/api/health', (c) => {
    return c.json({ status: 'ok' });
  });

  return app;
}

// Start server when run directly
if (import.meta.main) {
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
