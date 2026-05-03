// GET /api/sweeps/:id/stream — Server-Sent Events for a running sweep.
// Streams JSON-encoded SweepEvent rows as they happen.
//
// STATUS: skeleton that subscribes to the sweepEvents emitter. Once Task 2
// has the crawler emitting onto sweepEvents, this works end-to-end with no
// further changes.

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { sweepEvents, type SweepEvent } from '../events.js';

export const sweepStreamRouter = new Hono();

sweepStreamRouter.get('/sweeps/:id/stream', (c) => {
  const id = c.req.param('id');

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no'); // disable nginx proxy buffering

  return stream(c, async (s) => {
    let alive = true;
    s.onAbort(() => {
      alive = false;
    });

    // Initial comment to flush headers immediately.
    await s.write(`: connected to ${id}\n\n`);

    const off = sweepEvents.onEvent(async (ev: SweepEvent) => {
      if (!alive || ev.sweepId !== id) return;
      const { sweepId: _sweepId, ...payload } = ev;
      await s.write(`data: ${JSON.stringify(payload)}\n\n`);
    });

    // Heartbeat every 15s so proxies don't drop the connection.
    const hb = setInterval(() => {
      if (alive) s.write(`: ping\n\n`).catch(() => {});
    }, 15_000);

    // Hold the connection open until aborted.
    while (alive) await new Promise((r) => setTimeout(r, 1000));

    clearInterval(hb);
    off();
  });
});
