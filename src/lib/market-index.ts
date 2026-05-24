// Composite market indices (P6). Pure functions, no I/O.
//
// The capstone of the roadmap: it z-blends the per-segment signals shipped by
// P0–P4 into one top-line **Market Temperature** score and a Buyer/Seller power
// label. The score is *relative across segments* (z-scores within the supplied
// set), so it answers "which sectors are hottest right now", not an absolute
// constant. Higher score = hotter = seller's market.
//
// Component directions (sign applied to each z-score):
//   medianDomClosed   ↓ hotter  (sells fast)            → −
//   absorptionMonths  ↓ hotter  (low supply overhang)   → −
//   distressShare     ↓ hotter  (few motivated sellers) → −
//   inventory         ↓ hotter  (scarce stock)          → −
//   newListingPremium ↑ hotter  (fresh asks test higher)→ +

export interface SegmentComponents {
  key: string;
  inventory: number;
  medianDomClosed: number | null;
  absorptionMonths: number | null;
  distressShare: number;
  newListingPremium: number | null;
}

export type MarketPower = 'buyers' | 'balanced' | 'sellers';

export interface TemperatureRow {
  key: string;
  temperatureScore: number; // mean of signed z-scores; >0 hotter, <0 colder
  power: MarketPower;
  inventory: number;
}

export interface MarketIndexResult {
  segments: TemperatureRow[]; // sorted hottest-first
  summary: Record<MarketPower, number>; // count of segments in each power band
}

export interface MarketIndexOptions {
  /** |score| below this is "balanced"; above tilts to sellers/buyers. */
  powerThreshold: number;
}

export const DEFAULT_MARKET_INDEX_OPTIONS: MarketIndexOptions = {
  powerThreshold: 0.5,
};

/** Population z-scores. Returns all-zero when the series has no spread. */
export function zScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  if (std === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / std);
}

// Each component: the field selector and the sign of its contribution to heat.
const COMPONENTS: {
  sign: number;
  pick: (s: SegmentComponents) => number | null;
}[] = [
  { sign: -1, pick: (s) => s.medianDomClosed },
  { sign: -1, pick: (s) => s.absorptionMonths },
  { sign: -1, pick: (s) => s.distressShare },
  { sign: -1, pick: (s) => s.inventory },
  { sign: +1, pick: (s) => s.newListingPremium },
];

/**
 * Impute nulls to the component mean (neutral, z=0) so a missing signal neither
 * heats nor cools a segment, then z-score and blend with the directional signs.
 */
function componentZ(
  segments: SegmentComponents[],
  pick: (s: SegmentComponents) => number | null,
): number[] {
  const present = segments.map(pick).filter((v): v is number => v != null);
  const mean = present.length > 0 ? present.reduce((s, v) => s + v, 0) / present.length : 0;
  const filled = segments.map((s) => pick(s) ?? mean);
  return zScores(filled);
}

export function marketTemperature(
  segments: SegmentComponents[],
  opts: MarketIndexOptions = DEFAULT_MARKET_INDEX_OPTIONS,
): MarketIndexResult {
  if (segments.length === 0) {
    return { segments: [], summary: { buyers: 0, balanced: 0, sellers: 0 } };
  }

  const componentZs = COMPONENTS.map((c) => ({ sign: c.sign, z: componentZ(segments, c.pick) }));

  const rows: TemperatureRow[] = segments.map((seg, i) => {
    const score =
      componentZs.reduce((acc, c) => acc + c.sign * (c.z[i] ?? 0), 0) / COMPONENTS.length;
    const power: MarketPower =
      score > opts.powerThreshold
        ? 'sellers'
        : score < -opts.powerThreshold
          ? 'buyers'
          : 'balanced';
    return {
      key: seg.key,
      temperatureScore: Math.round(score * 1000) / 1000,
      power,
      inventory: seg.inventory,
    };
  });

  rows.sort((a, b) => b.temperatureScore - a.temperatureScore);

  const summary: Record<MarketPower, number> = { buyers: 0, balanced: 0, sellers: 0 };
  for (const r of rows) summary[r.power]++;

  return { segments: rows, summary };
}
