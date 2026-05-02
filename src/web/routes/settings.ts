import type { Hono } from 'hono';
import { listSettings, setSetting } from '../../settings.js';
import { z } from 'zod';

export function registerSettingsRoutes(app: Hono): void {
  app.get('/api/settings', async (c) => {
    try {
      const settings = await listSettings();
      const result = settings.map((s) => ({
        key: s.key,
        value: s.value,
        default: s.default,
      }));
      return c.json(result);
    } catch (error) {
      console.error('Error fetching settings:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.patch('/api/settings/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<{ value: unknown }>();

    try {
      await setSetting(key, body.value);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        return c.json({ error: 'Validation failed', details }, 400);
      }
      if (error instanceof Error && error.message.includes('Unknown setting key')) {
        return c.json({ error: 'Unknown setting key' }, 400);
      }
      console.error('Error setting:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });
}
