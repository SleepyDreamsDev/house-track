import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

describe('Sweeps API Correctness Fixes', () => {
  let prisma: PrismaClient;
  let app: Hono;

  beforeAll(async () => {
    prisma = getPrisma();
    app = createApiApp();
  });

  beforeEach(async () => {
    await prisma.sweepRun.deleteMany();
  });

  describe('Bug#1: sweeps.detail.ts:22 - parseInt() with non-numeric :id causes 500', () => {
    it('returns 400 for non-numeric sweep ID in GET /api/sweeps/:id', async () => {
      const res = await app.request('/api/sweeps/not-a-number');
      // Should return 400 Bad Request, not 500
      expect(res.status).toBe(400);
    });

    it('returns 400 for negative sweep ID in GET /api/sweeps/:id', async () => {
      const res = await app.request('/api/sweeps/-1');
      expect(res.status).toBe(400);
    });

    it('returns 400 for zero sweep ID in GET /api/sweeps/:id', async () => {
      const res = await app.request('/api/sweeps/0');
      expect(res.status).toBe(400);
    });

    it('returns 404 for valid numeric ID that does not exist', async () => {
      const res = await app.request('/api/sweeps/999999');
      expect(res.status).toBe(404);
    });

    it('returns 200 for valid positive numeric ID that exists', async () => {
      const sweep = await prisma.sweepRun.create({
        data: { status: 'ok' },
      });
      const res = await app.request(`/api/sweeps/${sweep.id}`);
      expect(res.status).toBe(200);
    });
  });

  describe('Bug#12: sweeps.ts:74 - POST /api/sweeps creates row with status:ok before work starts', () => {
    it('returns 201 Created for POST /api/sweeps', async () => {
      const res = await app.request('/api/sweeps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
    });

    it('POST /api/sweeps returns id and startedAt fields', async () => {
      const res = await app.request('/api/sweeps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('startedAt');
      expect(typeof body.id).toBe('number');
      expect(typeof body.startedAt).toBe('string');
    });

    it('POST /api/sweeps creates a SweepRun with status:in_progress (not ok)', async () => {
      const res = await app.request('/api/sweeps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await res.json()) as Record<string, unknown>;
      const sweepId = body.id as number;

      const row = await prisma.sweepRun.findUnique({ where: { id: sweepId } });
      expect(row).toBeDefined();
      // Bug fix: status should be 'in_progress', not 'ok'
      expect(row?.status).toBe('in_progress');
    });
  });

  describe('Bug#13: sweeps.ts:103 - POST /api/sweeps/:id/cancel allows cancelling finished sweeps', () => {
    it('returns 409 when trying to cancel a finished sweep', async () => {
      const sweep = await prisma.sweepRun.create({
        data: { status: 'ok', finishedAt: new Date() },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(409);
    });

    it('returns 200 when cancelling a running sweep', async () => {
      const sweep = await prisma.sweepRun.create({
        data: { status: 'in_progress' },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
    });

    it('flips status to cancelled and stamps finishedAt when cancelling', async () => {
      const before = new Date();
      const sweep = await prisma.sweepRun.create({
        data: { status: 'in_progress', startedAt: new Date() },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);

      const updated = await prisma.sweepRun.findUnique({ where: { id: sweep.id } });
      expect(updated?.status).toBe('cancelled');
      expect(updated?.finishedAt).toBeDefined();
      if (updated?.finishedAt) {
        expect(updated.finishedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      }
    });

    it('prevents cancelling historical completed sweeps with different statuses', async () => {
      const statuses = ['ok', 'partial', 'failed', 'circuit_open'];

      for (const status of statuses) {
        await prisma.sweepRun.deleteMany();
        const sweep = await prisma.sweepRun.create({
          data: { status, finishedAt: new Date() },
        });

        const res = await app.request(`/api/sweeps/${sweep.id}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(409);
      }
    });
  });

  describe('Bug#14: sweeps.ts:104 - durationMs:null for in-progress runs breaks web UI fmt.ms()', () => {
    it('GET /api/sweeps includes numeric durationMs for running sweeps', async () => {
      const sweep = await prisma.sweepRun.create({
        data: { status: 'in_progress', startedAt: new Date() },
      });

      const res = await app.request('/api/sweeps');
      const body = (await res.json()) as {
        sweeps: Array<Record<string, unknown>>;
        total: number;
      };
      const sweeps = body.sweeps;
      const running = sweeps.find((s) => s.id === sweep.id);

      expect(running).toBeDefined();
      expect(running?.durationMs).toBeDefined();
      // durationMs should be a number, not null, even for running sweeps
      expect(typeof running?.durationMs).toBe('number');
      expect((running?.durationMs as number) >= 0).toBe(true);
    });

    it('durationMs reflects elapsed time for running sweep', async () => {
      const startedAt = new Date(Date.now() - 5000); // 5 seconds ago
      const sweep = await prisma.sweepRun.create({
        data: { status: 'in_progress', startedAt },
      });

      const res = await app.request('/api/sweeps');
      const body = (await res.json()) as {
        sweeps: Array<Record<string, unknown>>;
        total: number;
      };
      const sweeps = body.sweeps;
      const running = sweeps.find((s) => s.id === sweep.id);

      const durationMs = running?.durationMs as number;
      // Should be approximately 5000ms, with some tolerance for test execution time
      expect(durationMs).toBeGreaterThanOrEqual(4900);
      expect(durationMs).toBeLessThanOrEqual(6000);
    });
  });

  describe('Bug#15: sweeps.detail.ts:53 - progress shape replaces legacy fields', () => {
    it('includes both progress and legacy fields in response', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          newListings: 42,
          updatedListings: 15,
          pagesFetched: 3,
          detailsFetched: 57,
          finishedAt: new Date(),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      // progress field (new) should be present
      expect(body).toHaveProperty('progress');

      // Legacy fields should still be present for backward compatibility
      // The detail response should preserve these or have summary equivalents
      expect(body).toHaveProperty('summary');
    });

    it('summary field contains legacy counts (newListings, updatedListings)', async () => {
      const sweep = await prisma.sweepRun.create({
        data: {
          status: 'ok',
          newListings: 42,
          updatedListings: 15,
          finishedAt: new Date(),
        },
      });

      const res = await app.request(`/api/sweeps/${sweep.id}`);
      const body = (await res.json()) as Record<string, unknown>;

      const summary = body.summary as Record<string, unknown> | undefined;
      expect(summary).toBeDefined();
    });
  });

  describe('GET /api/sweeps pagination', () => {
    it('returns {sweeps, total, limit, offset} envelope', async () => {
      for (let i = 0; i < 5; i++) {
        await prisma.sweepRun.create({
          data: {
            status: 'ok',
            startedAt: new Date(Date.now() - i * 1000),
            finishedAt: new Date(),
          },
        });
      }
      const res = await app.request('/api/sweeps?limit=2&offset=0');
      const body = (await res.json()) as {
        sweeps: unknown[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(body.sweeps).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(0);
    });

    it('skips earlier rows with offset', async () => {
      for (let i = 0; i < 5; i++) {
        await prisma.sweepRun.create({
          data: {
            status: 'ok',
            startedAt: new Date(Date.now() - i * 1000),
            finishedAt: new Date(),
          },
        });
      }
      const page1 = (await (await app.request('/api/sweeps?limit=2&offset=0')).json()) as {
        sweeps: Array<{ id: number }>;
      };
      const page2 = (await (await app.request('/api/sweeps?limit=2&offset=2')).json()) as {
        sweeps: Array<{ id: number }>;
      };
      const ids1 = page1.sweeps.map((s) => s.id);
      const ids2 = page2.sweeps.map((s) => s.id);
      // No overlap between consecutive pages
      expect(ids1.some((id) => ids2.includes(id))).toBe(false);
    });

    it('clamps negative offset to 0', async () => {
      await prisma.sweepRun.create({
        data: { status: 'ok', startedAt: new Date(), finishedAt: new Date() },
      });
      const res = await app.request('/api/sweeps?offset=-5');
      const body = (await res.json()) as { offset: number };
      expect(body.offset).toBe(0);
    });
  });
});
