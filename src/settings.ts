import { z } from 'zod';

import { CIRCUIT, FILTER, POLITENESS, SWEEP } from './config.js';
import { getPrisma } from './db.js';

// Define schemas for each setting
const settingSchemas = {
  'politeness.baseDelayMs': z.number().int().positive(),
  'politeness.jitterMs': z.number().int().nonnegative(),
  'politeness.detailDelayMs': z.number().int().positive(),
  'sweep.maxPagesPerSweep': z.number().int().positive(),
  'sweep.backfillPerSweep': z.number().int().nonnegative(),
  'sweep.cronSchedule': z.string().min(1),
  'sweep.targetListingsPerSweep': z.number().int().positive(),
  'sweep.targetListingsJitter': z.number().int().nonnegative(),
  'sweep.cronWindowJitterMs': z.number().int().nonnegative(),
  'sweep.expectedPerDay': z.number().int().positive(),
  'circuit.consecutiveFailureThreshold': z.number().int().positive(),
  'circuit.pauseDurationMs': z.number().int().positive(),
  'filter.maxPriceEur': z.number().int().positive(),
  'filter.maxAreaSqm': z.number().positive(),
  'filter.searchInputJson': z.any(),
  'log.level': z.union([
    z.literal('debug'),
    z.literal('info'),
    z.literal('warn'),
    z.literal('error'),
  ]),
  'stats.successRateWindow': z.number().int().positive(),
} as const;

// Map of setting keys to their default values from config.ts
const defaultValues: Record<string, unknown> = {
  'politeness.baseDelayMs': POLITENESS.baseDelayMs,
  'politeness.jitterMs': POLITENESS.jitterMs,
  'politeness.detailDelayMs': POLITENESS.detailDelayMs,
  'sweep.maxPagesPerSweep': FILTER.maxPagesPerSweep,
  'sweep.backfillPerSweep': SWEEP.backfillPerSweep,
  'sweep.cronSchedule': '0 9,21 * * *', // default twice daily at 9am and 9pm
  'sweep.targetListingsPerSweep': SWEEP.targetListingsPerSweep,
  'sweep.targetListingsJitter': SWEEP.targetListingsJitter,
  'sweep.cronWindowJitterMs': SWEEP.cronWindowJitterMs,
  'sweep.expectedPerDay': SWEEP.expectedPerDay,
  'circuit.consecutiveFailureThreshold': CIRCUIT.consecutiveFailureThreshold,
  'circuit.pauseDurationMs': CIRCUIT.pauseDurationMs,
  'filter.maxPriceEur': FILTER.postFilter.maxPriceEur,
  'filter.maxAreaSqm': FILTER.postFilter.maxAreaSqm,
  'filter.searchInputJson': FILTER.searchInput,
  'log.level': 'info',
  'stats.successRateWindow': 100,
};

// Metadata for settings UI rendering
export const settingMeta: Record<
  string,
  {
    group: string;
    kind: 'number' | 'text' | 'select';
    unit?: string;
    options?: string[];
    label?: string;
    hint?: string;
  }
> = {
  'politeness.baseDelayMs': {
    group: 'Politeness',
    kind: 'number',
    unit: 'ms',
    label: 'Base Delay',
    hint: 'Base delay between requests (ms)',
  },
  'politeness.jitterMs': {
    group: 'Politeness',
    kind: 'number',
    unit: 'ms',
    label: 'Jitter',
    hint: 'Random jitter added to delays (ms)',
  },
  'politeness.detailDelayMs': {
    group: 'Politeness',
    kind: 'number',
    unit: 'ms',
    label: 'Detail Delay',
    hint: 'Delay for detail page requests (ms)',
  },
  'sweep.maxPagesPerSweep': {
    group: 'Sweep',
    kind: 'number',
    unit: 'pages',
    label: 'Max Pages Per Sweep',
  },
  'sweep.backfillPerSweep': {
    group: 'Sweep',
    kind: 'number',
    unit: 'listings',
    label: 'Backfill Per Sweep',
  },
  'sweep.cronSchedule': {
    group: 'Sweep',
    kind: 'text',
    label: 'Cron Schedule',
    hint: 'Cron expression for sweep timing',
  },
  'sweep.targetListingsPerSweep': {
    group: 'Sweep',
    kind: 'number',
    unit: 'listings',
    label: 'Target Listings (mean)',
    hint: 'Each sweep aims for this many listings ± jitter.',
  },
  'sweep.targetListingsJitter': {
    group: 'Sweep',
    kind: 'number',
    unit: 'listings',
    label: 'Target Listings (± jitter)',
    hint: 'Random spread around the mean. 0 disables.',
  },
  'sweep.cronWindowJitterMs': {
    group: 'Sweep',
    kind: 'number',
    unit: 'ms',
    label: 'Tick Jitter Window',
    hint: 'Sweep is deferred 0..N ms after cron fires. 0 disables.',
  },
  'sweep.expectedPerDay': {
    group: 'Sweep',
    kind: 'number',
    unit: 'sweeps/day',
    label: 'Expected Sweeps/Day',
    hint: 'Used to compute when missing listings go inactive. Phase B forecast panel surfaces mismatches with the cron schedule.',
  },
  'circuit.consecutiveFailureThreshold': {
    group: 'Circuit breaker',
    kind: 'number',
    unit: 'failures',
    label: 'Failure Threshold',
  },
  'circuit.pauseDurationMs': {
    group: 'Circuit breaker',
    kind: 'number',
    unit: 'ms',
    label: 'Pause Duration',
  },
  'filter.maxPriceEur': {
    group: 'Filter',
    kind: 'number',
    unit: '€',
    label: 'Max Price',
  },
  'filter.maxAreaSqm': {
    group: 'Filter',
    kind: 'number',
    unit: 'm²',
    label: 'Max Area',
  },
  'log.level': {
    group: 'Logging',
    kind: 'select',
    options: ['debug', 'info', 'warn', 'error'],
    label: 'Log Level',
  },
  'stats.successRateWindow': {
    group: 'Stats',
    kind: 'number',
    unit: 'sweeps',
    label: 'Success Rate Window',
    hint: 'Last N finished sweeps used to compute Dashboard success rate',
  },
};

export async function getSetting<T = unknown>(key: string, fallback?: T): Promise<T> {
  const prisma = getPrisma();

  const setting = await prisma.setting.findUnique({
    where: { key },
  });

  if (setting !== null && setting !== undefined) {
    return setting.valueJson as T;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  const defaultVal = defaultValues[key];
  if (defaultVal !== undefined) {
    return defaultVal as T;
  }

  throw new Error(`Setting key "${key}" not found and no default provided`);
}

export async function setSetting<T = unknown>(key: string, value: T): Promise<void> {
  // Validate against the schema
  const schema = settingSchemas[key as keyof typeof settingSchemas];
  if (!schema) {
    throw new Error(`Unknown setting key: ${key}`);
  }

  const parsed = schema.parse(value);
  const prisma = getPrisma();

  // Prisma's JSON type requires explicit any cast for validated zod objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonValue = parsed as any;

  await prisma.setting.upsert({
    where: { key },
    update: { valueJson: jsonValue },
    create: { key, valueJson: jsonValue },
  });
}

export async function listSettings(): Promise<
  Array<{
    key: string;
    value: unknown;
    default: unknown;
    schema: z.ZodSchema;
    group?: string;
    kind?: 'number' | 'text' | 'select';
    unit?: string;
    options?: string[];
    label?: string;
    hint?: string;
  }>
> {
  const prisma = getPrisma();
  const allSettings = await prisma.setting.findMany();

  const settingMap = new Map(allSettings.map((s) => [s.key, s.valueJson]));

  return Object.entries(settingSchemas).map(([key, schema]) => {
    const meta = settingMeta[key];
    const result: {
      key: string;
      value: unknown;
      default: unknown;
      schema: z.ZodSchema;
      group?: string;
      kind?: 'number' | 'text' | 'select';
      unit?: string;
      options?: string[];
      label?: string;
      hint?: string;
    } = {
      key,
      value: settingMap.get(key) ?? defaultValues[key],
      default: defaultValues[key],
      schema,
    };

    if (meta) {
      result.group = meta.group;
      result.kind = meta.kind;
      if (meta.unit !== undefined) {
        result.unit = meta.unit;
      }
      if (meta.options !== undefined) {
        result.options = meta.options;
      }
      if (meta.label !== undefined) {
        result.label = meta.label;
      }
      if (meta.hint !== undefined) {
        result.hint = meta.hint;
      }
    }

    return result;
  });
}
