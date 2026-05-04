import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

describe('GET /api/sweeps/:id SweepDetail response contract', () => {
  let prisma: PrismaClient;
  let app: Hono;

  beforeAll(async () => {
    prisma = getPrisma();
    app = createApiApp();
  });

  beforeEach(async () => {
    await prisma.sweepRun.deleteMany();
  });

  describe('response shape', () => {
    it('returns 404 for non-existent sweep', async () => {
      const res = await app.request('/api/sweeps/99999');
      expect(res.status).toBe(404);
    });

    it('returns 200 with complete SweepDetail shape for finished sweep', async () => {
      const now = new Date();
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          source: '999.md',
          trigger: 'cron',
          startedAt: now,
          finishedAt: new Date(now.getTime() + 5000),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;

      // Required top-level fields per CLAUDE_CODE_E2E.md
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('startedAt');
      expect(body).toHaveProperty('source');
      expect(body).toHaveProperty('trigger');
      expect(body).toHaveProperty('config');
      expect(body).toHaveProperty('pages');
      expect(body).toHaveProperty('details');
      expect(body).toHaveProperty('errors');
      expect(body).toHaveProperty('logTail');
      expect(body).toHaveProperty('progress');
      expect(body).toHaveProperty('currentlyFetching');
    });

    it('returns id as number matching the SweepRun.id', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.id).toBe(sweep.id);
      expect(typeof body.id).toBe('number');
    });

    it('returns status as string', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'partial',
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.status).toBe('partial');
      expect(typeof body.status).toBe('string');
    });

    it('returns source and trigger as strings', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          source: '999.md',
          trigger: 'manual',
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.source).toBe('999.md');
      expect(body.trigger).toBe('manual');
      expect(typeof body.source).toBe('string');
      expect(typeof body.trigger).toBe('string');
    });

    it('returns config object derived from configSnapshot', async () => {
      const configData = {
        politeness: { baseDelayMs: 8000 },
        filter: { maxAreaSqm: 1000 },
      };

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          configSnapshot: configData,
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(typeof body.config).toBe('object');
    });

    it('returns pages array derived from pagesDetail', async () => {
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

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          pagesDetail,
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(Array.isArray(body.pages)).toBe(true);
    });

    it('returns details array derived from detailsDetail', async () => {
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
      ];

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          detailsDetail,
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(Array.isArray(body.details)).toBe(true);
    });

    it('returns errors array (may be empty)', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          errors: JSON.stringify([]),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(Array.isArray(body.errors)).toBe(true);
    });

    it('returns logTail array derived from eventLog', async () => {
      const eventLog = [
        {
          sweepId: '123',
          t: '09:00:00',
          lvl: 'info',
          msg: 'Starting sweep',
          meta: '{}',
        },
      ];

      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          eventLog,
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(Array.isArray(body.logTail)).toBe(true);
    });
  });

  describe('progress field structure', () => {
    it('includes progress object with phase, pagesDone, pagesTotal, queued', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          pagesFetched: 10,
          pagesDetail: JSON.stringify([
            { page: 1, found: 50 },
            { page: 2, found: 45 },
          ]),
          detailsDetail: JSON.stringify([
            { id: 'h-1', action: 'new' },
            { id: 'h-2', action: 'updated' },
          ]),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body).toHaveProperty('progress');
      const progress = body.progress as Record<string, unknown>;
      expect(progress).toHaveProperty('phase');
      expect(progress).toHaveProperty('pagesDone');
      expect(progress).toHaveProperty('pagesTotal');
      expect(progress).toHaveProperty('queued');
    });

    it('progress.phase reflects the sweep status', async () => {
      const statuses = ['ok', 'partial', 'failed', 'circuit_open'];

      for (const status of statuses) {
        await prisma.sweepRun.deleteMany();
        const sweep = await prisma.sweepRun.create({
          data: {
            status,
          },
        });

        const res = await app.request(`/api/sweeps/${sweep.id}`);
        const body = (await res.json()) as Record<string, unknown>;
        const progress = body.progress as Record<string, unknown>;

        expect(progress.phase).toBe(status);
      }
    });

    it('progress contains numeric values for pagesDone and pagesTotal', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          pagesFetched: 5,
          pagesDetail: JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ page: i + 1 }))),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;
      const progress = body.progress as Record<string, unknown>;

      expect(typeof progress.pagesDone).toBe('number');
      expect(typeof progress.pagesTotal).toBe('number');
      expect(typeof progress.queued).toBe('number');
    });
  });

  describe('currentlyFetching field', () => {
    it('returns null for finished sweeps', async () => {
      const now = new Date();
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: now,
          finishedAt: new Date(now.getTime() + 5000),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.currentlyFetching).toBeNull();
    });

    it('includes currentlyFetching field for in-progress sweeps', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'in_progress',
          startedAt: new Date(),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body).toHaveProperty('currentlyFetching');
    });
  });

  describe('timestamp fields', () => {
    it('returns startedAt as ISO string', async () => {
      const now = new Date();
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: now,
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(typeof body.startedAt).toBe('string');
      expect(() => new Date(body.startedAt as string)).not.toThrow();
    });

    it('returns finishedAt as ISO string when present', async () => {
      const now = new Date();
      const finishedAt = new Date(now.getTime() + 5000);
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          startedAt: now,
          finishedAt,
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(typeof body.finishedAt).toBe('string');
      expect(() => new Date(body.finishedAt as string)).not.toThrow();
    });

    it('omits or null finishedAt when sweep is running', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'in_progress',
          startedAt: new Date(),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      // Hono serializes undefined as absent from JSON, so finishedAt is either null or undefined
      expect(body.finishedAt === null || body.finishedAt === undefined).toBe(true);
    });
  });

  describe('durationMs field on list response', () => {
    it('GET /api/sweeps includes durationMs for finished sweeps', async () => {
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

      const sweeps = (await res.json()) as Array<Record<string, unknown>>;
      expect(sweeps.length).toBeGreaterThan(0);
      expect(sweeps[0]).toHaveProperty('durationMs');
      expect(typeof sweeps[0]?.durationMs).toBe('number');
    });

    it('GET /api/sweeps includes null durationMs for running sweeps', async () => {
      await prisma.sweepRun.create({
        data: {
          status: 'in_progress',
          startedAt: new Date(),
        },
      });

      const res = await app.request('/api/sweeps');
      const sweeps = (await res.json()) as Array<Record<string, unknown>>;

      const running = sweeps.find((s) => s.finishedAt === null);
      expect(running).toBeDefined();
      expect(running?.durationMs).toBeNull();
    });
  });
});
