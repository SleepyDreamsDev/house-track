// Generic filter shape exposed to the operator UI. Source adapters in
// src/sources/ translate this into source-specific GraphQL inputs.
//
// Mirror copy of the schema lives in web/src/lib/filterSchema.ts for the
// SPA's react-hook-form resolver. Keep the two in sync.

import { z } from 'zod';

export const CATEGORIES = ['house', 'apartment'] as const;
export type Category = (typeof CATEGORIES)[number];

export type FilterSelection =
  | { kind: 'options'; filterId: number; featureId: number; optionIds: number[] }
  | {
      kind: 'range';
      filterId: number;
      featureId: number;
      unit?: string | undefined;
      min?: string | undefined;
      max?: string | undefined;
    }
  | { kind: 'boolean'; filterId: number; featureId: number };

export interface GenericFilter {
  category: Category;
  filters: FilterSelection[];
}

const optionsSelectionSchema = z.object({
  kind: z.literal('options'),
  filterId: z.number().int(),
  featureId: z.number().int(),
  optionIds: z.array(z.number().int()).min(1),
});

const rangeSelectionSchema = z
  .object({
    kind: z.literal('range'),
    filterId: z.number().int(),
    featureId: z.number().int(),
    unit: z.string().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
  })
  .refine((v) => v.min !== undefined || v.max !== undefined, {
    message: 'range must have at least one of min or max',
  })
  .refine(
    (v) => {
      if (v.min === undefined || v.max === undefined) return true;
      return Number(v.min) <= Number(v.max);
    },
    { message: 'range min must be ≤ max' },
  );

const booleanSelectionSchema = z.object({
  kind: z.literal('boolean'),
  filterId: z.number().int(),
  featureId: z.number().int(),
});

export const filterSelectionSchema = z.discriminatedUnion('kind', [
  optionsSelectionSchema,
  rangeSelectionSchema,
  booleanSelectionSchema,
]);

export const genericFilterSchema = z.object({
  category: z.enum(CATEGORIES),
  filters: z.array(filterSelectionSchema).min(1),
});

export const defaultGenericFilter: GenericFilter = {
  category: 'house',
  filters: [
    { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
    { kind: 'options', filterId: 32, featureId: 7, optionIds: [12900] },
    { kind: 'range', filterId: 9441, featureId: 2, unit: 'UNIT_EUR', max: '250000' },
  ],
};
