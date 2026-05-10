import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getSetting, listSettings, setSetting } from '../settings.js';

let prisma: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.setting.deleteMany();
});

describe('Two-tier cadence settings (PR 1 plumbing)', () => {
  describe('sweep.mode flag', () => {
    it("defaults to 'legacy' when unset", async () => {
      const value = await getSetting('sweep.mode');
      expect(value).toBe('legacy');
    });

    it("accepts 'two_tier' as a valid value", async () => {
      await setSetting('sweep.mode', 'two_tier');
      const value = await getSetting('sweep.mode');
      expect(value).toBe('two_tier');
    });

    it('rejects values outside the legacy/two_tier enum', async () => {
      await expect(setSetting('sweep.mode', 'bogus')).rejects.toThrow();
      await expect(setSetting('sweep.mode', 42)).rejects.toThrow();
    });
  });

  describe('Index-ticker tunables', () => {
    const keys = [
      'sweep.indexTickIntervalMinutesMin',
      'sweep.indexTickIntervalMinutesMax',
      'sweep.indexTickTargetListings',
    ] as const;

    it('validate as positive integers and round-trip via getSetting', async () => {
      for (const key of keys) {
        await setSetting(key, 42);
        expect(await getSetting(key)).toBe(42);
      }
    });

    it('reject zero and negatives', async () => {
      for (const key of keys) {
        await expect(setSetting(key, 0)).rejects.toThrow();
        await expect(setSetting(key, -1)).rejects.toThrow();
      }
    });

    it('expose sensible defaults from config.SWEEP', async () => {
      expect(await getSetting('sweep.indexTickIntervalMinutesMin')).toBe(60);
      expect(await getSetting('sweep.indexTickIntervalMinutesMax')).toBe(120);
      expect(await getSetting('sweep.indexTickTargetListings')).toBe(100);
    });
  });

  describe('Detail-trickle tunables', () => {
    const positiveKeys = [
      'sweep.detailTrickleIntervalSecondsMin',
      'sweep.detailTrickleIntervalSecondsMax',
      'sweep.staleThresholdHours',
      'sweep.watchlistRefreshHours',
    ] as const;

    it('validate as positive integers', async () => {
      for (const key of positiveKeys) {
        await setSetting(key, 5);
        expect(await getSetting(key)).toBe(5);
        await expect(setSetting(key, 0)).rejects.toThrow();
      }
    });

    it('allow the queue refill threshold to be zero', async () => {
      await setSetting('sweep.detailTrickleQueueRefillThreshold', 0);
      expect(await getSetting('sweep.detailTrickleQueueRefillThreshold')).toBe(0);
    });

    it('reject negative queue refill thresholds', async () => {
      await expect(setSetting('sweep.detailTrickleQueueRefillThreshold', -1)).rejects.toThrow();
    });
  });

  describe('Soft-throttle politeness keys', () => {
    it('validate as positive integers and round-trip', async () => {
      await setSetting('politeness.softThrottleMultiplier', 4);
      await setSetting('politeness.softThrottleDurationMinutes', 45);
      expect(await getSetting('politeness.softThrottleMultiplier')).toBe(4);
      expect(await getSetting('politeness.softThrottleDurationMinutes')).toBe(45);
    });

    it('reject zero multiplier (would disable throttling silently)', async () => {
      await expect(setSetting('politeness.softThrottleMultiplier', 0)).rejects.toThrow();
    });

    it('expose sensible defaults from config.POLITENESS', async () => {
      expect(await getSetting('politeness.softThrottleMultiplier')).toBe(3);
      expect(await getSetting('politeness.softThrottleDurationMinutes')).toBe(30);
    });
  });

  describe('listSettings() exposes new keys with grouping metadata', () => {
    it('includes sweep.mode in the Sweep group as a select with the two-option enum', async () => {
      const results = await listSettings();
      const row = results.find((s) => s.key === 'sweep.mode');
      expect(row).toBeDefined();
      expect(row?.group).toBe('Sweep');
      expect(row?.kind).toBe('select');
      expect(row?.options).toEqual(['legacy', 'two_tier']);
    });

    it('groups index-ticker + detail-trickle keys under Sweep with non-empty labels', async () => {
      const results = await listSettings();
      const newSweepKeys = [
        'sweep.indexTickIntervalMinutesMin',
        'sweep.indexTickIntervalMinutesMax',
        'sweep.indexTickTargetListings',
        'sweep.detailTrickleIntervalSecondsMin',
        'sweep.detailTrickleIntervalSecondsMax',
        'sweep.detailTrickleQueueRefillThreshold',
        'sweep.staleThresholdHours',
        'sweep.watchlistRefreshHours',
      ];

      for (const key of newSweepKeys) {
        const row = results.find((s) => s.key === key);
        expect(row, `${key} missing from listSettings()`).toBeDefined();
        expect(row?.group).toBe('Sweep');
        expect(row?.kind).toBe('number');
        expect(row?.label?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('groups soft-throttle keys under Politeness', async () => {
      const results = await listSettings();
      const multiplier = results.find((s) => s.key === 'politeness.softThrottleMultiplier');
      const duration = results.find((s) => s.key === 'politeness.softThrottleDurationMinutes');
      expect(multiplier?.group).toBe('Politeness');
      expect(duration?.group).toBe('Politeness');
      expect(multiplier?.kind).toBe('number');
      expect(duration?.kind).toBe('number');
    });
  });

  describe('No regression in existing defaults', () => {
    it("sweep.cronSchedule default is still '0 9,21 * * *'", async () => {
      expect(await getSetting('sweep.cronSchedule')).toBe('0 9,21 * * *');
    });

    it('politeness base/jitter/detail defaults are unchanged', async () => {
      expect(await getSetting('politeness.baseDelayMs')).toBe(8000);
      expect(await getSetting('politeness.jitterMs')).toBe(2000);
      expect(await getSetting('politeness.detailDelayMs')).toBe(10000);
    });
  });
});
