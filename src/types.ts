// Shared types for the 999.md crawler.
// These intentionally mirror a subset of the Prisma `Listing` model so the
// pure parser/fetch layers don't need to depend on `@prisma/client`.

export interface ListingStub {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceRaw: string | null;
  areaSqm: number | null;
  postedAt: Date | null;
}

export interface ParsedDetail {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceRaw: string | null;
  rooms: number | null;
  areaSqm: number | null;
  landSqm: number | null;
  district: string | null;
  street: string | null;
  floors: number | null;
  yearBuilt: number | null;
  heatingType: string | null;
  description: string | null;
  features: string[];
  imageUrls: string[];
  sellerType: string | null;
  postedAt: Date | null;
  bumpedAt: Date | null;
  rawHtmlHash: string;
}

export interface FetchResult {
  url: string;
  status: number;
  body: string;
}

export type SweepStatus = 'ok' | 'partial' | 'failed' | 'circuit_open';

export interface SweepError {
  url: string;
  status: number | null;
  msg: string;
}
