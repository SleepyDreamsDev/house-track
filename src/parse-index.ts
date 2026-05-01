// GraphQL: parse a 999.md SearchAds response into listing stubs.
//
// Source: docs/poc-spec.md §"Crawl flow (per sweep)" step 4.
// 999.md serves listings via GraphQL — there is no HTML to parse for the index.
//
// Listing detail URL: https://999.md/ro/<id>
// Price normalization: only UNIT_EUR maps to priceEur. MDL/USD keep priceRaw and
// priceEur=null — let the post-filter & detail page decide what to do.

import { FILTER } from './config.js';
import type { ListingStub } from './types.js';

export interface PostFilter {
  maxPriceEur: number;
  maxAreaSqm: number;
}

interface RawAd {
  id: string;
  title: string;
  price?: { value?: { measurement?: string; unit?: string; value?: number } };
}

interface SearchAdsResponse {
  data?: { searchAds?: { ads?: RawAd[] } };
}

const AREA_RE = /(\d+)\s*m²/;

export function parseIndex(json: unknown): ListingStub[] {
  const ads = (json as SearchAdsResponse)?.data?.searchAds?.ads;
  if (!Array.isArray(ads)) {
    throw new Error('parseIndex: response missing data.searchAds.ads');
  }
  return ads.map(toStub);
}

export function applyPostFilter(stubs: ListingStub[], filter: PostFilter): ListingStub[] {
  return stubs.filter((s) => {
    if (s.priceEur !== null && s.priceEur > filter.maxPriceEur) return false;
    if (s.areaSqm !== null && s.areaSqm > filter.maxAreaSqm) return false;
    return true;
  });
}

function toStub(ad: RawAd): ListingStub {
  const { priceEur, priceRaw } = normalizePrice(ad.price);
  return {
    id: ad.id,
    url: `${FILTER.listingBaseUrl}/${ad.id}`,
    title: ad.title,
    priceEur,
    priceRaw,
    areaSqm: parseAreaFromTitle(ad.title),
    postedAt: null,
  };
}

function normalizePrice(price: RawAd['price']): {
  priceEur: number | null;
  priceRaw: string | null;
} {
  const v = price?.value;
  if (typeof v?.value !== 'number') return { priceEur: null, priceRaw: null };
  const unit = stripUnitPrefix(v.unit ?? v.measurement);
  const raw = `${v.value} ${unit ?? '?'}`;
  return { priceEur: unit === 'EUR' ? v.value : null, priceRaw: raw };
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
