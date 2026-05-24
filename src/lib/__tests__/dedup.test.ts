import { describe, expect, it } from 'vitest';

import {
  addressMatch,
  canonicalMap,
  clusterListings,
  DEFAULT_DEDUP_OPTIONS,
  geoMatch,
  haversineMeters,
  matchReasons,
  normalizeStreet,
  shareImage,
  type DedupListing,
} from '../dedup.js';

const DAY = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY);

const mk = (id: string, over: Partial<DedupListing> = {}): DedupListing => ({
  id,
  imageUrls: [],
  street: 'Strada Mihai Eminescu 5',
  sector: 'Centru',
  rooms: 3,
  areaSqm: 100,
  lat: null,
  lon: null,
  firstSeenAt: day(0),
  ...over,
});

describe('normalizeStreet', () => {
  it('lowercases, strips diacritics and punctuation, collapses spaces', () => {
    expect(normalizeStreet('  Strada  Ștefan-cel-Mare! ')).toBe('strada stefan cel mare');
  });

  it('returns null for null or empty-after-normalize input', () => {
    expect(normalizeStreet(null)).toBeNull();
    expect(normalizeStreet('!!!')).toBeNull();
  });
});

describe('shareImage', () => {
  it('is true when listings share any CDN image URL', () => {
    const a = mk('a', { imageUrls: ['https://cdn/1.jpg', 'https://cdn/2.jpg'] });
    const b = mk('b', { imageUrls: ['https://cdn/2.jpg'] });
    expect(shareImage(a, b)).toBe(true);
  });

  it('is false when either listing has no images or none overlap', () => {
    expect(shareImage(mk('a', { imageUrls: [] }), mk('b', { imageUrls: ['x'] }))).toBe(false);
    expect(shareImage(mk('a', { imageUrls: ['x'] }), mk('b', { imageUrls: ['y'] }))).toBe(false);
  });
});

describe('addressMatch', () => {
  it('matches on same street + sector + rooms bucket + area within tolerance', () => {
    const a = mk('a', { areaSqm: 100 });
    const b = mk('b', { areaSqm: 108 }); // within 10%
    expect(addressMatch(a, b, 0.1)).toBe(true);
  });

  it('rejects different sector, street, rooms bucket, or out-of-tolerance area', () => {
    expect(addressMatch(mk('a'), mk('b', { sector: 'Botanica' }), 0.1)).toBe(false);
    expect(addressMatch(mk('a'), mk('b', { street: 'Other 1' }), 0.1)).toBe(false);
    expect(addressMatch(mk('a', { rooms: 2 }), mk('b', { rooms: 5 }), 0.1)).toBe(false);
    expect(addressMatch(mk('a', { areaSqm: 100 }), mk('b', { areaSqm: 130 }), 0.1)).toBe(false);
  });
});

describe('geo', () => {
  it('haversine ~0 for identical points and ~111km per degree latitude', () => {
    expect(haversineMeters(47, 28, 47, 28)).toBeCloseTo(0, 5);
    expect(haversineMeters(47, 28, 48, 28)).toBeGreaterThan(110_000);
  });

  it('geoMatch within threshold + same rooms/area, false beyond', () => {
    const a = mk('a', { lat: 47.0, lon: 28.0 });
    const near = mk('b', { lat: 47.00005, lon: 28.0 }); // ~5.5m
    const far = mk('c', { lat: 47.01, lon: 28.0 }); // ~1.1km
    expect(geoMatch(a, near, DEFAULT_DEDUP_OPTIONS)).toBe(true);
    expect(geoMatch(a, far, DEFAULT_DEDUP_OPTIONS)).toBe(false);
  });
});

describe('matchReasons', () => {
  it('reports every signal that fires', () => {
    const a = mk('a', { imageUrls: ['https://cdn/1.jpg'], lat: 47, lon: 28 });
    const b = mk('b', { imageUrls: ['https://cdn/1.jpg'], lat: 47.00005, lon: 28 });
    expect(matchReasons(a, b, DEFAULT_DEDUP_OPTIONS).sort()).toEqual(['address', 'geo', 'image']);
  });

  it('is empty for unrelated listings', () => {
    const a = mk('a', { street: 'A 1', imageUrls: ['x'] });
    const b = mk('b', { street: 'B 2', sector: 'Botanica', imageUrls: ['y'] });
    expect(matchReasons(a, b, DEFAULT_DEDUP_OPTIONS)).toEqual([]);
  });
});

describe('clusterListings', () => {
  it('unions transitively: a~b (image), b~c (address) → one cluster', () => {
    const a = mk('a', { imageUrls: ['https://cdn/1.jpg'], street: 'A 1', firstSeenAt: day(0) });
    const b = mk('b', { imageUrls: ['https://cdn/1.jpg'], street: 'A 1', firstSeenAt: day(5) });
    const c = mk('c', { imageUrls: [], street: 'A 1', firstSeenAt: day(10) });
    const clusters = clusterListings([c, b, a]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberIds).toEqual(['a', 'b', 'c']); // earliest first
    expect(clusters[0]!.canonicalId).toBe('a');
    expect(clusters[0]!.reasons).toContain('image');
    expect(clusters[0]!.reasons).toContain('address');
  });

  it('keeps unrelated listings as separate (omitted) singletons', () => {
    const a = mk('a', { street: 'A 1', imageUrls: ['x'] });
    const b = mk('b', { street: 'B 2', sector: 'Botanica', imageUrls: ['y'] });
    expect(clusterListings([a, b])).toHaveLength(0);
  });

  it('picks the earliest-seen member as canonical', () => {
    const late = mk('late', { imageUrls: ['https://cdn/9.jpg'], firstSeenAt: day(20) });
    const early = mk('early', { imageUrls: ['https://cdn/9.jpg'], firstSeenAt: day(2) });
    const [cluster] = clusterListings([late, early]);
    expect(cluster!.canonicalId).toBe('early');
  });
});

describe('canonicalMap', () => {
  it('maps cluster members to canonical and singletons to themselves', () => {
    const a = mk('a', { imageUrls: ['https://cdn/1.jpg'], firstSeenAt: day(0) });
    const b = mk('b', { imageUrls: ['https://cdn/1.jpg'], firstSeenAt: day(5) });
    const solo = mk('solo', { street: 'Z 9', sector: 'Botanica', imageUrls: ['z'] });
    const map = canonicalMap([a, b, solo]);
    expect(map.get('a')).toBe('a');
    expect(map.get('b')).toBe('a');
    expect(map.get('solo')).toBe('solo');
  });
});
