// Behavioral + text-mining signals (P3). Pure functions over already-stored
// fields (description, imageUrls, posted/bumped timestamps) — no I/O, no
// capture dependency. Feeds the Distress Index: a cross-listing stress gauge
// built from seller-flexibility language, listing effort, and timing.
//
// Lexicon is intentionally an exported constant so terms can be tuned without
// touching the scanner. Matching is substring over normalized text (lowercase,
// diacritics stripped) so "Preț REDUS" and "pret redus" both hit. Romanian +
// Russian, since 999.md listings are bilingual.

const DAY_MS = 24 * 60 * 60 * 1000;

export type DistressCategory = 'urgency' | 'negotiable' | 'reduced' | 'exchange' | 'installments';

// Terms are pre-normalized (lowercase, no diacritics) to match normalizeText().
export const DISTRESS_LEXICON: Record<DistressCategory, readonly string[]> = {
  urgency: ['urgent', 'urgenta', 'срочно', 'срочная'],
  negotiable: ['negociabil', 'se negociaza', 'torg', 'торг', 'уступлю'],
  reduced: ['pret redus', 'redus', 'reducere', 'снижена', 'снижение цены'],
  exchange: ['schimb', 'accept schimb', 'обмен', 'меняю'],
  installments: ['in rate', 'achitare in rate', 'rate', 'рассрочка', 'кредит'],
};

/** Lowercase + strip combining diacritics. Leaves Cyrillic intact. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface DistressResult {
  signals: DistressCategory[]; // distinct categories matched, sorted
  score: number; // number of distinct categories (0–5)
  distressed: boolean; // score >= 1
}

/** Scan a description for seller-flexibility / urgency language. */
export function scanDistress(description: string | null): DistressResult {
  if (!description) return { signals: [], score: 0, distressed: false };
  const text = normalizeText(description);
  const signals: DistressCategory[] = [];
  for (const category of Object.keys(DISTRESS_LEXICON) as DistressCategory[]) {
    if (DISTRESS_LEXICON[category].some((term) => text.includes(term))) {
      signals.push(category);
    }
  }
  signals.sort();
  return { signals, score: signals.length, distressed: signals.length > 0 };
}

export type PhotoQuality = 'none' | 'sparse' | 'ok' | 'rich';

/** Listing-effort proxy from photo count. */
export function photoQuality(imageCount: number): PhotoQuality {
  if (imageCount <= 0) return 'none';
  if (imageCount <= 2) return 'sparse';
  if (imageCount <= 7) return 'ok';
  return 'rich';
}

/** True when a date falls on Saturday or Sunday (UTC). */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** 24-slot histogram of UTC hours. Index = hour, value = count. */
export function postingHourHistogram(dates: Date[]): number[] {
  const hist = new Array<number>(24).fill(0);
  for (const d of dates) {
    const h = d.getUTCHours();
    const current = hist[h];
    if (current !== undefined) hist[h] = current + 1;
  }
  return hist;
}

/**
 * Bump-cadence regularity: coefficient of variation of intervals between sorted
 * bump timestamps, inverted to [0,1] where 1 = perfectly regular (bot/agency
 * tooling) and 0 = irregular/human. Needs ≥3 timestamps; returns null otherwise.
 */
export function bumpRegularity(bumpTimes: Date[]): number | null {
  if (bumpTimes.length < 3) return null;
  const sorted = [...bumpTimes].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / DAY_MS);
  }
  const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  if (mean <= 0) return null;
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, 1 - cv); // high CV ⇒ irregular ⇒ low regularity
}
