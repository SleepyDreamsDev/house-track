import { describe, expect, it } from 'vitest';

import { thumbUrl, primaryThumb } from '../image-url.js';

describe('thumbUrl', () => {
  it('builds a CDN thumbnail URL from a bare filename', () => {
    expect(thumbUrl('d8704eba6a20e407cbcbc874444ec7ef.jpg')).toBe(
      'https://i.simpalsmedia.com/999.md/BoardImages/320x240/d8704eba6a20e407cbcbc874444ec7ef.jpg',
    );
  });

  it('passes through values that are already absolute URLs', () => {
    expect(thumbUrl('https://cdn/1.jpg')).toBe('https://cdn/1.jpg');
  });

  it('returns null for null/empty', () => {
    expect(thumbUrl(null)).toBeNull();
    expect(thumbUrl('')).toBeNull();
  });
});

describe('primaryThumb', () => {
  it('returns the first image as a thumbnail URL', () => {
    expect(primaryThumb(['a.jpg', 'b.jpg'])).toBe(
      'https://i.simpalsmedia.com/999.md/BoardImages/320x240/a.jpg',
    );
  });

  it('returns null for empty arrays and non-arrays', () => {
    expect(primaryThumb([])).toBeNull();
    expect(primaryThumb(null)).toBeNull();
    expect(primaryThumb(undefined)).toBeNull();
  });
});
