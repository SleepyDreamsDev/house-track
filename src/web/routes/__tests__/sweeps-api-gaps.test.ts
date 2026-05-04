import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

describe('Sweep API gaps', () => {
  let prisma: PrismaClient;
  let app: Hono;

  beforeAll(async () => {
    prisma = getPrisma();
    app = createApiApp();
  });

  beforeEach(async () => {
    await prisma.sweepRun.deleteMany();
  });

  describe('POST /api/sweeps triggers a manual sweep', () => {
    it('returns 201 with id and startedAt', async () => {
      const res = await app.request('/api/sweeps', { method: 'POST' });
      expect(res.status).toBe(201);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('startedAt');
      expect(typeof body.id).toBe('number');
      expect(typeof body.startedAt).toBe('string');

      // Verify valid ISO timestamp
      expect(() => new Date(body.startedAt as string)).not.toThrow();
    });

    it('creates a new SweepRun in database', async () => {
      const before = await prisma.sweepRun.count();
      const res = await app.request('/api/sweeps', { method: 'POST' });
      expect(res.status).toBe(201);

      const after = await prisma.sweepRun.count();
      expect(after).toBe(before + 1);
    });

    it('sets source and trigger columns on created SweepRun', async () => {
      const res = await app.request('/api/sweeps', { method: 'POST' });
      const body = (await res.json()) as Record<string, unknown>;
      const id = body.id as number;

      const sweep = await prisma.sweepRun.findUnique({ where: { id } });
      expect(sweep).not.toBeNull();
      expect(sweep?.source).toBe('999.md');
      expect(sweep?.trigger).toBe('manual');
    });
  });

  describe('POST /api/sweeps/:id/cancel aborts an active sweep', () => {
    it('returns 404 when sweep does not exist', async () => {
      const res = await app.request('/api/sweeps/99999/cancel', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 200 when sweep exists', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}/cancel`, { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('sets status to cancelled on existing sweep', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
        },
      });

      await app.request(`/api/sweeps/${sweep.id}/cancel`, { method: 'POST' });

      const updated = await prisma.sweepRun.findUnique({ where: { id: sweep.id } });
      expect(updated?.status).toBe('cancelled');
    });
  });

  describe('SweepRun schema includes source and trigger columns', () => {
    it('SweepRun.source exists and defaults to 999.md', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          // Do not set source; it should default
        },
      });

      expect(sweep.source).toBe('999.md');
    });

    it('SweepRun.trigger exists and defaults to cron', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          // Do not set trigger; it should default
        },
      });

      expect(sweep.trigger).toBe('cron');
    });

    it('SweepRun.source can be set to manual', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          source: '999.md',
          trigger: 'manual',
        },
      });

      expect(sweep.source).toBe('999.md');
      expect(sweep.trigger).toBe('manual');
    });
  });

  describe('GET /api/sweeps includes durationMs in list response', () => {
    it('includes durationMs for finished sweeps', async () => {
      const now = new Date();
      const finishedAt = new Date(now.getTime() + 5000);

      await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: now,
          finishedAt,
        },
      });

      const res = await app.request('/api/sweeps');
      expect(res.status).toBe(200);

      const sweeps = (await res.json()) as Record<string, unknown>[];
      expect(sweeps.length).toBeGreaterThan(0);
      expect(sweeps[0]).toHaveProperty('durationMs');
      const durationMs = (sweeps[0] as Record<string, unknown>).durationMs as number;
      expect(typeof durationMs).toBe('number');
      expect(durationMs).toBeGreaterThan(0);
      expect(Math.abs(durationMs - 5000)).toBeLessThan(100); // Allow 100ms tolerance
    });

    it('includes durationMs as null for running sweeps', async () => {
      await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: new Date(),
          finishedAt: null,
        },
      });

      const res = await app.request('/api/sweeps');
      expect(res.status).toBe(200);

      const sweeps = (await res.json()) as Record<string, unknown>[];
      expect(sweeps.length).toBeGreaterThan(0);
      expect(sweeps[0]).toHaveProperty('durationMs');
      expect((sweeps[0] as Record<string, unknown>).durationMs).toBeNull();
    });
  });

  describe('GET /api/sweeps/:id returns structured progress shape', () => {
    it('returns progress with phase, pagesDone, pagesTotal, queued for finished sweep', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: new Date(),
          finishedAt: new Date(),
          pagesFetched: 10,
          pagesDetail: JSON.stringify([
            { page: 1, status: 200 },
            { page: 2, status: 200 },
          ]),
          detailsDetail: JSON.stringify([
            { id: '1', status: 200 },
            { id: '2', status: 200 },
            { id: '3', status: 200 },
          ]),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('progress');
      const progress = body.progress as Record<string, unknown>;
      expect(progress).toHaveProperty('phase');
      expect(progress).toHaveProperty('pagesDone');
      expect(progress).toHaveProperty('pagesTotal');
      expect(progress).toHaveProperty('queued');
    });

    it('returns currentlyFetching as null for finished sweeps', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('currentlyFetching');
      expect(body.currentlyFetching).toBeNull();
    });

    it('maps sweep status to progress phase', async () => {
      const statuses = ['ok', 'partial', 'failed', 'circuit_open'];

      for (const status of statuses) {
        await prisma.sweepRun.deleteMany();
        const sweep = await prisma.sweepRun.create({
          data: {
            status,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        });

        const res = await app.request(`/api/sweeps/${sweep.id}`);
        const body = (await res.json()) as Record<string, unknown>;
        const progress = body.progress as Record<string, unknown>;
        expect(progress.phase).toBe(status);
      }
    });
  });

  describe('integration: manual trigger + source/trigger + cancel', () => {
    it('POST /api/sweeps creates sweep row with source/trigger columns set', async () => {
      const createRes = await app.request('/api/sweeps', { method: 'POST' });
      expect(createRes.status).toBe(201);

      const created = (await createRes.json()) as Record<string, unknown>;
      const sweepId = created.id as number;

      // Verify source/trigger were set on the created row
      const sweep = await prisma.sweepRun.findUnique({ where: { id: sweepId } });
      expect(sweep?.source).toBe('999.md');
      expect(sweep?.trigger).toBe('manual');
      expect(sweep?.status).toBe('in_progress');
    });

    it('POST /api/sweeps/:id/cancel marks an in-progress (non-running) sweep as cancelled', async () => {
      // Manually create a sweep marked as in_progress (simulates API startup but before actual sweep starts)
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'in_progress',
          source: '999.md',
          trigger: 'manual',
        },
      });

      const cancelRes = await app.request(`/api/sweeps/${sweep.id}/cancel`, { method: 'POST' });
      expect(cancelRes.status).toBe(200);

      const updated = await prisma.sweepRun.findUnique({ where: { id: sweep.id } });
      expect(updated?.status).toBe('cancelled');
      expect(updated?.finishedAt).not.toBeNull();
    });
  });
});
