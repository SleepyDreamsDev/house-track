// GraphQL: parse a 999.md GetAdvert response into a full ParsedDetail row.
//
// Source: docs/poc-spec.md §"Database schema" + §"Crawl flow" step 7.
// 999.md serves the detail page as JSON via GraphQL — there is no HTML to parse.
//
// rawHtmlHash retains its name (matches the Prisma column) but the *value* is now
// sha256 over the meaningful JSON fields (title, price, state, street, body.ro).
// This keeps snapshot-on-change semantics while ignoring bump-only updates.

import { createHash } from 'node:crypto';

import { FILTER } from './config.js';
import type { FilterValueTriple, ParsedDetail } from './types.js';

interface RawAdvert {
  id?: string;
  title?: string;
  state?: string;
  reseted?: string;
  price?: { value?: { measurement?: string; unit?: string; value?: number } };
  body?: { value?: { ro?: string; ru?: string; translated?: string } };
  city?: { value?: { translated?: string } };
  street?: { value?: string };
  images?: { value?: string[] };
  [key: string]: unknown;
}

// Feature types that don't map to a single (featureId, optionId|number|text)
// triple — body text, image arrays, and map points are stored elsewhere
// (description, imageUrls, deferred lat/lon respectively).
const NON_FILTER_FEATURE_TYPES = new Set(['FEATURE_BODY', 'FEATURE_IMAGES', 'FEATURE_MAP_POINT']);

interface AdvertResponse {
  data?: { advert?: RawAdvert | null };
}

export class AdvertNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Advert ${id} not found (data.advert missing or null)`);
    this.name = 'AdvertNotFoundError';
  }
}

const AREA_RE = /(\d+)\s*m²/;

const RO_MONTHS: Record<string, number> = {
  ian: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  mai: 4,
  iun: 5,
  iul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export function parseDetail(id: string, json: unknown): ParsedDetail {
  const data = (json as AdvertResponse)?.data;
  if (!data || !('advert' in data)) {
    throw new Error('parseDetail: response missing data.advert key');
  }
  const advert = data.advert;
  if (!advert) throw new AdvertNotFoundError(id);

  const title = advert.title ?? '';
  const { priceEur, priceRaw } = normalizePrice(advert.price);

  return {
    id,
    url: `${FILTER.listingBaseUrl}/${id}`,
    title,
    priceEur,
    priceRaw,
    rooms: null,
    areaSqm: parseAreaFromTitle(title),
    landSqm: null,
    district: advert.city?.value?.translated ?? null,
    street: advert.street?.value ?? null,
    floors: null,
    yearBuilt: null,
    heatingType: null,
    description: advert.body?.value?.ro ?? null,
    features: [],
    imageUrls: advert.images?.value ?? [],
    sellerType: null,
    postedAt: null,
    bumpedAt: parseRoDate(advert.reseted),
    rawHtmlHash: hashStableFields(advert),
    filterValues: extractFilterValues(advert),
  };
}

// Walks the advert's top-level keys and collects every value that looks
// like a 999.md FeatureValue ({id, type: "FEATURE_*", value}). The shape of
// `value` determines which column the triple lands in:
//   - FEATURE_OPTIONS / FEATURE_OFFER_TYPE: value.value is the option id
//   - FEATURE_TEXT: value is a string
//   - FEATURE_INT: value is a number
//   - FEATURE_PRICE: value.value is the price amount (numericValue)
// Anything else (BODY/IMAGES/MAP_POINT) is skipped.
function extractFilterValues(advert: RawAdvert): FilterValueTriple[] {
  const out: FilterValueTriple[] = [];
  for (const key of Object.keys(advert)) {
    const entry = advert[key];
    if (!isFeatureEntry(entry)) continue;
    if (NON_FILTER_FEATURE_TYPES.has(entry.type)) continue;
    const triple = toTriple(entry);
    if (triple) out.push(triple);
  }
  return out;
}

interface FeatureEntry {
  id: number;
  type: string;
  value: unknown;
}

function isFeatureEntry(v: unknown): v is FeatureEntry {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['id'] === 'number' &&
    typeof obj['type'] === 'string' &&
    obj['type'].startsWith('FEATURE_') &&
    'value' in obj
  );
}

function toTriple(entry: FeatureEntry): FilterValueTriple | null {
  const base = {
    filterId: 0,
    featureId: entry.id,
    optionId: null,
    textValue: null,
    numericValue: null,
  };
  const v = entry.value;

  // FEATURE_OPTIONS / FEATURE_OFFER_TYPE: { value: number, translated, ... }
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === 'number') {
      // FEATURE_PRICE wraps the number under .value too — keep prices as
      // numericValue so range queries (price < X) work directly.
      if (entry.type === 'FEATURE_PRICE') return { ...base, numericValue: inner };
      return { ...base, optionId: inner };
    }
  }

  if (typeof v === 'string') return { ...base, textValue: v };
  if (typeof v === 'number') return { ...base, numericValue: v };

  return null;
}

function normalizePrice(price: RawAdvert['price']): {
  priceEur: number | null;
  priceRaw: string | null;
} {
  const v = price?.value;
  if (typeof v?.value !== 'number') return { priceEur: null, priceRaw: null };
  const unit = stripUnitPrefix(v.unit ?? v.measurement);
  return {
    priceEur: unit === 'EUR' ? v.value : null,
    priceRaw: `${v.value} ${unit ?? '?'}`,
  };
}

function stripUnitPrefix(unit: string | undefined): string | undefined {
  return unit?.startsWith('UNIT_') ? unit.slice('UNIT_'.length) : unit;
}

function parseAreaFromTitle(title: string): number | null {
  const m = title.match(AREA_RE);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

// "26 apr. 2026, 18:34" → Date in local TZ. Returns null on any parse failure.
function parseRoDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4}),\s+(\d{1,2}):(\d{2})$/i);
  if (!m) return null;
  const [, dayStr, monStr, yearStr, hourStr, minStr] = m;
  const month = RO_MONTHS[(monStr ?? '').toLowerCase()];
  if (month === undefined) return null;
  return new Date(Number(yearStr), month, Number(dayStr), Number(hourStr), Number(minStr), 0, 0);
}

function hashStableFields(advert: RawAdvert): string {
  const stable = JSON.stringify({
    title: advert.title ?? null,
    state: advert.state ?? null,
    priceValue: advert.price?.value?.value ?? null,
    priceUnit: advert.price?.value?.unit ?? advert.price?.value?.measurement ?? null,
    street: advert.street?.value ?? null,
    bodyRo: advert.body?.value?.ro ?? null,
  });
  return createHash('sha256').update(stable).digest('hex');
}
