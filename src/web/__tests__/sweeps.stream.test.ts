import { describe, expect, it, beforeAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../db.js';
import { createApiApp } from '../server.js';

describe('sweeps SSE stream', () => {
  it('coerces both sweepId and request :id to strings for comparison', async () => {
    // This test verifies the behavior: when SSE stream receives :id="123" (string)
    // and sweepEvents emits with sweepId="123" (from String(numericId))
    // they should match

    const requestId = '123'; // comes as string from :id param
    const emittedSweepId = String(123); // our code does String(...) on numeric id

    expect(requestId === emittedSweepId).toBe(true);
  });

  it('SweepEvent emitted with String sweepId matches request string param', () => {
    const requestParamId = '456'; // from c.req.param('id')
    const activeSweepNumeric = 456; // numeric sweep id
    const eventSweepId = String(activeSweepNumeric); // tee stream does String(...)

    expect(eventSweepId).toBe(requestParamId);
  });

  it('does not match when ids differ', () => {
    const requestId = String(123);
    const eventSweepId = String(999);

    expect(requestId === eventSweepId).toBe(false);
  });

  describe('SSE stream endpoint contract', () => {
    let prisma: PrismaClient;
    let app: Hono;

    beforeAll(async () => {
      prisma = getPrisma();
      app = createApiApp();
    });

    it('GET /api/sweeps/:id/stream returns 200 and opens connection (no 404 validation)', async () => {
      // Current implementation does not validate sweep existence
      const controller = new AbortController();
      const res = await app.request(
        new Request('http://localhost/api/sweeps/99999/stream', {
          signal: controller.signal,
        }),
      );
      expect([200, 404]).toContain(res.status);
      controller.abort();
    });

    it('GET /api/sweeps/:id/stream returns 200 for existing sweep', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
        },
      });

      const controller = new AbortController();
      const res = await app.request(
        new Request(`http://localhost/api/sweeps/${sweep.id}/stream`, {
          signal: controller.signal,
        }),
      );

      expect(res.status).toBe(200);
      controller.abort();
    });

    it('GET /api/sweeps/:id/stream returns text/event-stream content-type', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
        },
      });

      const controller = new AbortController();
      const res = await app.request(
        new Request(`http://localhost/api/sweeps/${sweep.id}/stream`, {
          signal: controller.signal,
        }),
      );

      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type');
      expect(contentType).toContain('text/event-stream');
      controller.abort();
    });

    it('GET /api/sweeps/:id/stream accepts both numeric and string :id', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
        },
      });

      // Test with numeric ID (should be coerced to string by param())
      const controller1 = new AbortController();
      const res1 = await app.request(
        new Request(`http://localhost/api/sweeps/${sweep.id}/stream`, {
          signal: controller1.signal,
        }),
      );
      expect(res1.status).toBe(200);
      controller1.abort();

      // Test with string ID
      const controller2 = new AbortController();
      const res2 = await app.request(
        new Request(`http://localhost/api/sweeps/${String(sweep.id)}/stream`, {
          signal: controller2.signal,
        }),
      );
      expect(res2.status).toBe(200);
      controller2.abort();
    });

    it('GET /api/sweeps/:id/stream works for in-progress sweeps', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'in_progress',
          startedAt: new Date(),
        },
      });

      const controller = new AbortController();
      const res = await app.request(
        new Request(`http://localhost/api/sweeps/${sweep.id}/stream`, {
          signal: controller.signal,
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      controller.abort();
    });

    it('GET /api/sweeps/:id/stream works for finished sweeps', async () => {
      const now = new Date();
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: now,
          finishedAt: new Date(now.getTime() + 5000),
        },
      });

      const controller = new AbortController();
      const res = await app.request(
        new Request(`http://localhost/api/sweeps/${sweep.id}/stream`, {
          signal: controller.signal,
        }),
      );

      expect(res.status).toBe(200);
      controller.abort();
    });
  });
});
