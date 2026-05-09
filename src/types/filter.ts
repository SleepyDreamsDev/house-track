// Generic filter shape exposed to the operator UI. Source adapters in
// src/sources/ translate this into source-specific GraphQL inputs.
//
// The enums here are deliberately narrow: every value MUST appear in the
// 999.md mapping table (src/sources/999md.ts) — adding a value here without
// extending the mapping is a contract bug that the source's resolve() will
// catch with UnknownGenericFilterValueError.
//
// Mirror copy of the schema lives in web/src/lib/filterSchema.ts for the
// SPA's react-hook-form resolver. Keep the two in sync.

import { z } from 'zod';

export const TRANSACTION_TYPES = ['sale', 'rent'] as const;
export const CATEGORIES = ['house', 'apartment'] as const;
export const LOCALITIES = ['chisinau', 'durlesti', 'codru', 'colonita'] as const;
export const CURRENCIES = ['EUR'] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Locality = (typeof LOCALITIES)[number];
export type Currency = (typeof CURRENCIES)[number];

export interface GenericFilter {
  transactionType: TransactionType;
  category: Category;
  locality: Locality[];
  currency: Currency;
  // Optional bounds explicitly include `undefined` so the value emitted by
  // genericFilterSchema (z.infer is `number | undefined`) round-trips under
  // `exactOptionalPropertyTypes: true`.
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  sqmMin?: number | undefined;
  sqmMax?: number | undefined;
}

const baseSchema = z.object({
  transactionType: z.enum(TRANSACTION_TYPES),
  category: z.enum(CATEGORIES),
  locality: z.array(z.enum(LOCALITIES)).min(1),
  currency: z.enum(CURRENCIES).default('EUR'),
  priceMin: z.number().nonnegative().optional(),
  priceMax: z.number().positive().optional(),
  sqmMin: z.number().nonnegative().optional(),
  sqmMax: z.number().positive().optional(),
});

export const genericFilterSchema = baseSchema
  .refine((v) => v.priceMin === undefined || v.priceMax === undefined || v.priceMin <= v.priceMax, {
    path: ['priceMin'],
    message: 'priceMin must be ≤ priceMax',
  })
  .refine((v) => v.sqmMin === undefined || v.sqmMax === undefined || v.sqmMin <= v.sqmMax, {
    path: ['sqmMin'],
    message: 'sqmMin must be ≤ sqmMax',
  });

export const defaultGenericFilter: GenericFilter = {
  transactionType: 'sale',
  category: 'house',
  locality: ['chisinau'],
  currency: 'EUR',
  priceMax: 250_000,
  sqmMax: 200,
};
