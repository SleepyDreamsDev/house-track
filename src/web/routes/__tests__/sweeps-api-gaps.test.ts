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
          status: 'in_progress',
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}/cancel`, { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('sets status to cancelled on existing sweep', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'in_progress',
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

      const body = (await res.json()) as {
        sweeps: Record<string, unknown>[];
        total: number;
      };
      const sweeps = body.sweeps;
      expect(sweeps.length).toBeGreaterThan(0);
      expect(sweeps[0]).toHaveProperty('durationMs');
      const durationMs = (sweeps[0] as Record<string, unknown>).durationMs as number;
      expect(typeof durationMs).toBe('number');
      expect(durationMs).toBeGreaterThan(0);
      expect(Math.abs(durationMs - 5000)).toBeLessThan(100); // Allow 100ms tolerance
    });

    it('includes elapsed durationMs for running sweeps', async () => {
      await prisma.sweepRun.create({
        data: {
          status: 'in_progress',
          startedAt: new Date(),
          finishedAt: null,
        },
      });

      const res = await app.request('/api/sweeps');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        sweeps: Record<string, unknown>[];
        total: number;
      };
      const sweeps = body.sweeps;
      expect(sweeps.length).toBeGreaterThan(0);
      expect(sweeps[0]).toHaveProperty('durationMs');
      const durationMs = (sweeps[0] as Record<string, unknown>).durationMs;
      expect(typeof durationMs).toBe('number');
      expect(durationMs as number).toBeGreaterThanOrEqual(0);
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

    it('maps sweep status to progress phase (translated to UI)', async () => {
      // toUiStatus collapses partial/failed/circuit_open → 'failed' and ok → 'success'.
      const cases: Array<[string, string]> = [
        ['ok', 'success'],
        ['partial', 'failed'],
        ['failed', 'failed'],
        ['circuit_open', 'failed'],
      ];

      for (const [dbStatus, uiPhase] of cases) {
        await prisma.sweepRun.deleteMany();
        const sweep = await prisma.sweepRun.create({
          data: {
            status: dbStatus,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        });

        const res = await app.request(`/api/sweeps/${sweep.id}`);
        const body = (await res.json()) as Record<string, unknown>;
        const progress = body.progress as Record<string, unknown>;
        expect(progress.phase).toBe(uiPhase);
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

  describe('SweepRun JSON columns contract', () => {
    it('SweepRun can store configSnapshot as JSON', async () => {
      const configData = {
        politeness: { baseDelayMs: 8000, jitterMs: 2000 },
        filter: { maxAreaSqm: 500, minPriceEur: 10000 },
      };

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: new Date(),
          finishedAt: new Date(),
          configSnapshot: configData,
        },
      });

      const retrieved = await prisma.sweepRun.findUnique({ where: { id: sweep.id } });
      expect(retrieved?.configSnapshot).toEqual(configData);
      expect(typeof retrieved?.configSnapshot).toBe('object');
    });

    it('SweepRun can store pagesDetail as JSON array', async () => {
      const pagesDetail = [
        {
          page: 1,
          url: 'search-page-1',
          status: 200,
          bytes: 125000,
          parseMs: 45,
          found: 50,
          took: 1234,
        },
        {
          page: 2,
          url: 'search-page-2',
          status: 200,
          bytes: 128000,
          parseMs: 48,
          found: 52,
          took: 1256,
        },
      ];

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          pagesDetail,
        },
      });

      const retrieved = await prisma.sweepRun.findUnique({ where: { id: sweep.id } });
      expect(retrieved?.pagesDetail).toEqual(pagesDetail);
      expect(Array.isArray(retrieved?.pagesDetail)).toBe(true);
      expect((retrieved?.pagesDetail as unknown[])?.length).toBe(2);
    });

    it('SweepRun can store detailsDetail as JSON array', async () => {
      const detailsDetail = [
        {
          id: 'h-123',
          url: 'https://999.md/ro/123',
          status: 200,
          bytes: 85000,
          parseMs: 32,
          action: 'new',
          priceEur: 150000,
        },
        {
          id: 'h-456',
          url: 'https://999.md/ro/456',
          status: 200,
          bytes: 92000,
          parseMs: 35,
          action: 'updated',
          priceEur: 175000,
        },
      ];

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          detailsDetail,
        },
      });

      const retrieved = await prisma.sweepRun.findUnique({ where: { id: sweep.id } });
      expect(retrieved?.detailsDetail).toEqual(detailsDetail);
      expect(Array.isArray(retrieved?.detailsDetail)).toBe(true);
      expect((retrieved?.detailsDetail as unknown[])?.length).toBe(2);
    });

    it('SweepRun can store eventLog as JSON array', async () => {
      const eventLog = [
        {
          sweepId: '123',
          t: '08:30:45',
          lvl: 'info',
          msg: 'Fetch page 1 starting',
          meta: JSON.stringify({ page: 1 }),
        },
        {
          sweepId: '123',
          t: '08:30:46',
          lvl: 'info',
          msg: 'Fetch page 1 complete, 50 listings found',
          meta: JSON.stringify({ page: 1, found: 50 }),
        },
      ];

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          eventLog,
        },
      });

      const retrieved = await prisma.sweepRun.findUnique({ where: { id: sweep.id } });
      expect(retrieved?.eventLog).toEqual(eventLog);
      expect(Array.isArray(retrieved?.eventLog)).toBe(true);
    });

    it('SweepRun JSON columns default to null when not provided', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
        },
      });

      const retrieved = await prisma.sweepRun.findUnique({ where: { id: sweep.id } });
      expect(retrieved?.configSnapshot).toBeNull();
      expect(retrieved?.pagesDetail).toBeNull();
      expect(retrieved?.detailsDetail).toBeNull();
      expect(retrieved?.eventLog).toBeNull();
    });

    it('GET /api/sweeps/:id returns SweepDetail with populated JSON columns', async () => {
      const now = new Date();
      const configData = { setting1: 'value1' };
      const pagesData = [{ page: 1, found: 50 }];
      const detailsData = [{ id: 'h-1', action: 'new' }];
      const eventData = [{ msg: 'started' }];

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: now,
          finishedAt: new Date(now.getTime() + 30000),
          configSnapshot: configData,
          pagesDetail: pagesData,
          detailsDetail: detailsData,
          eventLog: eventData,
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('id', sweep.id);
      // API translates DB status 'ok' → UI status 'success' via toUiStatus.
      expect(body).toHaveProperty('status', 'success');
      expect(body).toHaveProperty('config');
      expect(body).toHaveProperty('pages');
      expect(body).toHaveProperty('details');
      expect(body).toHaveProperty('logTail');
    });
  });

  describe('integration: create SweepRun with all JSON columns populated', () => {
    it('creates a complete SweepRun row and retrieves via GET /api/sweeps/:id', async () => {
      const startedAt = new Date();
      const finishedAt = new Date(startedAt.getTime() + 45000);

      const configSnapshot = {
        politeness: { baseDelayMs: 8000 },
        filter: { maxAreaSqm: 1000 },
      };

      const pagesDetail = [
        {
          page: 1,
          url: 'search-page-1',
          status: 200,
          bytes: 120000,
          parseMs: 42,
          found: 48,
          took: 1200,
        },
      ];

      const detailsDetail = [
        {
          id: 'h-201',
          url: 'https://999.md/ro/201',
          status: 200,
          bytes: 88000,
          parseMs: 30,
          action: 'new',
          priceEur: 145000,
        },
      ];

      const eventLog = [
        {
          sweepId: '999',
          t: '09:00:00',
          lvl: 'info',
          msg: 'Starting sweep',
          meta: '{}',
        },
      ];

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt,
          finishedAt,
          source: '999.md',
          trigger: 'manual',
          configSnapshot,
          pagesDetail,
          detailsDetail,
          eventLog,
        },
      });

      // Verify creation
      expect(sweep.id).toBeGreaterThan(0);
      expect(sweep.configSnapshot).toEqual(configSnapshot);
      expect(sweep.pagesDetail).toEqual(pagesDetail);
      expect(sweep.detailsDetail).toEqual(detailsDetail);
      expect(sweep.eventLog).toEqual(eventLog);

      // Retrieve via API
      const res = await app.request(`/api/sweeps/${sweep.id}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe(sweep.id);
      // API translates DB status 'ok' → UI status 'success' via toUiStatus.
      expect(body.status).toBe('success');
      expect(body.source).toBe('999.md');
      expect(body.trigger).toBe('manual');
    });
  });
});
