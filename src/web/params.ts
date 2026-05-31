// Request-param parsing helpers. parseInt/parseFloat return NaN on garbage
// input, which then flows into Prisma `where`/`take`/`skip` and surfaces as an
// unhandled 500 (or silently coerces). These guards keep a bad query string
// from reaching the data layer — invalid → the documented fallback / 400.

/** Optional non-NaN integer from a query value; `undefined` when absent/invalid. */
export function optInt(raw: string | undefined | null): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** Optional non-NaN float from a query value; `undefined` when absent/invalid. */
export function optFloat(raw: string | undefined | null): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? undefined : n;
}

/** A positive-integer id (for `:id` path params); `null` when absent/invalid. */
export function positiveIntId(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
