import type { Hono } from 'hono';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';

const CIRCUIT_SENTINEL = 'data/.circuit_open';

export function registerCircuitRoutes(app: Hono): void {
  app.get('/api/circuit', async (c) => {
    const open = existsSync(CIRCUIT_SENTINEL);
    let openedAt: string | null = null;

    if (open) {
      try {
        const stat = await fs.stat(CIRCUIT_SENTINEL);
        openedAt = stat.mtime.toISOString();
      } catch {
        // File may have been deleted between check and stat
      }
    }

    return c.json({
      open,
      openedAt,
      sentinelPath: CIRCUIT_SENTINEL,
    });
  });

  app.delete('/api/circuit', async (c) => {
    try {
      if (existsSync(CIRCUIT_SENTINEL)) {
        await fs.unlink(CIRCUIT_SENTINEL);
        return c.json({ success: true, message: 'Circuit breaker cleared' });
      }
      return c.json({ success: true, message: 'Circuit breaker was already closed' }, 200);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('ENOENT') || error.message.includes('no such file'))
      ) {
        return c.json({ success: true, message: 'Sentinel not found' }, 404);
      }
      return c.json({ error: 'Failed to clear circuit breaker' }, 500);
    }
  });
}
