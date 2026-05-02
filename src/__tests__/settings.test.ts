import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getSetting, setSetting, listSettings } from '../settings.js';

let prisma: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  // Use the DATABASE_URL environment variable set by vitest.setup.ts
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.setting.deleteMany();
});

describe('Settings', () => {
  it('returns a setting from the database', async () => {
    // Arrange: seed the database with a setting
    await prisma.setting.create({
      data: { key: 'politeness.baseDelayMs', valueJson: 12000 },
    });

    // Act
    const result = await getSetting('politeness.baseDelayMs');

    // Assert
    expect(result).toBe(12000);
  });

  it('falls back to defaults when setting is not in database', async () => {
    // Act
    const result = await getSetting('politeness.jitterMs');

    // Assert
    expect(result).toBe(2000); // default from config
  });

  it('stores a new setting via setSetting', async () => {
    // Act
    await setSetting('sweep.maxPagesPerSweep', 75);
    const result = await getSetting('sweep.maxPagesPerSweep');

    // Assert
    expect(result).toBe(75);

    const row = await prisma.setting.findUnique({
      where: { key: 'sweep.maxPagesPerSweep' },
    });
    expect(row?.valueJson).toBe(75);
  });

  it('updates an existing setting via setSetting', async () => {
    // Arrange
    await prisma.setting.create({
      data: { key: 'filter.maxPriceEur', valueJson: 300000 },
    });

    // Act
    await setSetting('filter.maxPriceEur', 200000);
    const result = await getSetting('filter.maxPriceEur');

    // Assert
    expect(result).toBe(200000);
  });

  it('validates setting writes against zod schemas', async () => {
    // Act & Assert
    await expect(setSetting('politeness.baseDelayMs', -1000)).rejects.toThrow();
  });

  it('lists all settings with their current and default values', async () => {
    // Arrange
    await prisma.setting.create({
      data: { key: 'politeness.baseDelayMs', valueJson: 10000 },
    });

    // Act
    const results = await listSettings();

    // Assert
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const baseDelay = results.find((s) => s.key === 'politeness.baseDelayMs');
    expect(baseDelay).toBeDefined();
    expect(baseDelay?.value).toBe(10000);
    expect(baseDelay?.default).toBe(8000); // config default
    expect(baseDelay?.schema).toBeDefined();
  });
});
