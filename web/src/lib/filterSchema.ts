// Mirror of src/types/filter.ts — keep the two in sync. The canonical copy
// lives server-side; duplicating here avoids reaching across the Vite
// client/server boundary or building a workspace-shared package for one
// schema. If you add an enum value here, add it there too (and to the
// 999md mapping table in src/sources/999md.ts).

import { z } from 'zod';

export const CATEGORIES = ['house', 'apartment'] as const;
export type Category = (typeof CATEGORIES)[number];

// ── FilterSelection discriminated union ──────────────────────────────────────
// Note: z.discriminatedUnion requires plain ZodObject members (no .refine()).
// Range-specific constraints (min≤max) are applied at GenericFilter level.

const optionsSelectionSchema = z.object({
  kind: z.literal('options'),
  filterId: z.number().int(),
  featureId: z.number().int(),
  optionIds: z.array(z.number().int()).min(1),
});

const rangeSelectionSchema = z.object({
  kind: z.literal('range'),
  filterId: z.number().int(),
  featureId: z.number().int(),
  unit: z.string().optional(),
  min: z.string().optional(),
  max: z.string().optional(),
});

const booleanSelectionSchema = z.object({
  kind: z.literal('boolean'),
  filterId: z.number().int(),
  featureId: z.number().int(),
});

export const filterSelectionSchema = z
  .discriminatedUnion('kind', [
    optionsSelectionSchema,
    rangeSelectionSchema,
    booleanSelectionSchema,
  ])
  // Applied after discriminator so it only runs on the matched variant.
  // For range: at least one of min/max must be present, and min ≤ max.
  .superRefine((val, ctx) => {
    if (val.kind !== 'range') return;
    if (val.min === undefined && val.max === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'range must have at least one of min or max',
      });
    }
    if (val.min !== undefined && val.max !== undefined && Number(val.min) > Number(val.max)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['min'],
        message: 'min must be ≤ max',
      });
    }
  });

export type FilterSelection = z.infer<typeof filterSelectionSchema>;

// ── GenericFilter ─────────────────────────────────────────────────────────────

export const genericFilterSchema = z.object({
  category: z.enum(CATEGORIES),
  filters: z.array(filterSelectionSchema),
});

export type GenericFilter = z.infer<typeof genericFilterSchema>;
