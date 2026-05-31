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

// Production default — kept in sync with src/config.ts FILTER.searchInput.
// Region is feature 8 (Localitate: Chișinău + Durlești + Codru), NOT feature 7
// (Regiune), and area is filter 1073/feature 244 (Suprafață totală), NOT
// 1194/239 (Suprafață locuibilă). The old feature-7 + living-area encoding
// matched only 240 of 482 houses; see memory project_filter_undercount_240_vs_482.
export const defaultGenericFilter: GenericFilter = {
  category: 'house',
  filters: [
    { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
    { kind: 'options', filterId: 32, featureId: 8, optionIds: [13859, 13917, 13942] },
    { kind: 'range', filterId: 1073, featureId: 244, unit: 'UNIT_METER_SQUARE', min: '90' },
    { kind: 'options', filterId: 4101, featureId: 1311, optionIds: [23321] },
    { kind: 'options', filterId: 5078, featureId: 1623, optionIds: [27759] },
    { kind: 'options', filterId: 5079, featureId: 1624, optionIds: [27761] },
    { kind: 'range', filterId: 9441, featureId: 2, unit: 'UNIT_EUR', max: '250000' },
  ],
};
