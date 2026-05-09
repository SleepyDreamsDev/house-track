// Mirror of src/types/filter.ts — keep the two in sync. The canonical copy
// lives server-side; duplicating here avoids reaching across the Vite
// client/server boundary or building a workspace-shared package for one
// schema. If you add an enum value here, add it there too (and to the
// 999md mapping table in src/sources/999md.ts).

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
