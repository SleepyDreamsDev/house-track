// Market-assessment signals (P0 absorption + P1 price analytics).
//
// Pure functions over plain inputs — no Prisma, no I/O — so they unit-test
// without a database. The analytics routes adapt rows into these shapes.
//
// CAVEAT carried from the data source: snapshots are only written when 999.md's
// HTML hash changes, so a price held flat logs no row. timeToFirstCutDays is
// therefore "first *observed* cut", not necessarily the true first cut.

import { roomsBucket } from './listing-type.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Listings below this many valid samples are statistically too noisy to report. */
export const SMALL_SAMPLE_FLOOR = 5;

/** Fixed EUR price bands — fixed (not data-driven) so trends stay comparable over time. */
export const PRICE_BANDS = ['<40k', '40-70k', '70-100k', '100-150k', '150k+'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number] | 'unknown';

export function priceBand(priceEur: number | null): PriceBand {
  if (priceEur == null) return 'unknown';
  if (priceEur < 40_000) return '<40k';
  if (priceEur < 70_000) return '40-70k';
  if (priceEur < 100_000) return '70-100k';
  if (priceEur < 150_000) return '100-150k';
  return '150k+';
}

// ── statistics helpers (canonical home; analytics.ts imports these) ──

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Linear-interpolated percentile (p in [0,1]). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] ?? 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * (idx - lo);
}

/** Interquartile range (Q3 − Q1) — a robust dispersion = negotiation-room proxy. */
export function iqr(values: number[]): number {
  if (values.length === 0) return 0;
  return percentile(values, 0.75) - percentile(values, 0.25);
}

// ── P0: realized DOM + absorption ──

export interface DomInput {
  firstSeenAt: Date;
  delistedAt: Date | null;
}

/** Days a *closed* listing spent on the market. Null while still active. */
export function realizedDomDays(l: DomInput): number | null {
  if (l.delistedAt == null) return null;
  return Math.max(0, Math.floor((l.delistedAt.getTime() - l.firstSeenAt.getTime()) / DAY_MS));
}

/** Median realized DOM over closed listings only; 0 when none have closed. */
export function medianDomClosed(listings: DomInput[]): number {
  const doms = listings.map(realizedDomDays).filter((d): d is number => d != null);
  if (doms.length === 0) return 0;
  return Math.round(median(doms));
}

/**
 * Months of supply = active inventory ÷ monthly delist rate. The trailing-4wk
 * delist count stands in for one month of outflow. Null when nothing has been
 * delisted recently (rate of 0 → division undefined, not "infinite supply").
 */
export function absorptionMonths(
  activeInventory: number,
  delistsTrailing4wk: number,
): number | null {
  if (delistsTrailing4wk <= 0) return null;
  return activeInventory / delistsTrailing4wk;
}

/** Turnover = delists ÷ average inventory over the period. Null when no inventory. */
export function turnoverRatio(delists: number, avgInventory: number): number | null {
  if (avgInventory <= 0) return null;
  return delists / avgInventory;
}

// ── P1: repricing + premium + seller mix ──

/** Mean signed delta between consecutive snapshot prices (negative = cutting). */
export function repricingVelocity(prices: number[]): number {
  if (prices.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < prices.length; i++) {
    sum += (prices[i] ?? 0) - (prices[i - 1] ?? 0);
  }
  return sum / (prices.length - 1);
}

export interface SnapshotPoint {
  capturedAt: Date;
  priceEur: number | null;
}

/**
 * Days from firstSeenAt to the first *observed* price drop. Snapshots must be
 * ordered by capturedAt ascending. Null when no drop is observed.
 */
export function timeToFirstCutDays(firstSeenAt: Date, snapshots: SnapshotPoint[]): number | null {
  let prev: number | null = null;
  for (const s of snapshots) {
    if (s.priceEur == null) continue;
    if (prev != null && s.priceEur < prev) {
      return Math.max(0, Math.floor((s.capturedAt.getTime() - firstSeenAt.getTime()) / DAY_MS));
    }
    prev = s.priceEur;
  }
  return null;
}

/** Median €/m² of fresh (<2wk) listings ÷ median of standing inventory. */
export function newListingPremium(
  freshEurPerSqm: number[],
  standingEurPerSqm: number[],
): number | null {
  const standing = median(standingEurPerSqm);
  if (standing <= 0) return null;
  return median(freshEurPerSqm) / standing;
}

export interface SellerMix {
  agency: number;
  private: number;
  unknown: number;
}

/** Fractional share of each seller type. Untagged rows count as "unknown". */
export function sellerMix(sellerTypes: (string | null)[]): SellerMix {
  const total = sellerTypes.length;
  if (total === 0) return { agency: 0, private: 0, unknown: 0 };
  let agency = 0;
  let priv = 0;
  for (const t of sellerTypes) {
    if (t === 'agency') agency++;
    else if (t === 'private') priv++;
  }
  const unknown = total - agency - priv;
  return { agency: agency / total, private: priv / total, unknown: unknown / total };
}

// ── P1: segmentation ──

export type SegmentDim = 'sector' | 'rooms' | 'priceBand' | 'month';

export interface SegmentListing {
  sector: string | null;
  rooms: number | null;
  priceEur: number | null;
  areaSqm: number | null;
  sellerType: string | null;
  firstSeenAt: Date;
  delistedAt: Date | null;
}

export interface SegmentRow {
  key: Record<string, string>;
  count: number;
  medianEurPerSqm: number;
  iqrEurPerSqm: number;
  sellerMix: SellerMix;
  medianDomClosed: number | null;
}

function dimValue(l: SegmentListing, dim: SegmentDim): string {
  switch (dim) {
    case 'sector':
      return l.sector ?? 'unknown';
    case 'rooms':
      return roomsBucket(l.rooms);
    case 'priceBand':
      return priceBand(l.priceEur);
    case 'month':
      return `${l.firstSeenAt.getUTCFullYear()}-${String(l.firstSeenAt.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}

/**
 * Group listings by the requested dimensions and report €/m² median + IQR per
 * segment. `count` is the number of listings with a valid €/m² (the median's
 * sample size); segments below SMALL_SAMPLE_FLOOR are suppressed as noise.
 */
export function segmentStats(listings: SegmentListing[], dims: SegmentDim[]): SegmentRow[] {
  const groups = new Map<string, SegmentListing[]>();
  for (const l of listings) {
    const composite = dims.map((d) => `${d}=${dimValue(l, d)}`).join('|');
    const bucket = groups.get(composite);
    if (bucket) bucket.push(l);
    else groups.set(composite, [l]);
  }

  const rows: SegmentRow[] = [];
  for (const [, members] of groups) {
    const valid = members.filter(
      (l): l is SegmentListing & { priceEur: number; areaSqm: number } =>
        l.priceEur != null && l.areaSqm != null && l.areaSqm > 0,
    );
    if (valid.length < SMALL_SAMPLE_FLOOR) continue;

    const eurPerSqm = valid.map((l) => l.priceEur / l.areaSqm);
    const first = members[0];
    if (!first) continue;
    const key: Record<string, string> = {};
    for (const d of dims) key[d] = dimValue(first, d);

    const closed = members.filter((l) => l.delistedAt != null);
    rows.push({
      key,
      count: valid.length,
      medianEurPerSqm: Math.round(median(eurPerSqm)),
      iqrEurPerSqm: Math.round(iqr(eurPerSqm)),
      sellerMix: sellerMix(members.map((l) => l.sellerType)),
      medianDomClosed: closed.length > 0 ? medianDomClosed(closed) : null,
    });
  }
  return rows;
}
